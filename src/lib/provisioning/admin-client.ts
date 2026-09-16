import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy, shared service-role client for provisioning. Mirrors
// src/lib/ai/admin-client.ts, src/lib/flows/admin-client.ts and
// src/lib/automations/admin-client.ts — provisioning runs from an
// operator's own session with no membership in the account it's
// creating, so it needs RLS bypassed deliberately (design.md D2).
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}
