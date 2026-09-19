// ============================================================
// UAZAPI instance lifecycle — provisioning, login, status, disconnect,
// and webhook (re)registration. See
// openspec/changes/replace-meta-with-uazapi/{design,specs/whatsapp-connection}.md
// and openspec/changes/simplify-whatsapp-connection-controls/design.md.
//
// Every function here takes `{ db, accountId, ... }` — `db` is
// whichever Supabase client the caller already resolved (the RLS
// client from `requireRole`, in every current call site) so RLS stays
// the backstop under the app-layer role gate, matching the send core
// and broadcast core's calling convention.
//
// `whatsapp_config` is one row per account (migration 017's
// UNIQUE(account_id)); every function here reads or writes that one
// row.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";

import { uazapiAdminFetch, uazapiFetch, UazapiError } from "./uazapi-client";
import { encrypt, decrypt } from "./encryption";

/** Failure classes a route can branch on — mirrors SendMessageError / BroadcastError. */
export type InstanceErrorCode =
  "not_configured" | "not_provisioned" | "invalid_phone" | "gateway_error";

export class InstanceError extends Error {
  readonly code: InstanceErrorCode;
  readonly status: number;
  constructor(code: InstanceErrorCode, message: string, status: number) {
    super(message);
    this.name = "InstanceError";
    this.code = code;
    this.status = status;
  }
}

export type ConnectionState =
  "disconnected" | "connecting" | "connected" | "hibernated";

interface ConfigRow {
  id: string;
  account_id: string;
  user_id: string;
  instance_id: string | null;
  instance_token: string | null;
  webhook_secret: string | null;
  webhook_secret_hash: string | null;
  connection_state: string;
  paired_phone: string | null;
  paired_at: string | null;
}

const CONFIG_COLUMNS =
  "id, account_id, user_id, instance_id, instance_token, webhook_secret, webhook_secret_hash, connection_state, paired_phone, paired_at";

async function loadConfigRow(
  db: SupabaseClient,
  accountId: string,
): Promise<ConfigRow | null> {
  const { data, error } = await db
    .from("whatsapp_config")
    .select(CONFIG_COLUMNS)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) {
    console.error("[whatsapp/instance] config load failed:", error.message);
    throw new InstanceError(
      "gateway_error",
      "Failed to load WhatsApp configuration",
      500,
    );
  }
  return (data as ConfigRow | null) ?? null;
}

/** Require a provisioned instance, returning its decrypted token alongside the row. */
async function requireInstance(
  db: SupabaseClient,
  accountId: string,
): Promise<{ row: ConfigRow; token: string }> {
  const row = await loadConfigRow(db, accountId);
  if (!row || !row.instance_id || !row.instance_token) {
    throw new InstanceError(
      "not_provisioned",
      "No WhatsApp instance has been provisioned for this account yet.",
      400,
    );
  }
  return { row, token: decrypt(row.instance_token) };
}

/**
 * Only the gateway's four documented states; anything else falls back
 * to disconnected. Exported for the webhook route's `connection` event
 * handler, which normalises the same `instance.status` string reported
 * by a callback instead of by `GET /instance/status`.
 */
export function normalizeConnectionState(raw: unknown): ConnectionState {
  return raw === "connecting" || raw === "connected" || raw === "hibernated"
    ? raw
    : "disconnected";
}

/** Stable, human-recognisable instance name — shows up in UAZAPI's own instance list. */
export function instanceName(accountId: string): string {
  return `wacrm-${accountId}`;
}

// ============================================================
// 3.1 — Provisioning
// ============================================================

export interface ProvisionInstanceArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
}

export interface ProvisionInstanceResult {
  instanceId: string;
  /** True when an existing instance was reused rather than created. */
  reused: boolean;
}

/** Raw (undecrypted) result of a successful `POST /instance/create` call. */
interface CreatedInstance {
  instanceId: string;
  instanceToken: string;
}

/**
 * Call `POST /instance/create` with the admin token and validate the
 * response. Shared by {@link provisionInstance} (first connection) and
 * {@link reprovisionInstance} (self-heal after the gateway forgets a
 * previously-issued instance — see that function's doc comment).
 */
async function createGatewayInstance(
  accountId: string,
): Promise<CreatedInstance> {
  const created = await uazapiAdminFetch<{
    instance?: { id?: string };
    token?: string;
  }>({
    path: "/instance/create",
    body: { name: instanceName(accountId) },
  });

  const instanceId = created.instance?.id;
  const instanceToken = created.token;
  if (!instanceId || !instanceToken) {
    throw new InstanceError(
      "gateway_error",
      "UAZAPI accepted the instance-create request but returned no instance id/token.",
      502,
    );
  }
  return { instanceId, instanceToken };
}

/**
 * Provision the account's UAZAPI instance, or reuse the one already
 * on record. Idempotent per account — see whatsapp-connection spec,
 * "Second connection reuses the existing instance".
 */
export async function provisionInstance(
  args: ProvisionInstanceArgs,
): Promise<ProvisionInstanceResult> {
  const { db, accountId, userId } = args;
  const existing = await loadConfigRow(db, accountId);
  if (existing?.instance_id && existing.instance_token) {
    return { instanceId: existing.instance_id, reused: true };
  }

  const { instanceId, instanceToken } = await createGatewayInstance(accountId);
  const encryptedToken = encrypt(instanceToken);

  if (existing) {
    const { error } = await db
      .from("whatsapp_config")
      .update({
        instance_id: instanceId,
        instance_token: encryptedToken,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) {
      console.error(
        "[whatsapp/instance] provision update failed:",
        error.message,
      );
      throw new InstanceError(
        "gateway_error",
        "Failed to save the provisioned instance",
        500,
      );
    }
  } else {
    const { error } = await db.from("whatsapp_config").insert({
      account_id: accountId,
      user_id: userId,
      instance_id: instanceId,
      instance_token: encryptedToken,
    });
    if (error) {
      console.error(
        "[whatsapp/instance] provision insert failed:",
        error.message,
      );
      throw new InstanceError(
        "gateway_error",
        "Failed to save the provisioned instance",
        500,
      );
    }
  }

  return { instanceId, reused: false };
}

/**
 * Force-create a brand-new gateway instance for an account that
 * already has a row, overwriting the stored `instance_id`/
 * `instance_token` and resetting connection state.
 *
 * Unlike {@link provisionInstance}, this never reuses what's on
 * record — it exists specifically for the case where what's on record
 * is the problem: UAZAPI's own docs note a freshly created instance is
 * "automatically disconnected and deleted after 1 hour" if never
 * connected, and an instance can also be removed manually from the
 * gateway's admin panel. Either way, our stored token then gets
 * rejected as `Invalid token` on every subsequent call, forever,
 * because nothing ever re-provisions — see the `unauthenticated`
 * catch in {@link startLogin}, the only current caller.
 *
 * Returns the new *raw* (undecrypted) instance token, ready to use
 * immediately without a round-trip back through `requireInstance`.
 */
async function reprovisionInstance(
  db: SupabaseClient,
  rowId: string,
  accountId: string,
): Promise<string> {
  const { instanceId, instanceToken } = await createGatewayInstance(accountId);

  const { error } = await db
    .from("whatsapp_config")
    .update({
      instance_id: instanceId,
      instance_token: encrypt(instanceToken),
      // The dead instance's connection state/pairing no longer means
      // anything against a gateway that has never heard of it.
      connection_state: "disconnected",
      paired_phone: null,
      paired_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (error) {
    console.error(
      "[whatsapp/instance] re-provision update failed:",
      error.message,
    );
    throw new InstanceError(
      "gateway_error",
      "Failed to save the re-provisioned instance",
      500,
    );
  }

  return instanceToken;
}

// ============================================================
// 3.5 — Webhook registration ("modo simples" — one webhook per
// instance, upserted by omitting `id`/`action`; see design.md D3).
// ============================================================

/** 32 bytes of CSPRNG entropy, base64url — short enough for a clean URL path segment. */
function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Exported for the webhook callback route, which hashes the secret
 * from the request path and looks up `whatsapp_config` by
 * `webhook_secret_hash` equality — an indexed hash lookup rather than
 * a byte-by-byte comparison of every stored secret, so a request
 * carrying a wrong secret learns nothing from response timing (design.md D3).
 */
export function hashWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * The events we subscribe the instance to. These names come from
 * UAZAPI's `WebhookConfig.events` enum. Note the callback body the
 * gateway POSTs back carries a DIFFERENT enum on `WebhookEvent.event`
 * (`message` / `status` / …) — the spec disagrees with itself — so the
 * receiving route (`src/app/api/whatsapp/webhook/[secret]/route.ts`,
 * `normalizeWebhookEventType`) accepts both spellings. Keep this list and
 * that normalizer in lockstep. See design.md D1/D2.
 */
const WEBHOOK_EVENTS = ["messages", "messages_update", "connection"] as const;

/**
 * `POST /webhook`'s request body, shared by every registration call so
 * the two never drift. `enabled` has no documented default in
 * UAZAPI's spec and is omitted there — observed in practice to leave
 * a freshly-created webhook disabled, silently dropping every inbound
 * event, so it's set explicitly here rather than left to whatever the
 * gateway defaults to.
 */
function webhookBody(url: string) {
  return {
    url,
    enabled: true,
    events: WEBHOOK_EVENTS,
    // Prevents the echo loop where our own sends re-enter as inbound
    // events (design.md D3).
    excludeMessages: ["wasSentByApi"],
  };
}

export interface EnsureWebhookRegisteredArgs {
  db: SupabaseClient;
  accountId: string;
  /** Origin the callback URL is built against, e.g. `https://crm.example.com`. */
  origin: string;
}

/**
 * Generate-or-reuse the account's callback secret and (re)register it
 * with the gateway. Best-effort: a registration failure is logged, not
 * thrown — the operator can still complete QR login, and a later
 * status poll or reconnect attempt retries this. See
 * whatsapp-connection spec, "Callback registered on connect".
 */
export async function ensureWebhookRegistered(
  args: EnsureWebhookRegisteredArgs,
): Promise<void> {
  const { db, accountId, origin } = args;
  try {
    const { row, token } = await requireInstance(db, accountId);

    let secret: string;
    if (row.webhook_secret) {
      secret = decrypt(row.webhook_secret);
    } else {
      secret = generateWebhookSecret();
      const { error } = await db
        .from("whatsapp_config")
        .update({
          webhook_secret: encrypt(secret),
          webhook_secret_hash: hashWebhookSecret(secret),
        })
        .eq("id", row.id);
      if (error) {
        console.error(
          "[whatsapp/instance] webhook secret save failed:",
          error.message,
        );
        return;
      }
    }

    await uazapiFetch({
      path: "/webhook",
      token,
      body: webhookBody(`${origin}/api/whatsapp/webhook/${secret}`),
    });
  } catch (err) {
    console.warn(
      "[whatsapp/instance] webhook registration failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

// ============================================================
// 3.2 — Login (QR or pairing code)
// ============================================================

export interface StartLoginArgs {
  db: SupabaseClient;
  accountId: string;
  origin: string;
  /** International-format phone (digits, optionally with a leading +). Omit for QR login. */
  phone?: string | null;
}

export interface StartLoginResult {
  connectionState: ConnectionState;
  /** Base64 QR image, present for QR-code login. */
  qrCode?: string;
  /** Present for pairing-code login. */
  pairingCode?: string;
}

/** UAZAPI's own pattern for `/instance/connect`'s `phone` field: digits only, 10–15 long. */
function toUazapiPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(digits)) {
    throw new InstanceError(
      "invalid_phone",
      "Phone number must be in international format with 10–15 digits (e.g. 5511999999999).",
      400,
    );
  }
  return digits;
}

type ConnectResponse = {
  instance?: { status?: string; qrcode?: string; paircode?: string };
};

/**
 * Start (or restart) login. Registers the callback webhook first
 * (best-effort — see {@link ensureWebhookRegistered}), matching the
 * "provisioned or reconnected" trigger in the whatsapp-connection
 * spec, then calls `POST /instance/connect`.
 *
 * Self-heals once if the gateway rejects the stored instance token as
 * `Invalid token` (`unauthenticated`) — see {@link reprovisionInstance}
 * for why that happens even for a previously-working instance, and why
 * retrying with the *same* dead token would just fail the same way
 * forever with no way for an operator to recover short of manual DB
 * surgery.
 */
export async function startLogin(
  args: StartLoginArgs,
): Promise<StartLoginResult> {
  const { db, accountId, origin, phone } = args;
  const uazapiPhone = phone ? toUazapiPhone(phone) : undefined;

  const { row, token } = await requireInstance(db, accountId);
  await ensureWebhookRegistered({ db, accountId, origin });

  const connect = (t: string) =>
    uazapiFetch<ConnectResponse>({
      path: "/instance/connect",
      token: t,
      body: uazapiPhone ? { phone: uazapiPhone } : {},
    });

  let result: ConnectResponse;
  try {
    result = await connect(token);
  } catch (err) {
    if (!(err instanceof UazapiError) || err.code !== "unauthenticated")
      throw err;

    console.warn(
      "[whatsapp/instance] stored instance token rejected by gateway; re-provisioning and retrying:",
      err.message,
    );
    const freshToken = await reprovisionInstance(db, row.id, accountId);
    // Re-register the webhook against the new instance before retrying
    // — `ensureWebhookRegistered` re-reads the row, so it picks up the
    // token `reprovisionInstance` just persisted.
    await ensureWebhookRegistered({ db, accountId, origin });
    result = await connect(freshToken);
  }

  const connectionState = normalizeConnectionState(result.instance?.status);

  const { error } = await db
    .from("whatsapp_config")
    .update({
      connection_state: connectionState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    console.error(
      "[whatsapp/instance] login state save failed:",
      error.message,
    );
  }

  return {
    connectionState,
    qrCode: result.instance?.qrcode || undefined,
    pairingCode: result.instance?.paircode || undefined,
  };
}

// ============================================================
// 3.3 — Status polling
// ============================================================

export interface InstanceStatus {
  connectionState: ConnectionState;
  pairedPhone: string | null;
  pairedAt: string | null;
  qrCode?: string;
  pairingCode?: string;
}

/**
 * Poll the gateway and persist `connection_state` / `paired_phone` /
 * `paired_at`. A status poll that reports the instance leaving the
 * connected state never clears the paired number here — only a
 * user-initiated {@link disconnectInstance} does that
 * (whatsapp-connection spec, "Gateway reports a disconnection" vs.
 * "Disconnect").
 */
export async function readInstanceStatus(
  db: SupabaseClient,
  accountId: string,
): Promise<InstanceStatus> {
  const { row, token } = await requireInstance(db, accountId);

  const result = await uazapiFetch<{
    instance?: { status?: string; qrcode?: string; paircode?: string };
    status?: { connected?: boolean; jid?: { user?: string } | null };
  }>({ path: "/instance/status", method: "GET", token });

  const connectionState = normalizeConnectionState(result.instance?.status);
  const wasConnected = row.connection_state === "connected";
  const nowConnected = connectionState === "connected";

  const jidUser = result.status?.jid?.user;
  const pairedPhone =
    nowConnected && jidUser ? jidUser.replace(/\D/g, "") : row.paired_phone;
  const pairedAt =
    nowConnected && !wasConnected ? new Date().toISOString() : row.paired_at;

  const { error } = await db
    .from("whatsapp_config")
    .update({
      connection_state: connectionState,
      paired_phone: pairedPhone,
      paired_at: pairedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    console.error("[whatsapp/instance] status save failed:", error.message);
  }

  return {
    connectionState,
    pairedPhone,
    pairedAt,
    qrCode: result.instance?.qrcode || undefined,
    pairingCode: result.instance?.paircode || undefined,
  };
}

// ============================================================
// 3.4 — Disconnect
// ============================================================

export interface TeardownResult {
  /** The instance left running on the gateway, when the delete did not land. */
  orphan: { instanceId: string; name: string } | null;
}

/**
 * Delete the account's WhatsApp instance on the gateway and clear the
 * stored instance credentials, returning the account to the same
 * unconfigured state a never-connected account starts from — the next
 * login provisions a fresh instance (design.md D1/D2). There is no
 * separate "reset" action; disconnect always does this.
 *
 * The gateway `DELETE /instance` call is authenticated with the
 * account's own instance token, so it can only ever remove that
 * account's instance (design.md D4).
 *
 * Best-effort against the gateway: local state — including
 * `instance_id` / `instance_token` — is always cleared regardless of
 * what the gateway reports, since "no longer paired" is already true
 * locally the moment the operator asks for it. A gateway failure — a
 * rejected/stale instance token or a network failure — is caught,
 * logged and reported back as an `orphan` rather than thrown, matching
 * {@link ensureWebhookRegistered}'s non-fatal-failure pattern; a 404
 * for an instance that is already gone is the goal state and is
 * neither logged nor reported.
 *
 * An account with no provisioned instance is a no-op: `{ orphan: null }`
 * with no gateway call, so a double-disconnect (or an operator
 * deactivating an account that never connected) is idempotent rather
 * than a throw (design.md D1).
 */
export async function disconnectInstance(
  db: SupabaseClient,
  accountId: string,
): Promise<TeardownResult> {
  const row = await loadConfigRow(db, accountId);
  if (!row || !row.instance_id || !row.instance_token) {
    return { orphan: null };
  }

  const token = decrypt(row.instance_token);
  let orphan: TeardownResult["orphan"] = null;
  try {
    await uazapiFetch({ path: "/instance", method: "DELETE", token });
  } catch (err) {
    // A 404 means the instance is already gone — that is the outcome
    // we want, not a failure worth logging or reporting.
    if (!(err instanceof UazapiError) || err.status !== 404) {
      console.warn(
        "[whatsapp/instance] gateway instance delete failed during disconnect (non-fatal):",
        err instanceof Error ? err.message : err,
      );
      orphan = { instanceId: row.instance_id, name: instanceName(accountId) };
    }
  }

  const { error } = await db
    .from("whatsapp_config")
    .update({
      connection_state: "disconnected",
      instance_id: null,
      instance_token: null,
      paired_phone: null,
      paired_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    console.error("[whatsapp/instance] disconnect save failed:", error.message);
    throw new InstanceError(
      "gateway_error",
      "Deleted the gateway instance but failed to save the cleared state",
      500,
    );
  }

  return { orphan };
}

export { UazapiError };
