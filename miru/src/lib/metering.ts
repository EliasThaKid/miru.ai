import { createAdminClient, isServiceRoleConfigured } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/client'

// Server-side token metering for paid generations. This module is only ever imported by
// 'use server' actions (and transitively pulls in next/headers), so it can never be bundled
// into client code. Costs and caps come from server env — never from the client request.

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Per-generation token costs (server-authoritative). Defaults mirror HOSTING.md.
export const tokenCost = {
  still: () => envInt('TOKENS_PER_STILL', 1),
  clip: () => envInt('TOKENS_PER_CLIP', 8),
  bridge: () => envInt('TOKENS_PER_BRIDGE', 10),
}

const dailyCapPerUser = () => envInt('DAILY_TOKEN_CAP_PER_USER', 400)
const globalDailyCeiling = () => envInt('GLOBAL_DAILY_TOKEN_CEILING', 5000)

export type BeginResult =
  | { ok: true; refund: () => Promise<void> }
  | { ok: false; error: string }

// Reserve tokens BEFORE a paid generation. Call this only after an action's free
// early-returns (cached asset, validation), so nothing is charged for a no-op.
//
//  - Supabase unconfigured (local dev / the $0 demo)     → unmetered passthrough.
//  - Configured but no signed-in user                     → refuse (demo uses cached assets).
//  - Configured + signed in                               → atomic spend with caps enforced.
//
// On success returns a `refund()` the action must call if the generation then fails, so a
// provider error never costs the user tokens. `refund()` is idempotent.
export async function beginGeneration(
  amount: number,
  reason: `spend:${string}`,
  ref: string
): Promise<BeginResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, refund: async () => {} }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Sign in to generate — the live demo uses pre-generated assets.' }
  }

  const { error } = await supabase.rpc('spend_tokens', {
    p_amount: amount,
    p_reason: reason,
    p_ref: ref,
    p_daily_cap: dailyCapPerUser(),
    p_global_ceiling: globalDailyCeiling(),
  })
  if (error) {
    return { ok: false, error: friendlySpendError(error.message, amount) }
  }

  let refunded = false
  return {
    ok: true,
    refund: async () => {
      if (refunded) return
      refunded = true
      await refundSpend(user.id, amount, reason.replace(/^spend:/, 'refund:'), ref)
    },
  }
}

// Credit tokens back after a failed generation. This runs with the SERVICE ROLE, never the
// user's JWT: `refund_tokens` is no longer callable by `authenticated` (see
// 0004_refund_hardening.sql), because a user-reachable "add tokens to my balance" RPC is an
// unlimited-money bug. `refund_spend` additionally refuses to exceed what was really spent
// against this ref, so a bug here cannot mint tokens either.
//
// Exported so async job completion (Phase 5) refunds through exactly this path.
export async function refundSpend(
  userId: string,
  amount: number,
  reason: string,
  ref: string
): Promise<void> {
  if (!isServiceRoleConfigured()) {
    // Loud, because the user has been charged for work that failed. Reconcile from the
    // ledger and set SUPABASE_SERVICE_ROLE_KEY — refunds cannot run without it.
    console.error(
      `[metering] REFUND SKIPPED (${amount} tokens, ref=${ref}): SUPABASE_SERVICE_ROLE_KEY is not set.`
    )
    return
  }

  const { error } = await createAdminClient().rpc('refund_spend', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_ref: ref,
  })
  // A failed refund is logged server-side but never surfaced — the original generation error
  // is what the user needs to see, and the refund can be reconciled from the ledger.
  if (error) console.error('[metering] refund failed:', error.message)
}

// Map raised Postgres exceptions to user-facing copy. The messages arrive as the exception
// text (e.g. 'INSUFFICIENT_TOKENS') inside error.message.
function friendlySpendError(message: string, amount: number): string {
  if (message.includes('INSUFFICIENT_TOKENS'))
    return `Not enough tokens — this generation needs ${amount}. Top up to continue.`
  if (message.includes('DAILY_CAP_EXCEEDED'))
    return "You've reached today's generation limit. It resets at midnight UTC."
  if (message.includes('GLOBAL_CEILING_EXCEEDED'))
    return 'Generation is paused for today — the system-wide daily limit was reached. Please try again tomorrow.'
  if (message.includes('ACCOUNT_SUSPENDED'))
    return 'This account is suspended and cannot generate. Contact support if you believe this is a mistake.'
  if (message.includes('NOT_AUTHENTICATED')) return 'Sign in to generate.'
  return 'Could not reserve tokens for this generation. Please try again.'
}
