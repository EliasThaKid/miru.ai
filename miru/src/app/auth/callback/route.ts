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

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth`)
}
