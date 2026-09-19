import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";
import { isManager, resolvePlatformOperator } from "@/lib/provisioning/platform-admins";
import { AdminHeader } from "@/components/admin/admin-header";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

// The /admin guard runs in src/middleware.ts (platform-admin-profiles
// design.md D5) — this layout supplies the console chrome (who is
// signed in, the operator-register link, sign-out), not a second
// authorization check.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const operator = await resolvePlatformOperator(supabase, user);

  return (
    <>
      <AdminHeader email={user?.email ?? ""} isManager={isManager(operator)} />
      {children}
    </>
  );
}
