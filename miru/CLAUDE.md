@AGENTS.md

> **Agent delegation policy:** see the repo-root `CLAUDE.md` (Token-Efficient Agent
> Delegation Policy). Default is 0 subagents; subagent-driven-development only on explicit
> user request by name. That policy overrides any plan-doc or skill workflow suggestion.

# SCENELAB

Script-to-storyboard and animatic generator for short-form content creators.
Portfolio project for Stew (Type.ai) — will be read in interviews. Prioritize
clean, readable code over cleverness.

Next.js 14+ App Router · Tailwind CSS · shadcn/ui · TypeScript · Anthropic API · FAL.ai · Vercel

**Terminology (rebranded 2026-07-17):** a `Project` is one continuous *scene*; Claude breaks
the script into 8-12 **moments** — its distinct visual beats. Older docs/plans under
`docs/superpowers/` predate the rebrand and say "scenes" where the code now says moments.

**Current state:** verified live end to end against the real APIs: script → moment breakdown
(Claude) → per-moment image (FLUX) → per-moment animation (Kling 1.6) → per-adjacent-pair
*connections* (Hard Cut by default; opt-in Generated Bridge via Kling O3 dual-keyframe).
`lib/storage.ts` persists the active `Project` to localStorage (key `scenelab:project:v2` —
v1 pre-rebrand data is left to lapse). Note: `maxDuration = 300` lives in `page.tsx`, not any
action file — a `'use server'` module may only export async functions; page-level placement
is the documented Next.js mechanism for extending Server Action timeouts. Design docs live in
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
- Design pass on Screen 1 (currently functional but unstyled) — the Superdesign skill is
  set up for this (`.claude/skills/superdesign`) if/when a polish pass is wanted.

**Known deferred cleanups (all Minor):**
- `handleGenerateImage`/`handleAnimateMoment`/`handleGenerateBridge` in `page.tsx` share a
  structural pattern — three instances now exist, so extracting a shared per-item async
  helper is fair game in the next cleanup pass. `page.tsx` has also grown large enough
  that splitting the editor/generation handlers into a hook is worth considering then.

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build (run before every commit that touches Server Actions)
- `npm run lint` — ESLint check
- `npx shadcn@latest add <component>` — add a new shadcn component (never hand-roll one that shadcn already provides)

## Architecture — do not relitigate

- No database. No auth. Persistence is localStorage only.
- All AI calls (Claude + FAL.ai) go through Server Actions in `/app/actions/`. Never call
  Anthropic or FAL.ai directly from a client component.
- PDF export (jsPDF) and image zip (JSZip) are pure client-side — no server involvement.
- Video playback is a native `<video>` tag. No FFmpeg, no Remotion, no server-side rendering of video.
- Connections are editorial-first: a Hard Cut is the default state of every adjacent pair,
  costs nothing, and requires no record. AI generation (Generated Bridge) is the explicit,
  opt-in exception — never the default, never automatic.

## File structure conventions

- `/app/actions/` — Server Actions only (`generate-moments`, `generate-image`,
  `generate-moment-video`, `generate-bridge`)
- `/components/` — all React components (`moment-card.tsx`). Never put components directly in `/app`.
- `/lib/` — API clients and helpers (`lib/anthropic.ts`, `lib/fal.ts`, `lib/prompts.ts`)
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

interface Project {
  id: string
  title: string
  script: string
  characterDescription: string
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
- Image generation (FAL.ai FLUX, `fal-ai/flux-pro/v1.1`): always 9:16 vertical. Prompts are
  built via `buildImagePrompt()` in `lib/prompts.ts` — style prefix + character description
  + shot label + moment description. Never generate images in parallel; sequential only, to
  avoid rate spikes.
- Moment animation (FAL.ai Kling 1.6): always opt-in per moment, triggered only by explicit
  "Animate Moment" click. Never auto-triggered on image generation. If `moment.videoUrl`
  already exists, return it instantly — do not re-call the API. Clips are always 5s
  (`duration: '5'`, the only smoke-tested value).
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
- Character refinement ("Refine with AI ✦" on the character field): Claude rewrites the
  user's description into a visual-consistency descriptor (attributes preserved, 25-60
  words, no style words — the style preset is added separately by `buildImagePrompt`) plus
  user-facing notes. Always suggest-then-accept — never overwrite the field without an
  explicit "Use this" click. Prompt validated in
  `scenelab-api-test/test-character-refine.js` (2026-07-18); revise there first.
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
- `.env.local` — never read, print, log, or commit contents. Keys: `ANTHROPIC_API_KEY`, `FAL_KEY`.

## Scope discipline

This repo has a locked MVP scope (see project brief). If a task requests something outside
Screens 1–5 as specced (script input → processing → storyboard editor → animatic preview →
export), flag it as a scope expansion and confirm before building it. Do not add auth,
a database, social publishing, or full-project (non-per-moment, non-adjacent-pair) video
generation. Generated Bridges are in scope as specced above — opt-in, adjacent moment pairs
only. Do not extend them to auto-chain an entire project or generate bridges for
non-adjacent moments without explicit confirmation.
