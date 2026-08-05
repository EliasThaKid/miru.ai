import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, isStripeConfigured } from '@/lib/stripe'
import { createAdminClient, isServiceRoleConfigured } from '@/lib/supabase/admin'

// Stripe webhook — the ONLY thing in the app that creates tokens from money.
//
// Trust model: this endpoint is public and anyone can POST to it, so nothing in the body is
// believed until the Stripe signature verifies against STRIPE_WEBHOOK_SECRET. A forged
// "payment succeeded" without the signing secret is rejected before it can credit anything.
//
// Everything after verification is Stripe's own copy of the session we created, including
// the metadata we set server-side — the buyer never gets to name the user or the amount.
//
// Crediting goes through apply_purchase, which inserts the purchase row first and no-ops on
// a duplicate session id, so Stripe's at-least-once delivery (and its retries) can't
// double-credit.

// Signature verification needs the EXACT bytes Stripe signed, so the body must be read raw.
// Node runtime, not edge: the Stripe SDK's crypto path expects it.
export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe] webhook hit but Stripe is not configured')
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  if (!isServiceRoleConfigured()) {
    // Returning 500 makes Stripe retry, which is what we want: the payment is real and the
    // credit is owed, so this must not be silently swallowed.
    console.error('[stripe] cannot credit purchase: SUPABASE_SERVICE_ROLE_KEY is not set')
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 })

  const payload = await request.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    // Bad signature, replayed timestamp, or tampered body — never credit on any of these.
    console.error('[stripe] signature verification failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge everything else so Stripe stops retrying events we don't act on.
    return NextResponse.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session

  // A session can complete unpaid (e.g. an async payment method still processing). Only a
  // paid session is money in hand.
  if (session.payment_status !== 'paid') {
    console.warn(`[stripe] session ${session.id} completed but payment_status=${session.payment_status}`)
    return NextResponse.json({ received: true })
  }

  const userId = session.metadata?.user_id
  const tokens = Number.parseInt(session.metadata?.tokens ?? '', 10)
  if (!userId || !Number.isFinite(tokens) || tokens <= 0) {
    // Our own metadata is missing — a real payment we cannot attribute. 200 (retrying won't
    // help) but loud, because someone has paid and must be credited by hand.
    console.error(`[stripe] UNATTRIBUTABLE PAID SESSION ${session.id}: metadata=`, session.metadata)
    return NextResponse.json({ received: true })
  }

  const { error } = await createAdminClient().rpc('apply_purchase', {
    p_user_id: userId,
    p_session_id: session.id,
    p_tokens: tokens,
    p_amount_cents: session.amount_total ?? 0,
  })

  if (error) {
    // 500 so Stripe retries; apply_purchase is idempotent, so a retry after a partial failure
    // is safe and a duplicate delivery credits nothing.
    console.error(`[stripe] apply_purchase failed for session ${session.id}:`, error.message)
    return NextResponse.json({ error: 'credit failed' }, { status: 500 })
  }

  console.log(`[stripe] credited ${tokens} tokens to ${userId} (session ${session.id})`)
  return NextResponse.json({ received: true })
}
