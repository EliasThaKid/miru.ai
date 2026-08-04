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
2. **Run the migrations in order** — `0001_init.sql`, `0002_metering.sql`, `0003_storage.sql`
   (Supabase SQL editor, or `supabase db push`). `0003` creates the private `assets` bucket
   and its owner-scoped policies, so there is nothing to create by hand in the dashboard.
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

## Auth activation (Phase 2 — do this to turn on sign-in)

The code degrades gracefully: with **no** Supabase env vars set, the app is the original
`$0` localStorage demo and shows no account UI. Sign-in turns on the moment these are set.

1. **Add the two public vars to `.env.local`** (and later to Vercel). They are browser-safe:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://nysycmzhznthcgvyzfxg.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...        # the anon/public key
   ```
2. **Email/password:** Supabase dashboard → Authentication → Providers → **Email = ON**.
   For instant test signups, toggle **"Confirm email" OFF** (turn it back on before going
   live). With it on, new users must click an emailed link before signing in.
3. **GitHub OAuth:**
   - GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
     - Homepage URL: your app URL (e.g. `http://localhost:3000` for dev).
     - **Authorization callback URL:**
       `https://nysycmzhznthcgvyzfxg.supabase.co/auth/v1/callback`
   - Copy the Client ID + generate a Client Secret.
   - Supabase dashboard → Authentication → Providers → **GitHub = ON**, paste both.
4. **Redirect URLs:** Supabase → Authentication → URL Configuration → add your Site URL
   (`http://localhost:3000` in dev, your Vercel URL in prod) so the `/auth/callback` return
   is allowed.

That's it — restart `npm run dev`, and the left rail shows Sign in / your email + token
balance. Projects for signed-in users now persist server-side (RLS-scoped to the user).

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
2. **Supabase auth (SSR) + Project persistence in the DB** (anon demo mode stays). ✅
   Sign-in at `/sign-in` (email/password + GitHub); session refresh via `src/proxy.ts`
   (Next 16 renamed `middleware` → `proxy`); signed-in projects live in the `projects`
   table, anonymous stays on localStorage. **To activate, see "Auth activation" below.**
3. **Metering wrapper on every generation** (spend/refund) + caps + kill-switch. ✅
   Every paid action reserves tokens before the fal call and refunds on failure; a cached
   or invalid request is free. Signed-out users can't trigger generation once Supabase is
   configured (the demo uses cached assets). Per-user daily cap + global daily ceiling are
   enforced *atomically inside* `spend_tokens` (see `0002_metering.sql`) and passed by the
   server from env — never by the client. **Run `supabase/migrations/0002_metering.sql`**
   (SQL editor or `supabase db push`) before this takes effect. Costs/caps come from the
   `TOKENS_PER_*`, `DAILY_TOKEN_CAP_PER_USER`, and `GLOBAL_DAILY_TOKEN_CEILING` env vars
   (defaults apply if unset). To grant yourself test tokens, run this in the SQL editor
   (no `auth.uid()` there, so match by email):
   `update token_balances set tokens = 500 where user_id = (select id from auth.users where email = 'you@example.com');`
   — or raise the welcome grant in `0001_init.sql`.
4. **Persist fal outputs into Storage** (stills/clips) so projects don't rot. ✅
   **Run `supabase/migrations/0003_storage.sql`** — it creates the private `assets` bucket
   and owner-scoped `storage.objects` policies (`assets/<user-id>/<kind>/…`). Every paid
   output (still, end-pose still, moment clip, anchored clip, bridge clip) is mirrored into
   the signed-in user's folder right after generation, and the project stores the durable
   object **path** (`imageStoragePath`, `endImageStoragePath`, `videoStoragePath`).
   Display URLs are 7-day **signed URLs**, re-minted for every path on each project load
   (`refreshAssetUrls` in `lib/project-store.ts`) — nothing persisted can go stale, and a
   private bucket means the only way to view an asset is a signature its owner can mint.
   Mirroring is **best-effort**: if Storage is unreachable the action returns fal's URL as
   before and logs `[assets] mirror failed` — a project that rots later beats a paid
   generation lost now. Anonymous demo users mirror nothing (unchanged $0 path).
   Bucket cap is 100 MB/object; stills reuse the bytes the validator already downloaded, so
   a still is never fetched twice.
5. Async Kling jobs (fal webhook/poll) for serverless reliability.
6. Stripe Checkout (test) + signature-verified webhook crediting.
