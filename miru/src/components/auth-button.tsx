'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { BuyTokens } from '@/components/buy-tokens'

// Account control for the left rail. Anonymous users see a "Sign in" link (the demo keeps
// working without an account); signed-in users see their email, live token balance, and a
// sign-out button. The browser client is created inside the effect only, so this never
// forces the env vars at build/prerender time.
export function AuthButton() {
  const [email, setEmail] = useState<string | null>(null)
  const [tokens, setTokens] = useState<number | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // No Supabase configured → stay a pure demo; render nothing (no account UI).
    if (!isSupabaseConfigured()) return
    const supabase = createClient()
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function loadBalance(userId: string) {
      const { data } = await supabase
        .from('token_balances')
        .select('tokens')
        .eq('user_id', userId)
        .maybeSingle()
      if (active) setTokens(data?.tokens ?? 0)
    }

    // Live balance: subscribe to this user's token_balances row so the count ticks down as
    // generations spend (RLS ensures only their own row is received).
    function subscribe(userId: string) {
      channel = supabase
        .channel(`token-balance:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'token_balances', filter: `user_id=eq.${userId}` },
          (payload) => {
            const next = (payload.new as { tokens?: number } | null)?.tokens
            if (active && typeof next === 'number') setTokens(next)
          }
        )
        .subscribe()
    }

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      setEmail(data.user?.email ?? null)
      setReady(true)
      if (data.user) {
        loadBalance(data.user.id)
        subscribe(data.user.id)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const user = session?.user ?? null
      setEmail(user?.email ?? null)
      setTokens(null)
      if (user) loadBalance(user.id)
    })

    return () => {
      active = false
      if (channel) supabase.removeChannel(channel)
      sub.subscription.unsubscribe()
    }
  }, [])

  // Unconfigured (pure demo) renders no account UI at all.
  if (!isSupabaseConfigured()) return null

  if (!ready) {
    return <div className="h-9" aria-hidden />
  }

  if (!email) {
    return (
      <Link
        href="/sign-in"
        className="flex w-full items-center py-1.5 text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
      >
        Sign in
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] text-foreground" title={email}>
          {email}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] tracking-[0.04em] text-[var(--text-tertiary)]">
          {tokens === null ? '— tokens' : `${tokens} token${tokens === 1 ? '' : 's'}`}
        </span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
      <BuyTokens />
    </div>
  )
}
