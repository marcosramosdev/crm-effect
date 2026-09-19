import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";

import { OperatorRegister } from "@/components/admin/operator-register";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";
import { listOperators } from "@/lib/admin/operators";

export const dynamic = "force-dynamic";

// Manager-only: src/middleware.ts refuses this path to the admin role
// (design.md D5). Reads the register through the service-role client,
// like the rest of /admin — the table's only RLS policy is "read your
// own row" (migration 051).
export default async function AdminOperatorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const operators = await listOperators(supabaseAdmin());
  const t = await getTranslations("AdminOperators");

  return (
    <div className="bg-background flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-3xl flex-col gap-8">
        <div>
          <Link
            href="/admin"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ChevronLeft className="size-4" />
            {t("back")}
          </Link>
          <h1 className="text-foreground mt-2 text-2xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("desc")}</p>
        </div>
        <OperatorRegister operators={operators} currentUserId={user?.id ?? null} />
      </div>
    </div>
  );
}
