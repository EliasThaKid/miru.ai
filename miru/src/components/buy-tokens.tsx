'use client'

import { useState } from 'react'
import { createCheckoutSession, listTokenPacks } from '@/app/actions/checkout'
import type { TokenPack } from '@/lib/stripe'

// Token purchase for the left rail. Packs are fetched from the server catalogue rather than
// hardcoded here: the browser only ever sends a pack id back, so what is displayed can never
// become what is charged.
export function BuyTokens() {
  const [packs, setPacks] = useState<TokenPack[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setError(null)
    if (!packs) setPacks(await listTokenPacks())
  }

  async function buy(packId: string) {
    setBusyId(packId)
    setError(null)
    const result = await createCheckoutSession(packId)
    if (result.ok) {
      // Full navigation to Stripe's hosted page — card details never touch this app.
      window.location.assign(result.url)
      return
    }
    setError(result.error)
    setBusyId(null)
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        className="self-start text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
      >
        {open ? 'Close' : 'Buy tokens'}
      </button>

      {open ? (
        <div className="flex flex-col gap-1 pt-1">
          {packs === null ? (
            <span className="text-[11px] text-[var(--text-tertiary)]">Loading…</span>
          ) : (
            packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => buy(pack.id)}
                disabled={busyId !== null}
                className="flex items-baseline justify-between gap-2 text-left text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:opacity-40"
              >
                <span>
                  {pack.name} · {pack.tokens} tokens
                </span>
                <span>${(pack.priceCents / 100).toFixed(2)}</span>
              </button>
            ))
          )}
          {error ? <span className="text-[11px] text-destructive">{error}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
