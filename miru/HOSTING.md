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
2. **Run the migrations in order** — `0001_init.sql`, `0002_metering.sql`, `0003_storage.sql`,
   `0004_refund_hardening.sql` (**apply this one to any existing project immediately** — it
   closes a hole where any signed-in user could credit themselves unlimited tokens)
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
  **no write grants**; tokens move only through the atomic `spend_tokens` / `refund_spend` /
  `apply_purchase` functions in the migrations.
- **Nothing that CREDITS tokens is reachable with a user JWT.** `refund_spend` and
  `apply_purchase` require the service role. Only `spend_tokens` is user-callable, because
  calling it directly can only drain your own balance and can't trigger a paid fal call.
  `SUPABASE_SERVICE_ROLE_KEY` is therefore **required** from Phase 3 onward — without it,
  failed generations are not refunded (the server logs `REFUND SKIPPED` loudly).
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

## Deploying to Vercel (test-mode Stripe)

Do this before live payments: Stripe wants a real HTTPS webhook endpoint, and a deployed URL
is what you link from a portfolio.

1. **Push the branch and import the repo** in Vercel. **Set the Root Directory to `miru`** —
   the Next app is not at the repo root. Framework preset: Next.js. Build settings default.
2. **Set every env var** from the list at the top of this file in Project Settings →
   Environment Variables (Production + Preview). `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`,
   `ANTHROPIC_API_KEY`, and `STRIPE_*` are server-only — do **not** prefix them with
   `NEXT_PUBLIC_`, which would ship them to the browser.
3. **Set the spend rails before the link is public.** These are the only thing between a
   portfolio link and an open tab on your fal account:
   ```bash
   GLOBAL_DAILY_TOKEN_CEILING=200   # ~25 clips/day total; the kill-switch
   DAILY_TOKEN_CAP_PER_USER=40      # ~5 clips/day per user
   ```
   Pick numbers you would shrug off losing in a day. Also run
   `supabase/migrations/0007_welcome_grant.sql`, which drops the free signup grant from 20
   tokens to 12 (one storyboard of stills, no clips).
4. **Point Supabase at the deployed domain:** Authentication → URL Configuration → set Site
   URL to `https://<your-app>.vercel.app` and add it to Redirect URLs, or `/auth/callback`
   will bounce back to localhost. If you use GitHub OAuth, add the same domain as the OAuth
   app's Homepage URL (the callback stays the Supabase one).
5. **Turn "Confirm email" back ON** (Authentication → Providers → Email) before the link is
   public — off, anyone can sign up with an address they don't own and take the free grant.
6. **Add the production Stripe webhook:** Developers → Webhooks → Add endpoint →
   `https://<your-app>/api/stripe/webhook`, event `checkout.session.completed`. Its signing
   secret is **different** from the `stripe listen` one — put it in Vercel as
   `STRIPE_WEBHOOK_SECRET`.
7. **Smoke test the deployment:** sign up → render one still → buy a test pack with
   `4242 4242 4242 4242` → confirm the balance rises → animate one moment → reload mid-render
   and confirm it resumes.

**Function timeouts:** `maxDuration = 60` in `page.tsx` is the Vercel **Hobby** ceiling. This
works because Phase 5 submits renders to fal's queue instead of blocking on them. On Pro you
may raise it, but nothing currently needs more.

## Go-live checklist (do NOT flip to live Stripe keys until all true)

- [ ] **Legal/tax:** a real entity or individual on Stripe with tax info; Stripe Tax configured.
      **Yours — cannot be done in code.**
- [x] **Policies published:** `/legal/terms`, `/legal/privacy`, `/legal/acceptable-use`,
      `/legal/refunds`. Linked from the auth pages, with consent shown at account creation.
      ⚠️ **Drafted, not lawyer-reviewed.** They describe this system accurately (what is
      stored, which processors receive what, how refunds actually behave), which is more than
      a template does — but before real money, have them reviewed, and replace
      `support@urbnchld.com` if that is not a monitored address.
- [ ] **Unit economics verified:** measured fal per-call cost; token price clears cost + fees.
      Pack prices in `lib/stripe.ts` are still placeholders.
- [x] **Content moderation:** policy at `/legal/acceptable-use`, enforced by
      `0008_account_suspension.sql` — a row in `account_status` blocks generation atomically
      inside `spend_tokens`, so a suspended account cannot spend by any path. Suspend/reinstate
      SQL is in the migration header. You still accept that users generate on your
      fal/Anthropic keys and you are responsible under their ToS.
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
5. **Async Kling jobs for serverless reliability.** ✅
   **Run `supabase/migrations/0005_render_jobs.sql`.** Signed-in users submit clips to fal's
   *queue* and the `request_id` is persisted, so a closed tab, a refresh, or a function
   timeout no longer destroys a paid clip — `listOpenJobs()` reattaches on load. Polling, not
   webhooks: a webhook needs a public HTTPS endpoint and can't be exercised locally, while
   durability comes from the row in Postgres either way (a webhook can be layered on the same
   rows later). Job state is service-role-only — a user who could mark their own job failed
   would collect a refund for work that succeeded. Concurrency: **up to 3 clips in flight**
   during Animate All (stills stay strictly sequential). **Cancel stops scheduling only** —
   clips already submitted are billed by fal, so they finish, land, and are **not refunded**;
   the UI says this before and during the batch. Refunds happen only on genuine failure or a
   >30 min stale job. The anonymous $0 demo keeps the original blocking path (no DB to hold a
   job), which is why `maxDuration = 300` stays in `page.tsx`.
6. **Stripe Checkout (test) + signature-verified webhook crediting.** ✅
   No migration — `apply_purchase` has been in `0001` since Phase 1. Packs live in
   `lib/stripe.ts` (server-side); the browser sends only a **pack id**, so a tampered request
   can buy a pack that exists or nothing at all. The user id comes from the session cookie,
   never the request body, so nobody can credit someone else's account. Card details never
   touch the app — Checkout is Stripe-hosted.

   **Setup (test mode):**
   1. Stripe dashboard (Test mode) → Developers → API keys. Set `STRIPE_SECRET_KEY=sk_test_…`.
   2. **Local webhook:** `stripe login`, then
      `stripe listen --forward-to localhost:3000/api/stripe/webhook`. It prints a
      `whsec_…` — that is your `STRIPE_WEBHOOK_SECRET` for local testing. Restart `npm run dev`.
   3. **Deployed webhook:** Developers → Webhooks → Add endpoint →
      `https://<your-app>/api/stripe/webhook`, event `checkout.session.completed`. Copy that
      endpoint's signing secret into Vercel as `STRIPE_WEBHOOK_SECRET` (it differs from the
      CLI one).
   4. Test card `4242 4242 4242 4242`, any future expiry and CVC.

   **Why this can't be forged or double-credited:** the endpoint is public, so nothing in the
   body is believed until `constructEvent` verifies the signature against the signing secret —
   a forged "payment succeeded" is rejected before it can credit anything. Only `paid`
   sessions credit. Crediting goes through `apply_purchase`, which inserts the purchase row
   first and no-ops on a duplicate session id, so Stripe's at-least-once delivery and retries
   can't double-credit. A credit failure returns 500 **on purpose** so Stripe retries — the
   payment is real and the tokens are owed. A paid session whose metadata is missing is logged
   as `UNATTRIBUTABLE PAID SESSION` and must be credited by hand.

   ⚠️ **Pack prices in `lib/stripe.ts` are placeholders, not validated economics.** Do the
   unit-economics step in the go-live checklist before charging real money.
