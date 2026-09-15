"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { moveDealStage, moveDealToPipeline } from "@/lib/inbox/deals";
import { DealStagePicker } from "./deal-stage-picker";
import { DealPipelinePicker } from "./deal-pipeline-picker";
import { DealForm } from "@/components/pipelines/deal-form";
import type {
  Contact,
  Deal,
  ContactNote,
  Pipeline,
  PipelineStage,
  Tag,
} from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  GitBranch,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { dateFnsLocale } from "@/i18n/date-fns-locale";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  const tStage = useTranslations("Inbox.stagePicker");
  const locale = useLocale();

  const { accountId } = useAuth();
  // Read-only members see stages, but can't change them (roles.ts: agent+
  // can "move deals"). Mirrors the composer's `send-messages` gate.
  const isViewer = useCan("view-only");
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Full deal detail view, opened from a deal row. Viewers get it
  // read-only (DealForm gates every control on `send-messages`).
  const [detailDeal, setDetailDeal] = useState<Deal | null>(null);

  // "Add to pipeline" mini-form — only reachable when the contact has no
  // deal. Pipelines + their stages are loaded lazily when it's opened.
  const [pipelineFormOpen, setPipelineFormOpen] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [chosenPipelineId, setChosenPipelineId] = useState("");
  const [chosenStageId, setChosenStageId] = useState("");
  const [savingPipeline, setSavingPipeline] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*), pipeline:pipelines(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  // Optimistic stage move — mirrors the pipeline board's `handleDealMoved`:
  // paint immediately, then persist; on failure re-fetch to reconcile.
  const handleMoveStage = useCallback(
    async (dealId: string, stage: PipelineStage) => {
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId ? { ...d, stage_id: stage.id, stage } : d,
        ),
      );
      const result = await moveDealStage(createClient(), dealId, stage.id);
      if (!result.ok) {
        toast.error(tStage("moveFailed"));
        fetchContactData();
      }
    },
    [fetchContactData, tStage],
  );

  // Optimistic pipeline move — same shape as handleMoveStage, but
  // reassigns pipeline_id + the landing stage in one write.
  const handleMovePipeline = useCallback(
    async (dealId: string, pipeline: Pipeline, stage: PipelineStage) => {
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId
            ? {
                ...d,
                pipeline_id: pipeline.id,
                pipeline,
                stage_id: stage.id,
                stage,
              }
            : d,
        ),
      );
      const result = await moveDealToPipeline(
        createClient(),
        dealId,
        pipeline.id,
        stage.id,
      );
      if (!result.ok) {
        toast.error(tStage("moveFailed"));
        fetchContactData();
      }
    },
    [fetchContactData, tStage],
  );

  // Load a pipeline's stages and default the stage picker to the first one.
  const loadStagesForPipeline = useCallback(async (pipelineId: string) => {
    if (!pipelineId) {
      setPipelineStages([]);
      setChosenStageId("");
      return;
    }
    const { data } = await createClient()
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true });
    const rows = (data as PipelineStage[] | null) ?? [];
    setPipelineStages(rows);
    setChosenStageId(rows[0]?.id ?? "");
  }, []);

  const handleChoosePipeline = useCallback(
    (pipelineId: string) => {
      setChosenPipelineId(pipelineId);
      void loadStagesForPipeline(pipelineId);
    },
    [loadStagesForPipeline],
  );

  const openPipelineForm = useCallback(async () => {
    setPipelineFormOpen(true);
    if (pipelines.length > 0) return;
    const { data } = await createClient()
      .from("pipelines")
      .select("*")
      .order("created_at");
    const rows = (data as Pipeline[] | null) ?? [];
    setPipelines(rows);
    if (rows[0]) {
      setChosenPipelineId(rows[0].id);
      void loadStagesForPipeline(rows[0].id);
    }
  }, [pipelines.length, loadStagesForPipeline]);

  const handleAddToPipeline = useCallback(async () => {
    if (!contact || !accountId || !chosenPipelineId || !chosenStageId) return;
    setSavingPipeline(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    const { data, error } = await supabase
      .from("deals")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        pipeline_id: chosenPipelineId,
        stage_id: chosenStageId,
        title: contact.name || contact.phone,
        value: 0,
        status: "open",
      })
      .select("*, stage:pipeline_stages(*)")
      .single();
    setSavingPipeline(false);
    if (error || !data) {
      toast.error(tSidebar("addToPipelineError"));
      return;
    }
    setDeals((prev) => [data as Deal, ...prev]);
    setPipelineFormOpen(false);
  }, [contact, accountId, chosenPipelineId, chosenStageId, tSidebar]);

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-70 items-center justify-center border-l">
        <p className="text-muted-foreground text-sm">
          {tThread("selectConversation")}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="border-border bg-card flex h-full w-70 flex-col border-l">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="bg-muted text-foreground flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="text-foreground mt-3 text-sm font-semibold">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-muted-foreground text-xs">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <Phone className="text-muted-foreground h-4 w-4" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="text-primary h-3 w-3" />
              ) : (
                <Copy className="text-muted-foreground h-3 w-3" />
              )}
            </button>

            {contact.email && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Mail className="text-muted-foreground h-4 w-4" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Tags */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar("noTags")}
                </p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Active Deals */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground px-1 text-xs">
                    {tSidebar("noDeals")}
                  </p>
                  {!isViewer && !pipelineFormOpen && (
                    <button
                      type="button"
                      onClick={openPipelineForm}
                      className="text-primary inline-flex items-center gap-1.5 rounded-lg px-1 text-xs font-medium hover:underline"
                    >
                      <GitBranch className="h-3 w-3" />
                      {tSidebar("addToPipeline")}
                    </button>
                  )}
                  {!isViewer && pipelineFormOpen && (
                    <div className="bg-muted space-y-2 rounded-lg px-3 py-3">
                      {pipelines.length === 0 ? (
                        <p className="text-muted-foreground text-xs">
                          {tSidebar("noPipelines")}
                        </p>
                      ) : (
                        <>
                          <label className="text-muted-foreground block text-[10px] font-medium tracking-wider uppercase">
                            {tSidebar("choosePipeline")}
                          </label>
                          <select
                            value={chosenPipelineId}
                            onChange={(e) =>
                              handleChoosePipeline(e.target.value)
                            }
                            className="border-border bg-card text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
                          >
                            {pipelines.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <label className="text-muted-foreground block text-[10px] font-medium tracking-wider uppercase">
                            {tSidebar("chooseStage")}
                          </label>
                          <select
                            value={chosenStageId}
                            onChange={(e) => setChosenStageId(e.target.value)}
                            className="border-border bg-card text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
                          >
                            {pipelineStages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setPipelineFormOpen(false)}
                          className="text-muted-foreground hover:bg-card rounded-md px-2 py-1 text-xs"
                        >
                          {tSidebar("addToPipelineCancel")}
                        </button>
                        <Button
                          size="sm"
                          className="bg-primary hover:bg-primary/90 h-7 px-3 text-xs"
                          disabled={
                            savingPipeline ||
                            pipelines.length === 0 ||
                            !chosenStageId
                          }
                          onClick={handleAddToPipeline}
                        >
                          {tSidebar("addToPipelineConfirm")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="bg-muted rounded-lg px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-foreground text-sm font-medium">
                        {deal.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => setDetailDeal(deal)}
                        title={tSidebar("openDealDetails")}
                        aria-label={tSidebar("openDealDetails")}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-xs">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      <DealStagePicker
                        dealId={deal.id}
                        pipelineId={deal.pipeline_id}
                        stage={deal.stage}
                        disabled={isViewer}
                        onMove={handleMoveStage}
                        align="end"
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                        {tSidebar("pipeline")}
                      </span>
                      <DealPipelinePicker
                        currentPipelineId={deal.pipeline_id}
                        currentPipelineName={deal.pipeline?.name}
                        disabled={isViewer}
                        onMove={(pipeline, stage) =>
                          handleMovePipeline(deal.id, pipeline, stage)
                        }
                        align="end"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Notes */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm", {
                        locale: dateFnsLocale(locale),
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {detailDeal && (
        <DealForm
          open={!!detailDeal}
          onOpenChange={(o) => {
            if (!o) setDetailDeal(null);
          }}
          deal={detailDeal}
          // Empty sentinel — never equals the deal's real pipeline id, so
          // DealForm fetches that pipeline's stages itself instead of
          // trusting a `stages` prop the inbox doesn't have.
          pipelineId=""
          stages={[]}
          defaultStageId={detailDeal.stage_id}
          onSaved={fetchContactData}
        />
      )}
    </div>
  );
}
