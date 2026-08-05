import Stripe from 'stripe'

// Server-only Stripe client and the token-pack catalogue.
//
// The catalogue lives HERE, on the server, and is keyed by an opaque pack id. The browser
// sends only that id — never a price and never a token count — so a tampered request can buy
// a pack that exists or nothing at all. This is the same rule the metering wrapper follows:
// never let the client name the amount.

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!)
}

export interface TokenPack {
  id: string
  name: string
  tokens: number
  priceCents: number
}

// PRICING IS NOT VALIDATED ECONOMICS — see HOSTING.md. Before going live, measure fal's real
// per-call cost and confirm every pack clears cost + Stripe's 2.9% + 30¢. At 8 tokens/clip a
// token must be worth clearly more than a clip costs you divided by eight.
export const TOKEN_PACKS: TokenPack[] = [
  { id: 'starter', name: 'Starter', tokens: 100, priceCents: 900 },
  { id: 'creator', name: 'Creator', tokens: 500, priceCents: 3900 },
  { id: 'studio', name: 'Studio', tokens: 1500, priceCents: 9900 },
]

export function findPack(packId: string): TokenPack | null {
  return TOKEN_PACKS.find((pack) => pack.id === packId) ?? null
}
