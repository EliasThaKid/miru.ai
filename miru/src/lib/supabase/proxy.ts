import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the Supabase auth session on every request and rewrites the auth cookies onto
// the response, so server-rendered routes and Server Actions always see a fresh session.
// Called from the root `proxy.ts` (Next 16's renamed middleware). If the Supabase env vars
// aren't set (e.g. a pure anonymous/demo deploy), it no-ops and passes the request through.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return response

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Touch the user to trigger a token refresh when needed. Do NOT run any logic between
  // creating the client and this call — that's the documented @supabase/ssr footgun.
  await supabase.auth.getUser()

  return response
}
