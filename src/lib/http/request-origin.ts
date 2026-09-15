// ============================================================
// Derive the externally-reachable origin of the running app from an
// incoming request. Shared by anything that has to build an absolute
// URL pointing back at this deployment — invite links
// (`/api/account/invitations`) and, since the UAZAPI migration, the
// WhatsApp webhook callback URL registered with the gateway
// (`src/lib/whatsapp/instance.ts`).
//
// Resolution order, first match wins:
//
//   1. `X-Forwarded-Host` (+ `X-Forwarded-Proto`) — set by every
//      reverse proxy in front of the app: Hostinger Managed Node.js,
//      Vercel, Cloudflare, nginx. This is what makes the derived
//      origin correct in production without an env var.
//   2. `Host` header + the protocol the request arrived on — bare
//      deployments without a proxy.
//
// Returns null when neither header is present (essentially
// impossible from a real request) or an allow-list was configured and
// neither candidate is on it — callers decide their own fallback,
// because "no confident origin" means different things to an invite
// link (fall back to a marketing domain) and a webhook registration
// (fail loudly rather than register the wrong callback).
//
// Defense-in-depth: `ALLOWED_INVITE_HOSTS`
//
//   On a typical proxied deploy (Vercel / Hostinger / Cloudflare) the
//   proxy overwrites these headers so they're trustworthy. On a bare
//   deployment exposed to the public internet, an attacker could send
//   a request with a crafted `Host: attacker.example` and get this
//   function to hand back a URL on their domain. When
//   `ALLOWED_INVITE_HOSTS` (comma-separated hostnames) is set, a
//   candidate not on the list is treated as unresolved.
// ============================================================

export function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true; // No allow-list → permissive (legacy behavior).
  return allowList.includes(hostname.toLowerCase());
}

/**
 * Best-effort origin (`https://host`, no trailing slash) this request
 * arrived at, or null if it can't be derived with confidence. Does
 * NOT consult `NEXT_PUBLIC_SITE_URL` — callers that want an explicit
 * operator override should check that env var themselves before
 * falling back to this.
 */
export function resolveRequestOrigin(request: Request): string | null {
  const allowList = parseAllowedHosts();

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host && isHostAllowed(host, allowList)) {
    // The protocol on `request.url` is whatever the framework saw —
    // reliable for bare deployments where no proxy is rewriting it.
    const reqProto = new URL(request.url).protocol.replace(":", "");
    return `${reqProto}://${host}`;
  }

  if (allowList && (forwardedHost || host)) {
    console.warn("[resolveRequestOrigin] rejected non-allow-listed host:", {
      forwardedHost,
      host,
      allowList,
    });
  }
  return null;
}
