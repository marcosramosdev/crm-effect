"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BATCH_SEND_ATTEMPTS, batchRetryDelayMs } from "@/lib/broadcast-retry";
import { Contact } from "@/types";
import type { BroadcastComposeState } from "@/components/broadcasts/step1-compose";
import {
  extractVariableNames,
  resolveVariableValues,
  substituteVariables,
} from "@/lib/whatsapp/broadcast-variables";

export type CustomFieldOperator = "is" | "is_not" | "contains";

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: "all" | "tags" | "custom_field" | "csv";
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

interface BroadcastPayload {
  name: string;
  compose: BroadcastComposeState;
  audience: AudienceConfig;
  /** Per-`{{field}}` fallback, from Step 3. */
  variableDefaults: Record<string, string>;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Send-batch pacing. 10 per batch + 1 s pause keeps a large campaign
 * comfortably under the gateway's own rate limits (see
 * `RATE_LIMITS.broadcast` — a 1 000-recipient send is ~100 calls over
 * several minutes, not one call per campaign).
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: "sent" | "failed";
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (field_name lowercased → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Bulk-fetch contact_custom_values (joined to their field name) for a
 * set of contacts. Returns an index keyed by contact_id → field_name
 * (lowercased) → value — the shape `resolveVariableValues` expects.
 */
async function fetchCustomValueIndex(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
  // values. Page through to stay safe.
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from("contact_custom_values")
      .select("contact_id, value, custom_fields(field_name)")
      .in("contact_id", slice);

    for (const row of (data ?? []) as {
      contact_id: string;
      value: string | null;
      custom_fields: { field_name: string } | { field_name: string }[] | null;
    }[]) {
      const field = Array.isArray(row.custom_fields)
        ? row.custom_fields[0]
        : row.custom_fields;
      if (!field?.field_name) continue;
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(field.field_name.toLowerCase(), row.value ?? "");
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === "all") {
      const { data, error } = await supabase.from("contacts").select("*");
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    } else if (
      audience.type === "tags" &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const { data: contactTags, error: tagError } = await supabase
        .from("contact_tags")
        .select("contact_id")
        .in("tag_id", audience.tagIds);

      if (tagError)
        throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      if (contactTags && contactTags.length > 0) {
        const uniqueContactIds = [
          ...new Set(contactTags.map((ct) => ct.contact_id)),
        ];
        const { data, error } = await supabase
          .from("contacts")
          .select("*")
          .in("id", uniqueContactIds);
        if (error)
          throw new Error(`Failed to fetch contacts: ${error.message}`);
        contacts = data ?? [];
      }
    } else if (audience.type === "custom_field" && audience.customField) {
      contacts = await resolveCustomFieldAudience(
        supabase,
        audience.customField,
      );
    } else if (audience.type === "csv" && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { data: excludeRows } = await supabase
        .from("contact_tags")
        .select("contact_id")
        .in("tag_id", audience.excludeTagIds);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error("You are not signed in.");
    }
    if (!accountId) {
      throw new Error("Your profile is not linked to an account.");
    }

    // De-duplicate by phone within the CSV (users can paste duplicates).
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    // Single round-trip lookup of existing contacts by phone.
    const { data: existing, error: lookupErr } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", user.id)
      .in("phone", phones);
    if (lookupErr) {
      throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
    }

    const byPhone = new Map<string, Contact>();
    for (const c of (existing ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        account_id: accountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from("contacts")
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    let query = supabase
      .from("contact_custom_values")
      .select("contact_id")
      .eq("custom_field_id", fieldId);

    if (operator === "is") query = query.eq("value", value);
    else if (operator === "is_not") query = query.neq("value", value);
    else if (operator === "contains")
      query = query.ilike("value", `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .in("id", contactIds);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  async function createAndSendBroadcast(
    payload: BroadcastPayload,
  ): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error("You are not signed in.");
      }
      if (!accountId) {
        throw new Error("Your profile is not linked to an account.");
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error("No contacts found for this audience.");
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const { compose } = payload;
      const { data: broadcast, error: broadcastError } = await supabase
        .from("broadcasts")
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          message_body: compose.messageBody,
          media_url: compose.mediaUrl,
          media_kind: compose.mediaKind,
          media_filename: compose.mediaFilename,
          variable_defaults: payload.variableDefaults,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          status: "sending",
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? "unknown error"}`,
        );
      }

      // ── Step 3: Resolve {{field}} variables + insert recipient rows ─
      // Resolved once here (frozen onto template_params) so a server-
      // side resume (issue #472) replays exactly what this pass would
      // have sent, rather than re-resolving against contact data that
      // may have changed since.
      setProgress(20);
      const variableNames = extractVariableNames(compose.messageBody);
      const customValueIndex = variableNames.length
        ? await fetchCustomValueIndex(
            supabase,
            contacts.map((c) => c.id),
          )
        : new Map();

      const resolvedByContact = new Map(
        contacts.map((contact) => [
          contact.id,
          variableNames.length === 0
            ? { values: {} as Record<string, string> }
            : resolveVariableValues(
                variableNames,
                {
                  name: contact.name,
                  phone: contact.phone,
                  email: contact.email,
                  company: contact.company,
                  customValues: customValueIndex.get(contact.id),
                },
                payload.variableDefaults,
              ),
        ]),
      );

      const recipientRows = contacts.map((contact) => {
        const resolved = resolvedByContact.get(contact.id)!;
        return {
          broadcast_id: broadcast.id,
          contact_id: contact.id,
          // A recipient whose variables couldn't all resolve is marked
          // failed up front — broadcasts spec, "Missing value with no
          // fallback" — the rest of the run still proceeds.
          status: (resolved.unresolvedVariable ? "failed" : "pending") as
            "failed" | "pending",
          error_message: resolved.unresolvedVariable
            ? `Missing value for "{{${resolved.unresolvedVariable}}}" — this contact has no value for it and no fallback was set.`
            : null,
          template_params: resolved.values,
        };
      });

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from("broadcast_recipients")
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop.
          await supabase
            .from("broadcasts")
            .update({
              status: "failed",
              failed_count: contacts.length,
            })
            .eq("id", broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
          );
        }
      }

      // ── Step 4: Fetch recipients back (joined contact) ────────────
      setProgress(30);
      const { data: recipients, error: recipientsFetchError } = await supabase
        .from("broadcast_recipients")
        .select("*, contact:contacts(*)")
        .eq("broadcast_id", broadcast.id);

      if (recipientsFetchError || !recipients) {
        throw new Error("Failed to fetch broadcast recipients");
      }

      let failedCount = recipientRows.filter(
        (r) => r.status === "failed",
      ).length;
      const totalRecipients = recipients.length;
      const sendable = recipients.filter((r) => r.status === "pending");

      for (let i = 0; i < sendable.length; i += SEND_BATCH_SIZE) {
        const batch = sendable.slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r) => r.contact?.phone)
          .map((r) => ({
            phone: r.contact!.phone as string,
            // Read back off the row rather than re-resolved, so this
            // pass and any later resume send identical text.
            text: substituteVariables(
              compose.messageBody,
              (r.template_params as Record<string, string>) ?? {},
            ),
          }));

        if (apiRecipients.length === 0) continue;

        try {
          // Send the batch, waiting out a 429 rather than writing the
          // whole batch off as failed. Only 429 is replayed — see
          // batchRetryDelayMs for why nothing else can be.
          let data: { error?: string; results?: BroadcastApiResult[] } = {};
          for (let attempt = 1; ; attempt++) {
            const res = await fetch("/api/whatsapp/broadcast", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recipients: apiRecipients,
                media_url: compose.mediaUrl,
                media_kind: compose.mediaKind,
                media_filename: compose.mediaFilename,
              }),
            });

            data = await res.json();
            if (res.ok) break;

            const retryIn =
              attempt < BATCH_SEND_ATTEMPTS
                ? batchRetryDelayMs(res.status, res.headers.get("Retry-After"))
                : null;
            if (retryIn === null) {
              throw new Error(data.error || "Broadcast API request failed");
            }
            await sleep(retryIn);
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          for (const recipient of batch) {
            const phone = recipient.contact?.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              await supabase
                .from("broadcast_recipients")
                .update({
                  status: "failed",
                  error_message: "No phone number on contact",
                })
                .eq("id", recipient.id);
              continue;
            }

            if (result.status === "sent") {
              await supabase
                .from("broadcast_recipients")
                .update({
                  status: "sent",
                  sent_at: new Date().toISOString(),
                  whatsapp_message_id: result.whatsapp_message_id ?? null,
                  error_message: null,
                })
                .eq("id", recipient.id);
            } else {
              failedCount++;
              await supabase
                .from("broadcast_recipients")
                .update({
                  status: "failed",
                  error_message: result.error ?? "Unknown error",
                })
                .eq("id", recipient.id);
            }
          }
        } catch (err) {
          for (const recipient of batch) {
            failedCount++;
            await supabase
              .from("broadcast_recipients")
              .update({
                status: "failed",
                error_message:
                  err instanceof Error ? err.message : "Unknown error",
              })
              .eq("id", recipient.id);
          }
        }

        const progressPct =
          30 + Math.round(((i + batch.length) / (sendable.length || 1)) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < sendable.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      // ── Step 5: Finalize status ───────────────────────────────────
      // Aggregate counts are maintained by the DB trigger (migration
      // 003); we only flip the final status here.
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? "failed" : "sent";
      await supabase
        .from("broadcasts")
        .update({ status: finalStatus })
        .eq("id", broadcast.id);

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
