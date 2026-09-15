"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Settings → Messaging: how inbound WhatsApp messages are stored and
 * routed. Split out of the old WhatsApp settings panel when connection
 * management moved to its own page — these two settings are not
 * connection concerns.
 */
export function MessagingPanel() {
  const t = useTranslations("Settings.messaging");
  const {
    user,
    accountId,
    loading: authLoading,
    profileLoading,
    canEditSettings,
  } = useAuth();

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [mirrorInbound, setMirrorInbound] = useState(true);
  const [savingMirror, setSavingMirror] = useState(false);

  // Default pipeline for new WhatsApp contacts (migration 041). Read and
  // written directly against `whatsapp_config`. '' means "None".
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [defaultStages, setDefaultStages] = useState<
    { id: string; name: string }[]
  >([]);
  const [defaultPipelineId, setDefaultPipelineId] = useState("");
  const [defaultStageId, setDefaultStageId] = useState("");
  const [savedDefault, setSavedDefault] = useState<{
    pipelineId: string;
    stageId: string;
  }>({ pipelineId: "", stageId: "" });
  const [savingDefault, setSavingDefault] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/config", { cache: "no-store" });
      const data = (await res.json()) as {
        configured?: boolean;
        mirror_inbound_media?: boolean;
      };
      setConfigured(Boolean(data.configured));
      setMirrorInbound(data.mirror_inbound_media !== false);
    } catch (err) {
      console.error("Failed to load messaging settings:", err);
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig();
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleToggleMirrorMedia(next: boolean) {
    if (!accountId || savingMirror) return;
    const previous = mirrorInbound;
    setMirrorInbound(next);
    setSavingMirror(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("whatsapp_config")
        .update({ mirror_inbound_media: next })
        .eq("account_id", accountId);
      if (error) throw new Error(error.message);
    } catch (error) {
      console.error("Failed to update media retention setting:", error);
      setMirrorInbound(previous);
      toast.error(t("mirrorInboundSaveFailed"));
    } finally {
      setSavingMirror(false);
    }
  }

  const loadDefaultPipeline = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [pipeRes, cfgRes] = await Promise.all([
      supabase.from("pipelines").select("id, name").order("created_at"),
      supabase
        .from("whatsapp_config")
        .select("inbound_default_pipeline_id, inbound_default_stage_id")
        .eq("account_id", accountId)
        .maybeSingle(),
    ]);
    setPipelines((pipeRes.data as { id: string; name: string }[] | null) ?? []);
    const pid =
      (cfgRes.data?.inbound_default_pipeline_id as string | null) ?? "";
    const sid = (cfgRes.data?.inbound_default_stage_id as string | null) ?? "";
    setDefaultPipelineId(pid);
    setDefaultStageId(sid);
    setSavedDefault({ pipelineId: pid, stageId: sid });
    if (pid) {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("id, name")
        .eq("pipeline_id", pid)
        .order("position");
      setDefaultStages((data as { id: string; name: string }[] | null) ?? []);
    } else {
      setDefaultStages([]);
    }
  }, [accountId]);

  useEffect(() => {
    if (!configured) return;
    void loadDefaultPipeline();
  }, [configured, loadDefaultPipeline]);

  const handleSelectDefaultPipeline = useCallback(
    async (pipelineId: string) => {
      setDefaultPipelineId(pipelineId);
      setDefaultStageId("");
      if (!pipelineId) {
        setDefaultStages([]);
        return;
      }
      const { data } = await createClient()
        .from("pipeline_stages")
        .select("id, name")
        .eq("pipeline_id", pipelineId)
        .order("position");
      setDefaultStages((data as { id: string; name: string }[] | null) ?? []);
    },
    [],
  );

  const defaultDirty =
    defaultPipelineId !== savedDefault.pipelineId ||
    defaultStageId !== savedDefault.stageId;
  // Either cleared (None: both empty) or fully set (both chosen) — never
  // a half-set write.
  const defaultComplete =
    defaultPipelineId === "" ? defaultStageId === "" : defaultStageId !== "";

  async function handleSaveDefaultPipeline() {
    if (!accountId || savingDefault || !defaultDirty || !defaultComplete)
      return;
    setSavingDefault(true);
    try {
      const { error } = await createClient()
        .from("whatsapp_config")
        .update({
          inbound_default_pipeline_id: defaultPipelineId || null,
          inbound_default_stage_id: defaultStageId || null,
        })
        .eq("account_id", accountId);
      if (error) throw new Error(error.message);
      setSavedDefault({
        pipelineId: defaultPipelineId,
        stageId: defaultStageId,
      });
      toast.success(t("defaultPipelineSaved"));
    } catch (err) {
      console.error("Failed to save default inbound pipeline:", err);
      toast.error(t("defaultPipelineSaveFailed"));
    } finally {
      setSavingDefault(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t("title")} description={t("description")} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <div className="max-w-2xl space-y-6">
        {!configured && (
          <p className="text-muted-foreground text-sm">{t("notConfigured")}</p>
        )}

        {/* Attachment retention */}
        {configured && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">
                {t("mediaTitle")}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t("mediaDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {t("mirrorInbound")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("mirrorInboundDesc")}
                  </p>
                  {!mirrorInbound && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                      {t("mirrorInboundOffWarning")}
                    </p>
                  )}
                </div>
                <Switch
                  checked={mirrorInbound}
                  onCheckedChange={handleToggleMirrorMedia}
                  disabled={savingMirror || !canEditSettings}
                  aria-label={t("mirrorInbound")}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Default pipeline for new WhatsApp contacts (migration 041) */}
        {configured && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">
                {t("defaultPipelineTitle")}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t("defaultPipelineDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:max-w-xs">
                <Label className="text-muted-foreground">
                  {t("defaultPipelineLabel")}
                </Label>
                <select
                  value={defaultPipelineId}
                  onChange={(e) => handleSelectDefaultPipeline(e.target.value)}
                  disabled={!canEditSettings || savingDefault}
                  className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{t("defaultPipelineNone")}</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {defaultPipelineId && (
                <div className="grid gap-2 sm:max-w-xs">
                  <Label className="text-muted-foreground">
                    {t("defaultStageLabel")}
                  </Label>
                  <select
                    value={defaultStageId}
                    onChange={(e) => setDefaultStageId(e.target.value)}
                    disabled={!canEditSettings || savingDefault}
                    className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">{t("defaultStagePlaceholder")}</option>
                    {defaultStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {canEditSettings && (
                <Button
                  onClick={handleSaveDefaultPipeline}
                  disabled={savingDefault || !defaultDirty || !defaultComplete}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {savingDefault ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t("defaultPipelineSaving")}
                    </>
                  ) : (
                    t("defaultPipelineSave")
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
