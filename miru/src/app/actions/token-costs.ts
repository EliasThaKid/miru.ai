'use server'

import { tokenCost } from '@/lib/metering'

export interface TokenCosts {
  still: number
  clip: number
  bridge: number
}

// What the UI quotes before a paid action. Read from the same server-side `tokenCost` the
// charge itself uses, so a TOKENS_PER_* override can never leave the quoted price and the
// deducted price disagreeing — which is the failure mode that makes users distrust a meter.
//
// Read-only and safe to expose: these are list prices, not balances, and nothing here can
// spend, credit, or identify anyone.
export async function getTokenCosts(): Promise<TokenCosts> {
  return {
    still: tokenCost.still(),
    clip: tokenCost.clip(),
    bridge: tokenCost.bridge(),
  }
}
