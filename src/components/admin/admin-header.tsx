"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LogOut, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// The console chrome: which operator is signed in, the link to the
// operator register (manager-only), and sign-out (admin-console
// spec.md, "An operator never enters a client surface" — "Signing out
// lives in the console"). Full-page navigation after sign-out, not
// router.push, for the same reason the login page uses one: the
// browser must carry a fresh request past middleware with the session
// already cleared (issue #365).
export function AdminHeader({
  email,
  isManager,
}: {
  email: string;
  isManager: boolean;
}) {
  const t = useTranslations("AdminConsole.chrome");

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <header className="border-border bg-card flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-4">
        <Link href="/admin" className="text-foreground text-sm font-semibold">
          {t("title")}
        </Link>
        {isManager && (
          <Link
            href="/admin/operators"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
          >
            <Users className="size-4" />
            {t("operatorsLink")}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">{email}</span>
        <Button type="button" variant="outline" size="sm" onClick={signOut}>
          <LogOut className="size-4" />
          {t("signOut")}
        </Button>
      </div>
    </header>
  );
}
