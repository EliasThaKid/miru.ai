import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role Supabase client — bypasses RLS entirely. This key is a server-only secret and
// must never be imported by a client component or embedded in a response. It exists for the
// two operations a user's own JWT must NOT be able to perform:
//   * crediting tokens (refunds, and later Stripe purchases), and
//   * writing job state the user could otherwise forge.
//
// Sessions are disabled: there is no user to persist and no cookie to refresh.
export function isServiceRoleConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
