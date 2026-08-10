import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// OAuth (GitHub) and email-confirmation both redirect here with a `?code=`. We exchange it
// for a session (the server client writes the auth cookies) and send the user home. `next`
// lets a caller resume where they were; we only allow same-origin relative paths.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const nextParam = searchParams.get('next')
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/studio'

  // The provider can also come back with an error instead of a code (consent declined, or
  // an identity that cannot be linked). Log the real text, forward only a fixed code — the
  // description is provider-controlled and must never be rendered as our own copy.
  const providerError = searchParams.get('error')
  if (providerError) {
    console.warn(
      `[auth] provider returned ${providerError}: ${searchParams.get('error_description') ?? 'no description'}`
    )
    return NextResponse.redirect(`${origin}/sign-in?error=provider`)
  }

  if (!code) return NextResponse.redirect(`${origin}/sign-in?error=missing`)

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (!error) return NextResponse.redirect(`${origin}${next}`)

  // Most commonly: an email/password account already owns this email and the identity can't
  // be linked automatically. The message is the only way to tell those cases apart, so it is
  // logged in full even though the user sees a fixed string.
  console.warn(`[auth] code exchange failed: ${error.message}`)
  return NextResponse.redirect(`${origin}/sign-in?error=exchange`)
}
