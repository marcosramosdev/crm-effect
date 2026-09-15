"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isValidE164 } from "@/lib/whatsapp/phone-utils";
import type { Contact } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog is pinned to this contact: the recipient is
   *  shown as static text (no contact/number toggle, no `<select>`) and
   *  the full contacts list isn't fetched — only `whatsapp_config`, so
   *  the no-connection guard is identical to the inbox flow. Used by the
   *  contacts area's "Message" entry points. */
  presetContactId?: string;
}

type Mode = "contact" | "number";

/**
 * Start a conversation with a recipient who hasn't messaged in first
 * (inbox spec, "Start a new conversation from the app"). Pick a saved
 * contact or type any number, then either send a first message (contact
 * + thread created only if the send succeeds) or open the thread
 * without sending (created immediately). Both land the agent in the
 * resulting conversation via `/inbox?c=<id>`.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  presetContactId,
}: NewConversationDialogProps) {
  const t = useTranslations("Inbox.newConversation");
  const supabase = createClient();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("contact");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState("");
  const [presetContact, setPresetContact] = useState<Contact | null>(null);
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<null | "send" | "open">(null);
  const [connection, setConnection] = useState<"checking" | "ok" | "missing">(
    "checking",
  );

  // Reset the form each time the dialog opens — a legitimate
  // prop-driven sync, hence the block-level rule disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setMode("contact");
    setContactId(presetContactId ?? "");
    setPresetContact(null);
    setPhone("");
    setMessage("");
    setBusy(null);
    setConnection("checking");
    let cancelled = false;
    (async () => {
      // Preset: skip the contacts-list fetch (recipient is fixed); just
      // resolve this one contact's label and the connection state.
      const [contactsRes, configRes] = await Promise.all([
        presetContactId
          ? supabase
              .from("contacts")
              .select("*")
              .eq("id", presetContactId)
              .maybeSingle()
          : supabase.from("contacts").select("*").order("name"),
        supabase.from("whatsapp_config").select("id").maybeSingle(),
      ]);
      if (cancelled) return;
      if (presetContactId) {
        setPresetContact((contactsRes.data ?? null) as Contact | null);
      } else {
        setContacts((contactsRes.data ?? []) as Contact[]);
      }
      setConnection(configRes.data ? "ok" : "missing");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase, presetContactId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** The resolved target for the API calls, or null if incomplete/invalid. */
  function target():
    | { kind: "contact"; contact_id: string }
    | { kind: "number"; to: string }
    | null {
    if (mode === "contact") {
      return contactId ? { kind: "contact", contact_id: contactId } : null;
    }
    const trimmed = phone.trim();
    if (!isValidE164(trimmed)) return null;
    return { kind: "number", to: trimmed };
  }

  function landIn(conversationId: string) {
    onOpenChange(false);
    router.push(`/inbox?c=${conversationId}`);
  }

  async function handleSend() {
    const tgt = target();
    if (!tgt) {
      toast.error(mode === "number" ? t("invalidNumber") : t("pickContact"));
      return;
    }
    if (!message.trim()) {
      toast.error(t("messageRequired"));
      return;
    }
    setBusy("send");
    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(tgt.kind === "contact"
          ? { contact_id: tgt.contact_id }
          : { to: tgt.to }),
        message_type: "text",
        content_text: message.trim(),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      toast.error(json.error || t("sendFailed"));
      return;
    }
    landIn(json.conversation_id);
  }

  async function handleOpenThread() {
    const tgt = target();
    if (!tgt) {
      toast.error(mode === "number" ? t("invalidNumber") : t("pickContact"));
      return;
    }
    setBusy("open");
    const res = await fetch("/api/whatsapp/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        tgt.kind === "contact"
          ? { contact_id: tgt.contact_id }
          : { to: tgt.to },
      ),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      toast.error(json.error || t("openFailed"));
      return;
    }
    landIn(json.conversation_id);
  }

  const canProceed = target() !== null && connection === "ok";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("desc")}
          </DialogDescription>
        </DialogHeader>

        {connection === "missing" ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
            {t("noConnection")}
          </p>
        ) : (
          <div className="space-y-4">
            {presetContactId ? (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t("contactLabel")}
                </Label>
                <p className="border-border bg-muted text-foreground rounded-lg border px-2.5 py-2 text-sm">
                  {presetContact?.name ||
                    presetContact?.phone ||
                    t("selectContact")}
                </p>
              </div>
            ) : (
              <>
                {/* Recipient */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "contact" ? "default" : "outline"}
                    onClick={() => setMode("contact")}
                    className={
                      mode === "contact"
                        ? "bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground"
                    }
                  >
                    {t("savedContact")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "number" ? "default" : "outline"}
                    onClick={() => setMode("number")}
                    className={
                      mode === "number"
                        ? "bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground"
                    }
                  >
                    {t("newNumber")}
                  </Button>
                </div>

                {mode === "contact" ? (
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">
                      {t("contactLabel")}
                    </Label>
                    <select
                      value={contactId}
                      onChange={(e) => setContactId(e.target.value)}
                      className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
                    >
                      <option value="">{t("selectContact")}</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.phone}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">
                      {t("numberLabel")}
                    </Label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+14155550123"
                      inputMode="tel"
                      className="border-border bg-muted text-foreground"
                    />
                    {phone.trim() !== "" && !isValidE164(phone.trim()) && (
                      <p className="text-xs text-red-400">
                        {t("invalidNumber")}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* First message */}
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                {t("messageLabel")}
              </Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("messagePlaceholder")}
                className="border-border bg-muted text-foreground min-h-[80px]"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={handleSend}
                disabled={!canProceed || !message.trim() || busy !== null}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
              >
                {busy === "send" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {t("send")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenThread}
                disabled={!canProceed || busy !== null}
                className="border-border text-muted-foreground hover:bg-muted flex-1"
              >
                {busy === "open" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquarePlus className="h-4 w-4" />
                )}
                {t("openThread")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
