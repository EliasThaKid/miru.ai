import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Server-side Supabase client, scoped to the incoming request's auth cookies. Used from
// Server Actions, Route Handlers, and Server Components. `cookies()` is async in Next 16.
// This client acts AS THE SIGNED-IN USER (their JWT), so every query it runs is still
// subject to RLS — it is not the service role and can never move another user's tokens.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // `setAll` was called from a Server Component, where cookies are read-only.
            // Safe to ignore: the proxy refreshes the session cookie on the next request.
          }
        },
      },
    }
  )
}
