"use client";

import { useCallback, useState } from "react";
import { Check, ChevronDown, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Pipeline, PipelineStage } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchPipelineStages } from "./deal-stage-picker";

/**
 * Move a deal to a DIFFERENT pipeline from the inbox contact sidebar.
 *
 * The trigger shows the deal's current pipeline; opening it lists every
 * pipeline. The current one is inert (just a check); any other expands
 * to that pipeline's stages, and picking a stage calls `onMove` with
 * the target pipeline id and the chosen stage — the deal lands there in
 * one action. Stage lists are memoised per pipeline via
 * `fetchPipelineStages` (shared with `DealStagePicker`). When `disabled`
 * (a read-only member) it collapses to a static label with no picker.
 */

let pipelineListCache: Pipeline[] | null = null;

interface DealPipelinePickerProps {
  /** Pipeline the deal is currently on — rendered inert in the list. */
  currentPipelineId: string;
  /** Label for the trigger before the pipeline list loads. */
  currentPipelineName?: string | null;
  disabled?: boolean;
  /** Fired with the target pipeline and the chosen landing stage. */
  onMove: (pipeline: Pipeline, stage: PipelineStage) => void;
  align?: "start" | "end";
}

export function DealPipelinePicker({
  currentPipelineId,
  currentPipelineName,
  disabled = false,
  onMove,
  align = "end",
}: DealPipelinePickerProps) {
  const t = useTranslations("Inbox.pipelinePicker");
  const [open, setOpen] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>(
    () => pipelineListCache ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [stagesByPipeline, setStagesByPipeline] = useState<
    Record<string, PipelineStage[]>
  >({});

  const label = currentPipelineName ?? "—";

  const loadPipelines = useCallback(async () => {
    if (pipelineListCache || loading) return;
    setLoading(true);
    const { data } = await createClient()
      .from("pipelines")
      .select("*")
      .order("created_at", { ascending: true });
    const rows = (data as Pipeline[] | null) ?? [];
    pipelineListCache = rows;
    setPipelines(rows);
    setLoading(false);
  }, [loading]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) void loadPipelines();
    },
    [loadPipelines],
  );

  const loadStages = useCallback(async (pipelineId: string) => {
    const rows = await fetchPipelineStages(pipelineId);
    setStagesByPipeline((prev) => ({ ...prev, [pipelineId]: rows }));
  }, []);

  if (disabled) {
    return (
      <span
        className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        title={label}
      >
        <GitBranch className="h-3 w-3 shrink-0 opacity-70" />
        <span className="max-w-24 truncate">{label}</span>
      </span>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        title={t("movePipeline", { pipeline: label })}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "bg-muted text-muted-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        )}
      >
        <GitBranch className="h-3 w-3 shrink-0 opacity-70" />
        <span className="max-w-24 truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="border-border bg-popover max-h-64 w-52 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && pipelines.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-xs">
            {t("loading")}
          </div>
        ) : (
          pipelines.map((p) =>
            p.id === currentPipelineId ? (
              <DropdownMenuItem
                key={p.id}
                disabled
                className="text-muted-foreground flex items-center gap-2 text-sm"
              >
                <span className="flex-1 truncate">{p.name}</span>
                <Check className="text-primary h-3.5 w-3.5 shrink-0" />
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub key={p.id}>
                <DropdownMenuSubTrigger
                  onPointerEnter={() => void loadStages(p.id)}
                  onFocus={() => void loadStages(p.id)}
                  className="text-popover-foreground text-sm"
                >
                  <span className="flex-1 truncate">{p.name}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="border-border bg-popover max-h-64 w-48 overflow-y-auto">
                  {(stagesByPipeline[p.id] ?? []).length === 0 ? (
                    <div className="text-muted-foreground px-2 py-1.5 text-xs">
                      {t("loading")}
                    </div>
                  ) : (
                    (stagesByPipeline[p.id] ?? []).map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        onClick={() => {
                          setOpen(false);
                          onMove(p, s);
                        }}
                        className="text-popover-foreground flex items-center gap-2 text-sm"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="flex-1 truncate">{s.name}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ),
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
