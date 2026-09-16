"use client";

import { useTranslations } from "next-intl";
import { Bot } from "lucide-react";
import { AiConfig } from "@/components/settings/ai-config";

export default function AgentsPage() {
  const t = useTranslations("Agents");

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bot className="text-primary h-6 w-6" />
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          {t("title")}
        </h1>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{t("description")}</p>

      <div className="mt-6">
        <AiConfig />
      </div>
    </div>
  );
}
