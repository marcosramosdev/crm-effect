"use client";

import { useCallback, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Inline pipeline-stage control shared by the inbox contact sidebar and the
 * conversation-list row. Renders the deal's current stage as a coloured
 * trigger; opening it lists every stage of the deal's pipeline (ordered by
 * `position`) and selecting one calls `onMove`. When `disabled` (a
 * read-only member) it collapses to a static badge with no picker.
 *
 * Stages are fetched lazily on first open and memoised per pipeline so the
 * conversation list doesn't issue one query per row.
 */

const stageCache = new Map<string, PipelineStage[]>();

/**
 * Load a pipeline's stages (ordered by `position`), memoised per
 * pipeline id so the conversation list and the sidebar's pipeline
 * mover don't each re-query. Shared with `DealPipelinePicker`.
 */
export async function fetchPipelineStages(
  pipelineId: string,
): Promise<PipelineStage[]> {
  const cached = stageCache.get(pipelineId);
  if (cached) return cached;
  const { data } = await createClient()
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });
  const rows = (data as PipelineStage[] | null) ?? [];
  stageCache.set(pipelineId, rows);
  return rows;
}

interface DealStagePickerProps {
  dealId: string;
  pipelineId: string;
  /** Current stage — drives the trigger label/colour before stages load. */
  stage?: PipelineStage | null;
  /** Icon-only trigger for the dense conversation-list row. */
  compact?: boolean;
  /** Read-only member: render a static badge, no dropdown. */
  disabled?: boolean;
  /** Called with the full target stage so callers can paint optimistically. */
  onMove: (dealId: string, stage: PipelineStage) => void;
  align?: "start" | "end";
}

function stageStyle(color?: string | null) {
  return color ? { backgroundColor: `${color}20`, color } : undefined;
}

export function DealStagePicker({
  dealId,
  pipelineId,
  stage,
  compact = false,
  disabled = false,
  onMove,
  align = "start",
}: DealStagePickerProps) {
  const t = useTranslations("Inbox.stagePicker");
  const [stages, setStages] = useState<PipelineStage[]>(
    () => stageCache.get(pipelineId) ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const currentName = stage?.name ?? "—";
  const currentColor = stage?.color;

  const loadStages = useCallback(async () => {
    if (stageCache.has(pipelineId) || loading) return;
    setLoading(true);
    setStages(await fetchPipelineStages(pipelineId));
    setLoading(false);
  }, [pipelineId, loading]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) void loadStages();
    },
    [loadStages],
  );

  if (disabled) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
          !currentColor && "bg-muted text-muted-foreground",
        )}
        style={stageStyle(currentColor)}
        title={currentName}
      >
        <span className={compact ? "max-w-20 truncate" : undefined}>
          {currentName}
        </span>
      </span>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        title={t("changeStage", { stage: currentName })}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-medium transition-colors hover:opacity-80",
          compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10px]",
          !currentColor && "bg-muted text-muted-foreground hover:bg-muted/70",
        )}
        style={stageStyle(currentColor)}
      >
        <span className={compact ? "max-w-20 truncate" : "max-w-24 truncate"}>
          {currentName}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="border-border bg-popover max-h-64 w-48 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && stages.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-xs">
            {t("loading")}
          </div>
        ) : (
          stages.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => {
                setOpen(false);
                if (s.id !== stage?.id) onMove(dealId, s);
              }}
              className="text-popover-foreground flex items-center gap-2 text-sm"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="flex-1 truncate">{s.name}</span>
              {s.id === stage?.id && (
                <Check className="text-primary h-3.5 w-3.5 shrink-0" />
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
