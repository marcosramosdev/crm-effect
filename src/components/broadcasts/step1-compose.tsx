"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import type { BroadcastMediaKind } from "@/types";
import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

/** Chat-media bucket (migration 023) — same bucket the inbox composer uses. */
const CHAT_MEDIA_BUCKET = "chat-media";

/** WhatsApp's media-caption cap (also enforced server-side in send-message.ts). */
const CAPTION_MAX = 1024;

const PICKER_ACCEPT =
  "image/png,image/jpeg,image/webp,video/mp4,video/3gpp,audio/mpeg,audio/ogg,audio/aac,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain";

function classifyMediaKind(file: File): BroadcastMediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export interface BroadcastComposeState {
  /** Free-form body — the caption when an attachment is present. May
   *  contain `{{field}}` placeholders (broadcasts spec). */
  messageBody: string;
  mediaUrl: string | null;
  mediaKind: BroadcastMediaKind | null;
  mediaFilename: string | null;
  /** Storage object path — lets the wizard GC an attached-but-unsent file. */
  mediaPath: string | null;
}

export function blankBroadcastCompose(): BroadcastComposeState {
  return {
    messageBody: "",
    mediaUrl: null,
    mediaKind: null,
    mediaFilename: null,
    mediaPath: null,
  };
}

interface Step1Props {
  value: BroadcastComposeState;
  onUpdate: (value: BroadcastComposeState) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Step 1 of the broadcast wizard: compose a free-form message body,
 * optionally with one attachment. Replaces the old approved-template
 * picker (design.md D5) — broadcasts spec, "Free-form broadcast
 * composition" / "Template selection is no longer offered".
 */
export function Step1Compose({ value, onUpdate, onNext, onBack }: Step1Props) {
  const t = useTranslations("Broadcasts.wizard");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasAttachment = Boolean(value.mediaUrl);
  const bodyEmpty = !value.messageBody.trim();
  const isValid = !bodyEmpty || hasAttachment;

  async function handleFileSelected(file: File) {
    setError(null);
    const kind = classifyMediaKind(file);
    const limit = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > limit) {
      setError(
        t("compose.errorTooLarge", { mb: Math.floor(limit / (1024 * 1024)) }),
      );
      return;
    }

    setUploading(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(
        CHAT_MEDIA_BUCKET,
        file,
      );
      // Replacing an existing attachment — GC the one it replaces.
      if (value.mediaPath) {
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, value.mediaPath).catch(
          () => {},
        );
      }
      onUpdate({
        ...value,
        mediaUrl: publicUrl,
        mediaKind: kind,
        mediaFilename: file.name,
        mediaPath: path,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("compose.errorUpload"));
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment() {
    if (value.mediaPath) {
      void deleteAccountMedia(CHAT_MEDIA_BUCKET, value.mediaPath).catch(
        () => {},
      );
    }
    onUpdate({
      ...value,
      mediaUrl: null,
      mediaKind: null,
      mediaFilename: null,
      mediaPath: null,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t("compose.title")}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("compose.subtitle")}
        </p>
      </div>

      <div className="border-border bg-card/50 rounded-xl border p-4">
        <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
          {hasAttachment ? t("compose.caption") : t("compose.body")}
        </label>
        <Textarea
          value={value.messageBody}
          onChange={(e) => onUpdate({ ...value, messageBody: e.target.value })}
          maxLength={hasAttachment ? CAPTION_MAX : undefined}
          placeholder={t.raw("compose.bodyPlaceholder")}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground min-h-32"
        />
        <div className="mt-1 flex items-center justify-between">
          <p className="text-muted-foreground text-xs">
            {t.raw("compose.variableHint")}
          </p>
          {hasAttachment && (
            <span className="text-muted-foreground text-[10px]">
              {value.messageBody.length}/{CAPTION_MAX}
            </span>
          )}
        </div>
      </div>

      <div className="border-border bg-card/50 rounded-xl border p-4">
        <p className="text-foreground mb-3 text-sm font-medium">
          {t("compose.attachment")}
        </p>

        {!hasAttachment ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={PICKER_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFileSelected(file);
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="border-border text-muted-foreground"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              {uploading ? t("compose.uploading") : t("compose.addAttachment")}
            </Button>
          </>
        ) : (
          <div className="border-border bg-muted/40 flex items-center gap-3 rounded-lg border p-3">
            {value.mediaKind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value.mediaUrl!}
                alt=""
                className="h-12 w-12 shrink-0 rounded object-cover"
              />
            ) : value.mediaKind === "video" ? (
              <ImageIcon className="text-muted-foreground h-8 w-8 shrink-0" />
            ) : (
              <FileText className="text-muted-foreground h-8 w-8 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate text-sm">
                {value.mediaFilename}
              </p>
              <p className="text-muted-foreground text-xs uppercase">
                {value.mediaKind}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={removeAttachment}
              aria-label={t("compose.removeAttachment")}
              className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      <div className="border-border flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          {t("back")}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid || uploading}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t("next")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
