import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  INCOMPLETE_FEATURES_ENABLED,
  isGatedFeaturePath,
} from "@/lib/feature-flags";
import { isManager, resolvePlatformOperator } from "@/lib/provisioning/platform-admins";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  };

  // Root path - send straight to destination instead of bouncing through
  // /dashboard first (which would then redirect again to /login). A
  // platform operator has no client account (platform-admin-profiles
  // design.md D5) — signing in sends them to /admin, never /dashboard.
  if (request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    if (user) {
      const operator = await resolvePlatformOperator(supabase, user);
      url.pathname = operator ? "/admin" : "/dashboard";
    } else {
      url.pathname = "/login";
    }
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  // `/login?suspended=1` is the one sign-in URL a signed-in visitor is
  // allowed to reach: the dashboard layout sends a member of a
  // deactivated account here so the page can drop their session and
  // say why (admin-client-lifecycle design.md D3). Bouncing them to
  // /dashboard would loop them straight back.
  const suspended = request.nextUrl.searchParams.get("suspended");

  if (
    user &&
    !(request.nextUrl.pathname === "/login" && suspended) &&
    (request.nextUrl.pathname === "/login" ||
      request.nextUrl.pathname === "/signup" ||
      request.nextUrl.pathname === "/forgot-password")
  ) {
    const url = request.nextUrl.clone();
    const inviteToken = request.nextUrl.searchParams.get("invite");
    if (
      inviteToken &&
      (request.nextUrl.pathname === "/login" ||
        request.nextUrl.pathname === "/signup")
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
      url.search = "";
    } else {
      // Platform operators land on /admin instead (design.md D5).
      const operator = await resolvePlatformOperator(supabase, user);
      url.pathname = operator ? "/admin" : "/dashboard";
      url.search = "";
    }
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Public self-service signup is closed unless a team invitation
  // token is present (client-provisioning spec, "Sign-up without an
  // invitation is refused"). A signed-in visitor at /signup is already
  // redirected above regardless of the invite param.
  if (
    !user &&
    request.nextUrl.pathname === "/signup" &&
    !request.nextUrl.searchParams.get("invite")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Internal provisioning console — gated by the platform-operator
  // register (env seed or table row), not any client-account role. A
  // non-operator session gets the same treatment as a gated feature
  // path, so /admin is indistinguishable from a route that doesn't
  // exist (client-provisioning spec, "Ordinary client owner is turned
  // away"). The operator register itself is manager-only
  // (admin-console spec.md, "No operator can remove or promote
  // themselves") — an admin-role operator is bounced back to /admin,
  // not treated as a non-operator.
  if (request.nextUrl.pathname.startsWith("/admin")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return withRefreshedCookies(NextResponse.redirect(url));
    }
    const operator = await resolvePlatformOperator(supabase, user);
    if (!operator) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return withRefreshedCookies(NextResponse.redirect(url));
    }
    if (
      request.nextUrl.pathname.startsWith("/admin/operators") &&
      !isManager(operator)
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      url.search = "";
      return withRefreshedCookies(NextResponse.redirect(url));
    }
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = [
    "/dashboard",
    "/inbox",
    "/contacts",
    "/pipelines",
    "/broadcasts",
    "/automations",
    "/flows",
    "/agents",
    "/settings",
  ];
  if (
    !user &&
    protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Incomplete features (Broadcasts, Automations, Flows) are hidden from
  // operators by default — their code stays in the tree, but typing or
  // bookmarking the URL bounces to the dashboard. The AI assistant
  // (/agents) is not part of this set and is never redirected. Runs
  // after the auth check so an unauthenticated hit still goes to /login
  // first.
  if (
    !INCOMPLETE_FEATURES_ENABLED &&
    isGatedFeaturePath(request.nextUrl.pathname)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // API routes that need auth (not webhooks)
  if (
    !user &&
    request.nextUrl.pathname.startsWith("/api/whatsapp/") &&
    !request.nextUrl.pathname.includes("/webhook")
  ) {
    return withRefreshedCookies(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
