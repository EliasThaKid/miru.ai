# SceneLab — hosted (token economy) runbook

Turning the localStorage demo into a hosted, multi-user product with a Stripe-metered token
economy. **Built Stripe-test-mode first**; going live is a one-env-var flip *after* the
go-live checklist. The $0 localStorage demo still works for anyone not signed in.

> Division of labor: the code, schema, RLS, and metering are in the repo. **You** own the
> accounts, the secrets, and the legal/tax pieces. No secret ever lives in the repo — the app
> reads everything from environment variables you set in Vercel and locally in `.env.local`
> (which is git-ignored and must never be committed).

---

## What you provision

1. **Supabase project** (Auth + Postgres + Storage). Copy from Project Settings → API:
   - Project URL and **anon** key → safe for the browser.
   - **service_role** key → server-only secret. Never ships to the client.
2. **Run the migration** `supabase/migrations/0001_init.sql` (Supabase SQL editor, or
   `supabase db push`). Then create a **Storage bucket** named `assets` (private).
3. **Stripe account** (start in **Test mode**). You'll need the test secret key, the publishable
   key, and — after you create the webhook endpoint — the webhook signing secret.
4. **Vercel project** pointed at this repo; set the env vars below in Project Settings.

## Environment variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...            # public, browser-safe
SUPABASE_SERVICE_ROLE_KEY=eyJ...                # SERVER ONLY — never expose

# AI providers (already used by the app; stay server-side)
FAL_KEY=...
ANTHROPIC_API_KEY=...

# Stripe (TEST keys first; swap to live only after the go-live checklist)
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Token economy config (server)
TOKENS_PER_STILL=1                              # cost to render one FLUX still
TOKENS_PER_CLIP=8                               # cost to animate one Kling clip
TOKENS_PER_BRIDGE=10                            # cost for a Kling O3 bridge
DAILY_TOKEN_CAP_PER_USER=400                    # hard per-user daily spend cap
GLOBAL_DAILY_TOKEN_CEILING=5000                 # kill-switch: stop all paid generation past this
```

> **Pricing math (do this before setting real numbers):** find fal's actual per-call price
> (FLUX/image, Kling 1.6/clip, Kling O3/bridge). Set each `TOKENS_PER_*` and your token-pack
> price so that **tokens sold × price-per-token > your fal cost + Stripe's 2.9% + 30¢** on
> every pack. If a clip costs you ~$0.40, a token must be worth clearly more than $0.05 at 8
> tokens/clip. Never sell tokens below cost.

## The safety model (why this can't quietly bankrupt you)

- **Server is the only authority on balances.** Clients can read their balance/ledger but have
  **no write grants**; tokens move only through the atomic `spend_tokens` / `refund_tokens` /
  `apply_purchase` functions in the migration.
- **Deduct-before-generate, refund-on-failure.** Every generation Server Action spends tokens
  first (atomic `UPDATE ... WHERE tokens >= amount`, so no double-spend), calls fal, and
  refunds if fal fails.
- **Hard caps + kill-switch.** Per-user daily cap and a global daily ceiling; past the ceiling,
  paid generation stops until you raise it. This is the circuit breaker against a scraper.
- **Idempotent purchases.** The Stripe webhook is signature-verified and credits via
  `apply_purchase`, which no-ops on a replayed session id.
- **Never trust a client token amount.** Costs come from server env, not the request body.

## Go-live checklist (do NOT flip to live Stripe keys until all true)

- [ ] **Legal/tax:** a real entity or individual on Stripe with tax info; Stripe Tax configured.
- [ ] **Policies published:** Terms of Service, Privacy Policy, and a Refund policy.
- [ ] **Unit economics verified:** measured fal per-call cost; token price clears cost + fees.
- [ ] **Content moderation:** a stated policy + the ability to ban a user; you accept that
      users generate on your fal/Anthropic keys and you're responsible under their ToS.
- [ ] **Budget ceiling set** (`GLOBAL_DAILY_TOKEN_CEILING`) and alerting on approach.
- [ ] **Webhook verified** end-to-end in test mode (a test purchase credits exactly once).
- [ ] Swap `sk_test_*` / `pk_test_*` → `sk_live_*` / `pk_live_*` and re-point the webhook.

## Phasing (tracked in the build)

1. **Schema + token ledger** (this migration) + runbook. ✅
2. Supabase auth (SSR) + move Project persistence to the DB (anon demo mode stays).
3. Metering wrapper on every generation (spend/refund) + caps + kill-switch.
4. Persist fal outputs into Storage (stills/clips) so projects don't rot.
5. Async Kling jobs (fal webhook/poll) for serverless reliability.
6. Stripe Checkout (test) + signature-verified webhook crediting.
