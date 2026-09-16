"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Loader2,
  Pencil,
  Send,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { dateFnsLocale } from "@/i18n/date-fns-locale";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface PendingFollowup {
  id: string;
  status: "pending" | "approved";
  offset_minutes: number;
  body: string;
  appointment_confirmed: boolean;
  last_error: string | null;
  scheduled_at: string | null;
  contact_name: string | null;
}

type DealJoin = {
  scheduled_at: string | null;
  contact: { name: string | null } | { name: string | null }[] | null;
} | null;

interface RawRow {
  id: string;
  status: string;
  offset_minutes: number;
  body: string;
  appointment_confirmed: boolean;
  last_error: string | null;
  deal: DealJoin | DealJoin[];
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * "Pending approval" section on `/notifications` — the account-wide
 * follow-up queue (specs/followups/spec.md, "No follow-up leaves the
 * account without a human release"). Lists `pending` rows plus
 * `approved` rows whose send previously failed (so a retry stays
 * reachable), and offers Approve / Reject / Edit-and-send.
 *
 * A read-only member sees the list but not the three actions
 * (`useCan("send-messages")` mirrors the `agent`-role RLS backstop on
 * `followup_messages_update`).
 */
export function PendingFollowupsSection() {
  const t = useTranslations("Notifications.followups");
  const locale = useLocale();
  const { accountId, timeZone } = useAuth();
  const canAct = useCan("send-messages");

  const [rows, setRows] = useState<PendingFollowup[] | null>(null);
  const [lastTick, setLastTick] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [{ data, error }, { data: tickRow }] = await Promise.all([
      supabase
        .from("followup_messages")
        .select(
          "id, status, offset_minutes, body, appointment_confirmed, last_error, deal:deals(scheduled_at, contact:contacts(name))",
        )
        .eq("account_id", accountId)
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: true }),
      supabase
        .from("followup_cron_state")
        .select("last_tick_at")
        .eq("id", true)
        .maybeSingle(),
    ]);
    if (error) {
      console.error("[followups] load failed:", error.message);
      return;
    }
    const mapped = ((data ?? []) as unknown as RawRow[]).map((r) => {
      const deal = firstOf(r.deal);
      const contact = deal ? firstOf(deal.contact) : null;
      return {
        id: r.id,
        status: r.status as "pending" | "approved",
        offset_minutes: r.offset_minutes,
        body: r.body,
        appointment_confirmed: r.appointment_confirmed,
        last_error: r.last_error,
        scheduled_at: deal?.scheduled_at ?? null,
        contact_name: contact?.name ?? null,
      };
    });
    setRows(mapped);
    setLastTick((tickRow?.last_tick_at as string | undefined) ?? null);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const act = useCallback(
    async (id: string, action: "approve" | "reject" | "edit_and_send", body?: string) => {
      setActingId(id);
      try {
        const res = await fetch(`/api/followups/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "edit_and_send" ? { action, body } : { action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(
            data.code === "already_decided" ? t("alreadyDecided") : data.error || t("actionFailed"),
          );
          await load();
          return;
        }
        setEditingId(null);
        setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev);
        toast.success(t(`toast_${action}`));
      } catch {
        toast.error(t("actionFailed"));
      } finally {
        setActingId(null);
      }
    },
    [load, t],
  );

  if (rows === null) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="text-primary h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
          <BellRing className="text-primary h-4 w-4" />
          {t("title")}
        </h2>
        <span className="text-muted-foreground text-xs">
          {lastTick
            ? t("lastTick", {
                time: formatDistanceToNow(new Date(lastTick), {
                  addSuffix: true,
                  locale: dateFnsLocale(locale),
                }),
              })
            : t("lastTickNever")}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground border-border bg-muted/40 rounded-xl border border-dashed p-4 text-sm">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const isEditing = editingId === row.id;
            const isActing = actingId === row.id;
            return (
              <li
                key={row.id}
                className={cn(
                  "border-border bg-card rounded-xl border p-4",
                  row.last_error && "border-destructive/40",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-medium">
                      {row.contact_name || t("unknownLead")}
                    </p>
                    {row.scheduled_at && (
                      <p className="text-muted-foreground text-xs">
                        {new Date(row.scheduled_at).toLocaleString(locale, {
                          timeZone,
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                    )}
                  </div>
                  {row.appointment_confirmed && (
                    <span className="text-primary flex items-center gap-1 text-xs font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t("alreadyConfirmed")}
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    className="bg-muted border-border text-foreground mt-2"
                  />
                ) : (
                  <p className="text-foreground/90 mt-2 text-sm whitespace-pre-wrap">
                    {row.body}
                  </p>
                )}

                {row.last_error && (
                  <p className="text-destructive mt-2 flex items-start gap-1.5 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    {row.last_error}
                  </p>
                )}

                {canAct && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <Button
                          size="sm"
                          disabled={isActing || !editText.trim()}
                          onClick={() => act(row.id, "edit_and_send", editText.trim())}
                          className="bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                          <Send className="mr-1 h-3.5 w-3.5" />
                          {t("sendEdited")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isActing}
                          onClick={() => setEditingId(null)}
                        >
                          {t("cancelEdit")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          disabled={isActing}
                          onClick={() => act(row.id, "approve")}
                          className="bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                          {isActing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="mr-1 h-3.5 w-3.5" />
                          )}
                          {row.status === "approved" ? t("retry") : t("approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isActing}
                          onClick={() => {
                            setEditingId(row.id);
                            setEditText(row.body);
                          }}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          {t("edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isActing}
                          onClick={() => act(row.id, "reject")}
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          {t("reject")}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
