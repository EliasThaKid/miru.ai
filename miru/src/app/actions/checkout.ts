'use server'

import { headers } from 'next/headers'
import { findPack, getStripe, isStripeConfigured, TOKEN_PACKS, type TokenPack } from '@/lib/stripe'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createClient } from '@/lib/supabase/server'

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string }

// The catalogue is server-owned; this just exposes it for rendering. Prices shown here are
// never what gets charged — Checkout is built from the server-side pack.
export async function listTokenPacks(): Promise<TokenPack[]> {
  return TOKEN_PACKS
}

// Start a Stripe Checkout session for one pack.
//
// The client sends only a pack id. Price and token count come from the server catalogue, and
// the user id comes from the session cookie — never from the request body — so nobody can
// buy 1500 tokens for the price of 100, or credit somebody else's account.
export async function createCheckoutSession(packId: string): Promise<CheckoutResult> {
  if (!isSupabaseConfigured() || !isStripeConfigured()) {
    return { ok: false, error: 'Purchases are not available in the local demo.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Sign in to buy tokens.' }

  const pack = findPack(packId)
  if (!pack) return { ok: false, error: 'That token pack does not exist.' }

  // Build absolute return URLs from the request itself so this works on localhost, a LAN IP,
  // and Vercel without another env var to keep in sync.
  const headerList = await headers()
  const host = headerList.get('host')
  const proto = headerList.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      // Stripe emails the receipt here and reuses the customer on repeat purchases.
      customer_email: user.email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: pack.priceCents,
            product_data: {
              name: `SceneLab — ${pack.name}`,
              description: `${pack.tokens} generation tokens`,
            },
          },
        },
      ],
      // The webhook reads these back. They are set server-side and Stripe returns them
      // verbatim, so the credit can't be redirected or resized by the buyer.
      metadata: {
        user_id: user.id,
        pack_id: pack.id,
        tokens: String(pack.tokens),
      },
      // Back into the app, not to `/` — that is the marketing landing page now, so a buyer
      // was being returned to a signed-out-looking front door with no sign their purchase
      // landed. /studio at least shows the rail, where the new balance appears.
      success_url: `${origin}/studio?purchase=success`,
      cancel_url: `${origin}/studio?purchase=cancelled`,
    })

    if (!session.url) return { ok: false, error: 'Stripe did not return a checkout URL.' }
    return { ok: true, url: session.url }
  } catch (err) {
    console.error('[stripe] checkout session failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'Could not start checkout. Please try again.' }
  }
}
