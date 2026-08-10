'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'sign-in' | 'sign-up'

// One form for both routes. The Supabase browser client is only created inside handlers,
// so SSR prerender never needs the env vars — the anonymous demo keeps building/working
// even with Supabase unconfigured.
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<null | 'email' | 'github'>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isSignUp = mode === 'sign-up'

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy('email')
    setError(null)
    setNotice(null)
    try {
      const supabase = createClient()
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        })
        if (error) throw error
        // If email confirmation is off, a session comes back immediately → go home.
        // If it's on, there's no session yet and the user must confirm by email.
        if (data.session) {
          router.push('/studio')
          router.refresh()
          return
        }
        setNotice('Check your email to confirm your account, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.push('/studio')
        router.refresh()
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    }
    setBusy(null)
  }

  async function handleGithub() {
    setBusy('github')
    setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: `${location.origin}/auth/callback` },
      })
      if (error) throw error
      // On success the browser is redirected to GitHub; nothing else runs here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub sign-in failed. Try again.')
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-[13px] font-medium tracking-[0.24em] text-foreground">
          SCENELAB
        </p>

        <h1 className="text-lg font-medium text-foreground">
          {isSignUp ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="mt-1 mb-6 text-[13px] text-[var(--muted-foreground)]">
          {isSignUp
            ? 'New accounts start with a small token allowance for testing.'
            : 'Sign in to use your token balance across sessions.'}
        </p>

        {/* Consent sits ABOVE both account-creation paths. GitHub is one click and creates an
            account immediately, so consent placed under the form could be agreed to without
            ever having been on screen. */}
        {isSignUp ? (
          <p className="mb-5 text-[12px] leading-[1.6] text-[var(--text-tertiary)]">
            By creating an account you agree to the{' '}
            <Link href="/legal/terms" className="underline underline-offset-2 hover:text-foreground">
              Terms
            </Link>
            ,{' '}
            <Link href="/legal/acceptable-use" className="underline underline-offset-2 hover:text-foreground">
              Acceptable Use Policy
            </Link>
            , and{' '}
            <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="h-9 w-full"
          onClick={handleGithub}
          disabled={busy !== null}
        >
          {busy === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
        </Button>

        <div className="my-5 flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
          <span className="h-px flex-1 bg-white/10" />
          OR
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={handleEmail} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="mt-1 h-9 w-full" disabled={busy !== null}>
            {busy === 'email'
              ? isSignUp
                ? 'Creating account…'
                : 'Signing in…'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
          </Button>
        </form>

        {error ? <p className="mt-4 text-[13px] text-destructive">{error}</p> : null}
        {notice ? <p className="mt-4 text-[13px] text-foreground">{notice}</p> : null}

        <p className="mt-6 text-center text-[13px] text-[var(--muted-foreground)]">
          {isSignUp ? (
            <>
              Already have an account?{' '}
              <Link href="/sign-in" className="text-foreground underline underline-offset-4">
                Sign in
              </Link>
            </>
          ) : (
            <>
              Don&apos;t have an account?{' '}
              <Link href="/sign-up" className="text-foreground underline underline-offset-4">
                Sign up
              </Link>
            </>
          )}
        </p>

        <p className="mt-8 text-center text-[12px] text-[var(--text-tertiary)]">
          <Link href="/studio" className="hover:text-foreground">
            ← Continue without an account (demo)
          </Link>
        </p>

        <p className="mt-4 flex justify-center gap-3 text-[11px] text-[var(--text-tertiary)]">
          <Link href="/legal/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/legal/refunds" className="hover:text-foreground">
            Refunds
          </Link>
        </p>
      </div>
    </div>
  )
}
