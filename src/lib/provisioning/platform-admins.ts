/**
 * Platform-operator allow-list. Membership is the only credential
 * `/admin` checks — not an account role (client-provisioning
 * design.md D5). `PLATFORM_ADMINS` is a plain (non-`NEXT_PUBLIC_`)
 * env var so the list never reaches the client bundle; it is still
 * readable from Edge middleware, which runs server-side regardless
 * of that prefix.
 *
 * Unset or empty matches nobody — never treat a misconfigured
 * deployment as wide open.
 */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.PLATFORM_ADMINS;
  if (!raw) return false;

  const target = email.trim().toLowerCase();
  if (!target) return false;

  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}
