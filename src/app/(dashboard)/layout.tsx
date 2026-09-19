import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolvePlatformOperator } from "@/lib/provisioning/platform-admins";
import { getCurrentAccount, AccountSuspendedError } from "@/lib/auth/account";
import { DashboardShell } from "./dashboard-shell";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
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

// Where a member of a deactivated account is turned away
// (admin-console spec.md, "A deactivated account's people cannot use
// the product"). Every API route already refuses them through
// `getCurrentAccount`; this is what stops them looking at a shell that
// answers 403 to everything.
//
// The session is dropped on the login screen rather than here: a server
// component cannot clear cookies (`setAll` swallows the write in
// `@/lib/supabase/server`), so `/login?suspended=1` signs out with the
// browser client and shows the notice.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // A platform operator is a member of no client account (admin-console
  // spec.md, "An operator never enters a client surface"; design.md
  // D5/D6). Checked before getCurrentAccount(): handle_new_user already
  // gave every operator identity an account of its own, so that call
  // would otherwise resolve successfully for them instead of turning
  // them away.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const operator = await resolvePlatformOperator(supabase, user);
  if (operator) {
    redirect("/admin");
  }

  try {
    await getCurrentAccount();
  } catch (err) {
    if (err instanceof AccountSuspendedError) {
      redirect("/login?suspended=1");
    }
    // Anything else — no session, an unlinked profile — is left to the
    // shell and the middleware, exactly as before this check existed.
  }

  return <DashboardShell>{children}</DashboardShell>;
}
