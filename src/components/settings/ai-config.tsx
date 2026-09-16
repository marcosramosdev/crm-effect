"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsPanelHead } from "./settings-panel-head";
import { AiKnowledgeCard } from "./ai-knowledge";
import type { FollowupStyle } from "@/lib/ai/types";
import type { AccountMember } from "@/types";
import { fetchAccountMembers, memberLabel } from "@/lib/account/members";
import { useTranslations } from "next-intl";

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = "__queue__";

const STYLES: FollowupStyle[] = [
  "friendly",
  "direct",
  "consultative",
  "slot_reminder",
];

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations("Settings.aiConfig");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [followupStyle, setFollowupStyle] =
    useState<FollowupStyle>("friendly");
  const [suggestsDrafts, setSuggestsDrafts] = useState(true);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState("");
  // Only ever true for a legacy account-owned row (no env credentials) —
  // there is no UI to set this key anymore, so it's read-only here.
  const [hasEmbeddingsKey, setHasEmbeddingsKey] = useState(false);
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in messaging-panel.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/config");
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("loadFailed"));
        return;
      }
      setConfigured(Boolean(data.configured));
      setSystemPrompt(data.system_prompt ?? "");
      setFollowupStyle(data.followup_style ?? "friendly");
      setSuggestsDrafts(data.is_active ?? true);
      setAutoReplyEnabled(data.auto_reply_enabled ?? false);
      setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
      setHandoffAgentId(data.handoff_agent_id ?? "");
      setHasEmbeddingsKey(Boolean(data.has_embeddings_key));
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  const buildBody = () => ({
    system_prompt: systemPrompt.trim() || null,
    followup_style: followupStyle,
    is_active: suggestsDrafts,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t("saveSuccess"));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t("saveFailed"));
      }
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch("/api/ai/config", { method: "DELETE" });
      if (res.ok) {
        toast.success(t("removeSuccess"));
        setConfigured(false);
        setSuggestsDrafts(true);
        setAutoReplyEnabled(false);
        setSystemPrompt("");
        setFollowupStyle("friendly");
        setHandoffAgentId("");
      } else {
        const data = await res.json();
        toast.error(data.error ?? t("removeFailed"));
      }
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("loading")}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {!canEdit && (
        <p className="border-border bg-muted/40 text-muted-foreground mb-4 rounded-md border px-3 py-2 text-sm">
          {t("adminOnlyConfig")}
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="text-primary h-4 w-4" /> {t("behaviour")}
            </CardTitle>
            <CardDescription>{t("behaviourDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t("businessContext")}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t("promptPlaceholder")}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("styleLabel")}</Label>
              <Select
                value={followupStyle}
                onValueChange={(v) => setFollowupStyle(v as FollowupStyle)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLES.map((style) => (
                    <SelectItem key={style} value={style}>
                      {t(`style.${style}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t("suggestsDrafts")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("suggestsDraftsDesc")}
                </p>
              </div>
              <Switch
                checked={suggestsDrafts}
                onCheckedChange={setSuggestsDrafts}
                disabled={disabled}
              />
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t("autoReply")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("autoReplyDesc")}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t("maxAutoReplies")}</Label>
                <p className="text-muted-foreground text-xs">
                  {t("maxAutoRepliesDesc")}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t("handoffTo")}</Label>
              <p className="text-muted-foreground text-xs">
                {t("handoffToDesc")}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? "" : v)
                }
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t("handoffQueue")}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={hasEmbeddingsKey}
        />

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t("remove")}
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
