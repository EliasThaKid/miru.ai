@AGENTS.md

> **Agent delegation policy:** see the repo-root `CLAUDE.md` (Token-Efficient Agent
> Delegation Policy). Default is 0 subagents; subagent-driven-development only on explicit
> user request by name. That policy overrides any plan-doc or skill workflow suggestion.

# SCENELAB

Script-to-storyboard and animatic generator for short-form content creators.
Portfolio project for Stew (Type.ai) — will be read in interviews. Prioritize
clean, readable code over cleverness.

Next.js 16 App Router · Tailwind CSS · shadcn/ui · TypeScript · Anthropic API · FAL.ai ·
Supabase (Auth + Postgres + Storage) · Stripe · Vercel

**Live at https://scenelab.urbnchld.com.** It is a real hosted product with real accounts and
real spend, not a demo any more. Assume changes reach users.

**Terminology (rebranded 2026-07-17):** a `Project` is one continuous *scene*; Claude breaks
the script into 8-12 **moments** — its distinct visual beats. Older docs/plans under
`docs/superpowers/` predate the rebrand and say "scenes" where the code now says moments.

**Current state:** verified live end to end against the real APIs: script → moment breakdown
(Claude) → per-moment image (FLUX) → per-moment animation (Kling 1.6) → per-adjacent-pair
*connections* (Hard Cut by default; opt-in Generated Bridge via Kling O3 dual-keyframe).
Persistence is now **session-dependent** (see "Hosted platform"): `lib/project-store.ts`
routes signed-in users to a Postgres row and everyone else to `lib/storage.ts` /
localStorage (key `scenelab:project:v3`).

**UI architecture (2026-07-18 two-mode redesign — approved Superdesign "Hero & Strip"):**
the app is a **state machine**, not a growing page: `composing → listing → transitioning
→ reviewing` in `page.tsx`. COMPOSE: narrow column (script, cast rows with per-row
Refine ✦, style), "Generate Storyboard" is the single filled primary action, with the
cost estimate folded in. `listing` never leaves compose (inline pending + Cancel; failure
lands inline). Generate is a **mode change**: on wave 1 (Claude breakdown) resolving, the
script repaints as `layoutId`'d spans (per-moment `scriptSpan`, derived server-side from
the breakdown's verbatim `scriptAnchor` via whitespace-tolerant in-order matching — never
trust model character offsets) and Motion (`motion/react`) flies them into the REVIEW
strip. REVIEW: left rail (`left-rail.tsx`, PROJECT + EXPORTS sections — exports disabled
until frames exist), hero canvas (`hero-canvas.tsx`), right inspector (`inspector.tsx`),
thumbnail strip with clickable connection joints (`review-strip.tsx`). Waves 2/3 resolve
inside review as progressive fill: wave 2 auto-runs the **sequential** render queue
(cancellable — stops scheduling, keeps landed frames); wave 3 joints go dormant → armed
→ user-pulled (bridges stay opt-in, never auto-chained). Inspector shows generation
provenance (FLUX 1.1 Pro / Kling 1.6 / Kling O3 + timestamps), an **editable prompt**
(persisted to `moment.imagePrompt`; renders pass it as `promptOverride`), and bridge
generate/regenerate. Reduced motion: same machine, cross-fade instead of fly. A listing
uses a monotonic token (`listingSeqRef`) so a cancelled request's late resolution can
never race a newer one — do not replace it with a boolean.

The inspector also owns per-moment editing: DESCRIPTION (editable; note that once
`imagePrompt` is stored, the prompt — not the description — drives renders) and ◀ ▶
reordering in the SHOT block (renumbers; selection follows the moved moment). The
animatic opens via the rail into the review canvas. Note: `maxDuration = 60` lives in
`page.tsx`, not any action file — a `'use server'` module may only export async functions;
page-level placement is the documented Next.js mechanism for extending Server Action
timeouts. 60 is the Vercel Hobby ceiling, and it is *sufficient* only because hosted renders
go through the job queue instead of blocking; do not reintroduce a blocking Kling call
without raising it (Pro only). Design docs live in
`docs/superpowers/{specs,plans}/`. A related sandbox repo, `personalprojects/scenelab-api-test`,
has the smoke-test scripts every FAL call and the breakdown prompt were validated against
(FLUX, Kling 1.6, Kling O3, and the 2026-07-17 moments-prompt revision).

**Animatic preview (Screen 4) — shipped.** In-page player (`components/animatic-player.tsx`,
opened via "Preview Animatic"): flattens moments + connections into a timeline; animated
moments play their clips, still moments hold for `durationSeconds` with a subtle Ken Burns
drift (CSS keyframes in `globals.css`); generated bridges play between their pair; dissolve
and fade-to-black are deterministic CSS effects (never Kling calls). Moments without images
are skipped. Play/pause preserves the current hold's remaining time; the timer effect is
StrictMode-safe (single owner, cleanup banks elapsed time). Base UI note: `SelectValue`
renders the raw value, so both selects pass the label as children explicitly.

**Export (Screen 5) — shipped.** `components/export-controls.tsx` + `lib/export.ts`, pure
client-side: an A4 storyboard PDF (cover page + two 9:16 frames per page with shot metadata
and descriptions, composed directly with jsPDF — html2canvas turned out unnecessary since
we build from image data rather than screenshotting DOM) and a JSZip image zip
(`moment-NN.jpg`). Only moments with images are included. Note: jsPDF's built-in fonts are
latin-1, so exported text is sanitized (em dashes, curly quotes) in `lib/export.ts`.

**Storyboard editor (Screen 3) — shipped.** Lives on the moment cards + a toolbar:
up/down reordering (renumbers; transitions for no-longer-adjacent pairs stop matching and
revive if the order is restored), click-to-edit descriptions (existing image/animation is
kept — regeneration is the user's explicit choice), Regenerate Image (also clears the
moment's animation, which derived from the old image; bypasses the action's idempotency
check by passing `imageUrl: null`), Re-Animate, and "Generate All Images" with an inline
~cost estimate + confirm, running sequentially per the rate rule. "Generate Storyboard" is
disabled while anything generates (a fresh breakdown would orphan in-flight paid results).

**Not yet built:**
- Future connection modes: wipes, match-cut planning, and J/L-cuts (need audio).
  `ConnectionMode` is the extension point; new deterministic modes belong in the animatic
  player's timeline builder, never in a Kling call.
- Bridge style presets (Handheld continuous, Slow push, Slow lateral track, etc.) mapping to
  deterministic prompt text — deferred; the free-text bridge-direction field covers the MVP.
  Default remains the conservative "Subtle continuous" fallback. Never add a "morph" preset.
- 10-second moment clips: Kling 1.6 accepts `duration: '10'` but it is **not smoke-tested**;
  moments longer than 5s currently still get 5s clips. Same test gate as everything else
  before mapping `durationSeconds` to it.
**Design (Superdesign pass, 2026-07-18):** the app ships the **Dark Editing Studio**
direction — `dark` class on `<html>` in `layout.tsx`, using the `.dark` token block in
`globals.css` as the validated palette (the Superdesign draft's palette matched it
exactly). Fully neutral OKLCH grayscale; the only color is `--destructive` for errors.
Drafts live in the SCENELAB Superdesign project (baseline reproduction + dark studio +
bright editorial alternates) for future iterations; `.superdesign/` holds the refreshed
init analysis and `design-system.md`. Do not reintroduce a light default without a
deliberate design decision.

**Known deferred cleanups (all Minor):**
- `handleGenerateImage`/`handleAnimateMoment`/`handleGenerateBridge` in `page.tsx` share a
  structural pattern — three instances now exist, so extracting a shared per-item async
  helper is fair game in the next cleanup pass. `page.tsx` has also grown large enough
  that splitting the editor/generation handlers into a hook is worth considering then.

## Hosted platform (Phases 1–6, shipped)

Operational runbook — env vars, migrations, deploy steps, go-live checklist — is
`HOSTING.md`. This section is the architecture and the invariants.

**Money invariants. Treat these as load-bearing; breaking one costs real money.**
- The **server is the only authority on balances**. Costs come from `TOKENS_PER_*` env vars,
  never from the client. Never accept an amount, a price, or a user id from a request body.
- **Nothing that CREDITS tokens is reachable with a user JWT.** `refund_spend` and
  `apply_purchase` are service-role only. `spend_tokens` is user-callable on purpose —
  calling it directly can only drain your own balance and cannot trigger a paid fal call.
  (`0004_refund_hardening.sql` exists because the original `refund_tokens` grant let any
  signed-in user mint unlimited tokens.)
- **Deduct before generate, refund on failure.** `beginGeneration()` in `lib/metering.ts`
  wraps every paid action; a cached asset or a validation failure must return *before* it, so
  no-ops are free. `refund_spend` refuses to exceed the net spend recorded against that ref.
- Per-user daily cap + global daily ceiling are enforced **atomically inside** `spend_tokens`.
  The global ceiling is the kill-switch against a scraper — keep it set in production.

**Assets (Phase 4).** fal CDN URLs expire, so every paid output is mirrored into a private
per-user Storage bucket. The durable reference is the **object path**
(`imageStoragePath` / `endImageStoragePath` / `videoStoragePath`), never a URL: both provider
and signed URLs expire. `refreshAssetUrls()` re-mints 7-day signed URLs on every project load.
Mirroring is **best-effort** — a Storage failure keeps the provider URL rather than losing a
paid generation.

**Render jobs (Phase 5).** Signed-in clip/anchored/bridge generation **submits to fal's queue**
and polls; it does not block. Job rows in `render_jobs` are what survive a closed tab.
- `pending` = intended, not yet sent to fal, **nothing charged**. `queued`/`running` = paid.
  A `request_id` is the proof of submission — classify by that, not by the status string.
- Tokens are spent at promotion, not at batch creation, so an abandoned batch is cheap.
- **Cancel stops scheduling only.** Submitted clips are paid, running work: they finish and
  land, and are **not refunded**. The UI says so before and during a batch. Never add a
  cancel-refund path.
- Animate All runs up to `ANIMATE_CONCURRENCY` (3) clips at once. **Stills stay strictly
  sequential** — the FLUX rate rule is unchanged.
- One `JobWatcher` multiplexes all polling. Do not go back to one poller per job: every poll
  is a Server Action and every Server Action re-renders the tree.
- Job state is service-role only. A user who could mark their own job failed would collect a
  refund for work that succeeded.

**Payments (Phase 6).** Stripe-hosted Checkout; card details never touch the app. The pack
catalogue lives server-side in `lib/stripe.ts` and the browser sends only a **pack id**. The
webhook (`/app/api/stripe/webhook/route.ts`) is public, so nothing is believed until
`constructEvent` verifies the signature — read the body **raw**, keep the Node runtime, and
only credit `payment_status === 'paid'`. `apply_purchase` is idempotent on the session id.
A credit failure returns **500 on purpose** so Stripe retries; an unattributable paid session
returns 200 and is logged loudly for manual crediting.

**Migrations** are ordered and cumulative in `supabase/migrations/`: `0001` schema + ledger,
`0002` caps/kill-switch, `0003` Storage bucket + policies, `0004` refund hardening (security),
`0005` render jobs, `0006` pending jobs, `0007` welcome grant. Add new ones; never edit an
applied file.

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build (run before every commit that touches Server Actions)
- `npm run lint` — ESLint check
- `npx vitest run` — unit tests (prompt composition, image validation)
- `npx shadcn@latest add <component>` — add a new shadcn component (never hand-roll one that shadcn already provides)

## Architecture — do not relitigate

- **Two modes, one codebase.** Signed out — or Supabase env vars absent — is the original
  `$0` localStorage demo, unchanged and still the thing that must never break. Signed in is
  the hosted product. Every hosted feature degrades gracefully when its env vars are missing;
  never make the demo path depend on Supabase, Stripe, or the job queue.
- Persistence routes through `lib/project-store.ts` (DB row when signed in, localStorage
  otherwise). Don't call `lib/storage.ts` directly from new code.
- All AI calls (Claude + FAL.ai) go through Server Actions in `/app/actions/`. Never call
  Anthropic or FAL.ai directly from a client component.
- PDF export (jsPDF) and image zip (JSZip) are pure client-side — no server involvement.
- Video playback is a native `<video>` tag. No FFmpeg, no Remotion, no server-side rendering of video.
- Connections are editorial-first: a Hard Cut is the default state of every adjacent pair,
  costs nothing, and requires no record. AI generation (Generated Bridge) is the explicit,
  opt-in exception — never the default, never automatic.

## File structure conventions

- `/app/actions/` — Server Actions only (`generate-moments`, `generate-image`,
  `generate-moment-video`, `generate-bridge`, `render-jobs`, `checkout`)
- `/app/api/` — Route Handlers for server-to-server callers only (the Stripe webhook).
  Anything the app's own UI calls belongs in `/app/actions/`.
- `/components/` — all React components (`moment-card.tsx`). Never put components directly in `/app`.
- `/lib/` — API clients and helpers (`lib/anthropic.ts`, `lib/fal.ts`, `lib/prompts.ts`,
  `lib/metering.ts`, `lib/asset-store.ts`, `lib/render-jobs.ts`, `lib/stripe.ts`)
- `/lib/supabase/` — `client` (browser, anon key), `server` (user JWT, RLS applies),
  `admin` (**service role, bypasses RLS — server-only, never import from a component**),
  `proxy` (session refresh)
- `/supabase/migrations/` — ordered SQL. Never edit an applied migration; add a new one.
- `/types/index.ts` — all shared types (`Moment`, `Project`, `Transition`, `ConnectionMode`,
  `ShotType`, `StylePreset`)
- `/public/demo/` — pre-cached demo project assets

## Data model

Source of truth is `/types/index.ts`. Don't redefine `Moment`, `Project`, or `Transition`
shapes inline elsewhere — import them. Current shape:

```typescript
type ShotType = 'wide' | 'medium' | 'close-up' | 'pov' | 'over-the-shoulder'
type StylePreset = 'anime' | 'cinematic' | 'illustrated' | 'hyper-realistic'
type ConnectionMode = 'hard-cut' | 'generated-bridge'   // dissolve, fade, wipe… later

interface Moment {
  id: string
  number: number
  shotType: ShotType
  description: string
  durationSeconds: number      // 2-10, sized by content
  imageUrl: string | null
  imagePrompt: string | null
  videoUrl: string | null
  videoPrompt: string | null
  imageGeneratedAt: string | null
  videoGeneratedAt: string | null
}

interface Transition {
  id: string
  fromMomentId: string          // Moment.id of the earlier moment
  toMomentId: string            // Moment.id of the next moment — must be adjacent
  mode: ConnectionMode
  videoUrl: string | null      // Kling O3 output — KEPT when mode flips back to hard-cut
  transitionPrompt: string | null
  bridgeDirection: string | null
  generatedAt: string | null
}

interface Character {
  id: string
  name: string
  description: string
}

interface Project {
  id: string
  title: string
  script: string
  characters: Character[]     // the cast — composed into every image prompt (storage v3)
  stylePreset: StylePreset
  moments: Moment[]
  transitions: Transition[]   // sparse — only pairs the user has touched; absence = Hard Cut
  createdAt: string
  updatedAt: string
}
```

## AI call rules

- Claude moment breakdown: 8-12 moments, hard cap enforced in both the prompt and the UI.
  `durationSeconds` is 2-10, sized by content (quick action beats short, lingering beats
  long). Must return raw JSON only — no markdown fences, no preamble. If parsing fails,
  retry once with an explicit "return ONLY the JSON object" reminder before surfacing an
  error to the user. The prompt was revised for the rebrand on 2026-07-17 and re-validated
  against `scenelab-api-test/test-scene-breakdown.js` (9/9 consistency runs + 3 edge cases).
- **Temporal split (2026-07-19, fixes reversed-action clips):** the breakdown returns
  per-moment `startFrame` (frozen opening composition), `motion` (forward change only),
  and `endFrame` (frozen closing composition). The STILL is built from `startFrame`; the
  CLIP prompt is built from `motion` with a "Begin exactly from the supplied first frame…
  never backward" preamble. Never feed the full action-arc `description` to both models —
  that was the root cause of reversed action staging. Legacy moments fall back to
  `description`. `motion` is editable in the inspector.
- **Settings layer (2026-07-19, fixes location drift):** `Project.settings: Setting[]`
  (name + description, compose-side editor; normalize `?? []` on old saves). The breakdown
  receives a SETTINGS block and may only place shots inside it (per-moment `location`,
  invented names degrade to null server-side); the assigned setting's description enters
  the image prompt as a `Setting:` segment. Inspector LOCATION select overrides per moment.
- Image generation (FAL.ai FLUX, `fal-ai/flux-pro/v1.1`): always 9:16 vertical. Prompts are
  built via `buildImagePrompt()` in `lib/prompts.ts` — style prefix + character description
  + setting + shot label + startFrame composition. Never generate images in parallel;
  sequential only, to avoid rate spikes.
- Moment animation (FAL.ai Kling 1.6): always opt-in per moment, triggered only from the
  inspector. Never auto-triggered on image generation. If `moment.videoUrl` already
  exists, return it instantly — do not re-call the API. Clip length maps from
  `durationSeconds`: **≥8s → `duration: '10'`, else `'5'`** — both values smoke-tested
  (`test-kling.js` 2026-07-16; `test-kling-10s.js` 2026-07-18, live clip measured 10.43s).
  No other duration values are validated. `durationSeconds` is editable in the inspector
  (−/+ stepper, 2-10); editing it keeps an existing clip — Re-Animate to match.
- **Anchored animation (opt-in, 5s moments only):** "Animate with end frame ✦✦" renders
  the moment's `endFrame` as a second still (cached in `moment.endImageUrl` — paid asset,
  reused) and animates start→end with Kling O3 dual keyframe
  (`generate-anchored-video.ts`) — reversed staging becomes structurally impossible.
  Provenance: `moment.videoModel` ('kling-1.6' | 'kling-o3-anchored'). Not offered for
  10s moments (O3 unvalidated at 10s).
- Generated Bridge (FAL.ai Kling O3 Standard, dual-keyframe,
  `fal-ai/kling-video/o3/standard/image-to-video` — validated live 2026-07-16, ~60s):
  always opt-in, always between two *adjacent* moments that both already have generated
  images. Never auto-triggered; never auto-chain the storyboard. Reuses existing
  `imageUrl`s — no new image cost. If a `Transition` with a `videoUrl` exists for the pair,
  return it instantly. Prompts via `buildTransitionPrompt()` — motion-first (user's optional
  bridge direction, or the conservative fallback), with the two moment descriptions as
  labeled context only; no Claude call is involved. **Frame continuity:** if the "from"
  moment is animated, the bridge starts from its clip's *final frame* (captured client-side
  via canvas in `lib/extract-frame.ts` — not FFmpeg — then uploaded via `fal.storage`), so
  playback never jumps back to the still image. The "to" side always uses the moment's
  image: a bridge ends exactly where that moment's own animation begins. Known limitation:
  a bridge generated *before* the from-moment was animated is not invalidated afterwards
  (idempotent reuse wins); regeneration support is future work.
- Characters are a cast (`Character[]`): each has a name + visual description. The
  breakdown receives the cast (a CAST block above the script) and assigns per-moment
  `characters` — who is VISIBLY PRESENT in each frame (validated live: solo-storyline
  scripts get clean solo assignments; unknown names are dropped server-side). Stored as
  `moment.characterNames`; **only the assigned cast enters that moment's image prompt**
  via `castForMoment()` + `composeCharacterDescription()` in `lib/prompts.ts`. Semantics:
  null/undefined = legacy → whole cast; `[]` = deliberately nobody. The inspector's
  "CAST IN FRAME" chips toggle assignments per moment (legacy moments materialize the
  full list on first toggle). The prompt segment is omitted entirely when the effective
  cast is empty. Character refinement ("Refine with AI ✦", per tab): Claude rewrites that
  character's description into a visual-consistency descriptor (attributes preserved,
  25-60 words, no style words) plus user-facing notes. Always suggest-then-accept — never
  overwrite without an explicit "Use this" click. Prompt validated in
  `scenelab-api-test/test-character-refine.js`; settings have the same "Refine with AI ✦"
  (`refineSetting`, tuned for place/atmosphere). **Refine is per-entity** — `refiningIds`
  Set + `refineSuggestions`/`refineErrors` maps keyed by id, so one card refining never
  loads/rerenders another and concurrent refines land on the right entity. Shared
  `SuggestionCard` renders both.
- **Auto-population (2026-07-28):** on a substantial script paste into empty panels,
  `extractContext()` (validated in `scenelab-api-test/test-extract-context.js`) infers the
  full cast + settings with render-ready descriptions — the user arrives at a populated
  project. Fires once per distinct script (`autoDetectedForRef`), never overwrites
  non-empty panels. Generate has a synchronous fallback that populates if still empty.
  Manual "Re-detect ✦" re-runs and REPLACES. Client-side `isDescriptionWeak()` shows an
  advisory (`< 8 words / < 50 chars`) under thin character/setting descriptions —
  advisory, never blocking.
- **Location mapping (2026-07-28):** the breakdown's location rule strongly prefers
  existing settings and treats differently-phrased references to one physical place as the
  same setting. Server-side `resolveSettingName()` (validated
  `scenelab-api-test/test-fuzzy-setting.js`) maps the model's phrasing to a real setting:
  exact → normalized-contains → single distinctive-token overlap; genuine ambiguity → null
  (never a wrong guess).
- Hard Cut, Dissolve, and Fade to Black are not AI calls: selecting any of them must make
  zero network requests. Dissolve/fade are rendered by the animatic player at playback time.
- Every AI call must handle failure with a human-readable, user-facing error and a retry
  option. No silent failures, no unhandled promise rejections.

## Conventions

- Comment only where something non-obvious is happening. Don't narrate straightforward code.
- Regeneration (image or video) touches only the single moment object — never re-run the
  full pipeline for a per-moment action. Same for bridges: regenerating one transition never
  touches the moments' images or any other transition.
- A generated bridge is a separate between-moments artifact: it never replaces a moment's
  own image or animation, and switching a pair's mode to Hard Cut keeps the bridge's
  `videoUrl` so the user can switch back for free.
- Cost-sensitive actions ("Generate All Images") should show an estimate before running.

## Don't touch

- `/public/demo/` — pre-cached demo project (images, videoUrls, and transition videoUrls).
  This is what makes the Stew demo run at $0 cost with zero live API calls. Do not
  regenerate, overwrite, or "clean up" these assets without explicit confirmation.
- `.env.local` and `.env.vercel` — never read, print, log, or commit contents. They now hold
  far more than two keys: `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and `STRIPE_SECRET_KEY`
  moves money. If a value is needed, transform the file in place with a shell command rather
  than printing it. (Listing variable *names* is fine and is the usual diagnostic.)
- Applied migrations (`0001`–`0007`). They have run against the live database; changing one
  desynchronizes it from production. Add a new migration instead.

## Scope discipline

The creative scope is still Screens 1–5 (script input → processing → storyboard editor →
animatic preview → export). If a task requests something outside that, flag it as a scope
expansion and confirm before building it.

Auth, the database, the token economy, and payments **are built** — see "Hosted platform".
That is no longer a scope expansion; it is the product. Still out of scope: social
publishing, and full-project (non-per-moment, non-adjacent-pair) video generation.
Generated Bridges remain opt-in, adjacent moment pairs only. Do not extend them to
auto-chain an entire project or generate bridges for non-adjacent moments without explicit
confirmation.

**Because it is live:** anything touching money, auth, or generation reaches real users on
real spend. Verify with `npm run build`, `npm run lint`, and `npx vitest run` before
committing, and prefer a new migration over editing an applied one.
