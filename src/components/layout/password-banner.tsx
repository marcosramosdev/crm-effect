"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Suggests the client change the password an operator delivered
 * during provisioning. Dismissible, non-blocking, never expires the
 * password — client-provisioning spec, "First sign-in suggests
 * changing the delivered password".
 *
 * Renders nothing once `password_banner_dismissed_at` is set, either
 * by dismissal here or by a successful password change
 * (src/components/settings/password-form.tsx).
 */
export function PasswordBanner() {
  const { profile, refreshProfile } = useAuth();
  const t = useTranslations("PasswordBanner");
  const [dismissing, setDismissing] = useState(false);

  if (!profile || profile.password_banner_dismissed_at) return null;

  const dismiss = async () => {
    setDismissing(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ password_banner_dismissed_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (!error) await refreshProfile();
    setDismissing(false);
  };

  return (
    <Alert className="mb-4">
      <KeyRound />
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>
        {t("desc")}{" "}
        <Link href="/settings?tab=security" className="underline">
          {t("changePassword")}
        </Link>
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={dismiss} disabled={dismissing}>
          {t("dismiss")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
