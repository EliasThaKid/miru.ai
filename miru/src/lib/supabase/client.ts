import { createBrowserClient } from '@supabase/ssr'

// True only when both public Supabase env vars are present. Callers use this to keep the
// anonymous localStorage demo fully working when Supabase isn't configured yet — creating a
// client with undefined URL/key would otherwise throw.
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

// Browser-side Supabase client. URL + anon key are public by design (they ship to the
// client and are protected by row-level security). Only ever call this from a client
// component's event handler or effect — never at module scope or during render, so the
// anonymous demo (and the production build's prerender) never needs these env vars set.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
