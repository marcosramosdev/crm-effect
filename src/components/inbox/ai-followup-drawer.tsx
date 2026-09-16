"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FollowupStyle } from "@/lib/ai/types";

const STYLES: FollowupStyle[] = ["friendly", "direct", "consultative", "slot_reminder"];

// Radix Select can't use an empty-string item value — this sentinel maps
// to "use the account's default style" (no `style` override in the body).
const ACCOUNT_DEFAULT = "__account_default__";

interface AiFollowupDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
}

/**
 * Review drawer for the "AI follow-up" action (specs/followups/spec.md,
 * "A quiet lead can be answered with an AI-drafted follow-up"). Drafts
 * via `POST /api/ai/draft` with `mode: "followup"`; NEVER sends by
 * itself — the member edits, then explicitly presses Send. Closing the
 * drawer (Escape, backdrop click, or the X) sends nothing: there is no
 * send path other than the Send button below.
 */
export function AiFollowupDrawer({
  open,
  onOpenChange,
  conversationId,
}: AiFollowupDrawerProps) {
  const t = useTranslations("Inbox.aiFollowup");

  const [style, setStyle] = useState<string>(ACCOUNT_DEFAULT);
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [noHistory, setNoHistory] = useState(false);

  const generate = useCallback(async () => {
    setDrafting(true);
    setNoHistory(false);
    setDraft("");
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          mode: "followup",
          ...(style !== ACCOUNT_DEFAULT ? { style } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "no_messages") {
          setNoHistory(true);
        } else if (data.code === "ai_not_configured") {
          toast.error(t("notConfigured"));
        } else {
          toast.error(data.error ?? t("draftFailed"));
        }
        return;
      }
      setDraft(typeof data.draft === "string" ? data.draft.trim() : "");
    } catch {
      toast.error(t("draftFailed"));
    } finally {
      setDrafting(false);
    }
  }, [conversationId, style, t]);

  // Generate on open (and whenever the style picker changes while open).
  useEffect(() => {
    if (open) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, style]);

  useEffect(() => {
    if (!open) {
      setStyle(ACCOUNT_DEFAULT);
      setDraft("");
      setNoHistory(false);
    }
  }, [open]);

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_type: "text",
          content_text: text,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("sendFailed"));
        return;
      }
      toast.success(t("sent"));
      onOpenChange(false);
    } catch {
      toast.error(t("sendFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground w-full p-0 sm:max-w-lg"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-border/50 border-b p-4">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="text-primary h-4 w-4" />
              {t("title")}
            </SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="space-y-1.5">
              <label className="text-muted-foreground text-xs font-medium">
                {t("styleLabel")}
              </label>
              <Select
                value={style}
                onValueChange={(v) => setStyle(v ?? ACCOUNT_DEFAULT)}
                disabled={drafting}
              >
                <SelectTrigger className="bg-muted border-border text-foreground w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ACCOUNT_DEFAULT}>
                    {t("styleDefault")}
                  </SelectItem>
                  {STYLES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`style_${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {drafting ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="text-primary h-5 w-5 animate-spin" />
              </div>
            ) : noHistory ? (
              <p className="text-muted-foreground border-border bg-muted/40 rounded-lg border border-dashed p-4 text-sm">
                {t("noHistory")}
              </p>
            ) : (
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs font-medium">
                  {t("draftLabel")}
                </label>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={8}
                  className="bg-muted border-border text-foreground"
                />
              </div>
            )}
          </div>

          <SheetFooter className="border-border/50 flex-row justify-end gap-2 border-t p-4">
            <Button
              type="button"
              variant="outline"
              disabled={drafting}
              onClick={() => void generate()}
            >
              {t("regenerate")}
            </Button>
            <Button
              type="button"
              disabled={drafting || sending || !draft.trim()}
              onClick={handleSend}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("send")
              )}
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
