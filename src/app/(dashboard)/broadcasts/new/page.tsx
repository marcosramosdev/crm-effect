"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  Step1Compose,
  blankBroadcastCompose,
  type BroadcastComposeState,
} from "@/components/broadcasts/step1-compose";
import { Step2SelectAudience } from "@/components/broadcasts/step2-select-audience";
import { Step3Personalize } from "@/components/broadcasts/step3-personalize";
import { Step4ScheduleSend } from "@/components/broadcasts/step4-schedule-send";
import { useBroadcastSending } from "@/hooks/use-broadcast-sending";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

const steps = [
  { label: "compose", key: "compose" },
  { label: "audience", key: "audience" },
  { label: "personalize", key: "personalize" },
  { label: "send", key: "send" },
] as const;

export default function NewBroadcastPage() {
  const router = useRouter();
  const t = useTranslations("Broadcasts.new");
  const { accountId } = useAuth();
  const { createAndSendBroadcast, isProcessing, progress } =
    useBroadcastSending();

  const [currentStep, setCurrentStep] = useState(0);
  const [compose, setCompose] = useState<BroadcastComposeState>(
    blankBroadcastCompose(),
  );
  const [audience, setAudience] = useState<{
    type: "all" | "tags" | "custom_field" | "csv";
    tagIds?: string[];
    customField?: {
      fieldId: string;
      operator: "is" | "is_not" | "contains";
      value: string;
    };
    csvContacts?: { phone: string; name?: string }[];
    excludeTagIds?: string[];
  }>({ type: "all" });
  const [variableDefaults, setVariableDefaults] = useState<
    Record<string, string>
  >({});
  const [name, setName] = useState("");

  async function handleSend() {
    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        compose,
        audience: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          csvContacts: audience.csvContacts,
          excludeTagIds: audience.excludeTagIds,
        },
        variableDefaults,
      });
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      // Previously swallowed with console.error — the wizard would
      // just no-op, leaving the user confused. Surface the reason.
      const message = err instanceof Error ? err.message : "Broadcast failed";
      console.error("Broadcast failed:", err);
      toast.error(message);
    }
  }

  /**
   * Writes a draft broadcast row — no recipients, no sending. The user
   * can revisit it via the list page to finish the flow later.
   */
  async function handleSaveDraft() {
    if (!compose.messageBody.trim() && !compose.mediaUrl) {
      toast.error(t("toastGiveMessage"));
      return;
    }
    if (!name.trim()) {
      toast.error(t("toastGiveName"));
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error(t("toastNotSignedIn"));
      return;
    }
    if (!accountId) {
      toast.error(t("toastNotLinked"));
      return;
    }

    const { error } = await supabase.from("broadcasts").insert({
      user_id: user.id,
      account_id: accountId,
      name: name.trim(),
      message_body: compose.messageBody,
      media_url: compose.mediaUrl,
      media_kind: compose.mediaKind,
      media_filename: compose.mediaFilename,
      variable_defaults: variableDefaults,
      audience_filter: {
        type: audience.type,
        tagIds: audience.tagIds,
      },
      status: "draft",
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });

    if (error) {
      toast.error(t("toastFailedDraft", { error: error.message }));
      return;
    }
    toast.success(t("toastDraftSaved"));
    router.push("/broadcasts");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("subtitle")}</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    isCompleted
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "border-primary bg-primary/10 text-primary border-2"
                        : "border-border bg-muted text-muted-foreground border"
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isActive
                      ? "text-foreground"
                      : isCompleted
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  {t(`steps.${step.label}`)}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-3 h-px flex-1 ${
                    index < currentStep ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="relative min-h-[400px]">
        <div
          className="transition-all duration-300 ease-in-out"
          style={{
            opacity: isProcessing ? 0.6 : 1,
            pointerEvents: isProcessing ? "none" : "auto",
          }}
        >
          {currentStep === 0 && (
            <Step1Compose
              value={compose}
              onUpdate={setCompose}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push("/broadcasts")}
            />
          )}
          {currentStep === 1 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={setAudience}
              onNext={() => setCurrentStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && (
            <Step3Personalize
              messageBody={compose.messageBody}
              variableDefaults={variableDefaults}
              onUpdate={setVariableDefaults}
              onNext={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}
          {currentStep === 3 && (
            <Step4ScheduleSend
              name={name}
              onNameChange={setName}
              messageBody={compose.messageBody}
              mediaKind={compose.mediaKind}
              audience={audience}
              onSend={handleSend}
              onSaveDraft={handleSaveDraft}
              onBack={() => setCurrentStep(2)}
              isProcessing={isProcessing}
              progress={progress}
            />
          )}
        </div>
      </div>
    </div>
  );
}
