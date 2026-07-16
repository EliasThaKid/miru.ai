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

**Not yet built:**
- Animatic preview (Screen 4) and export (Screen 5: PDF via jsPDF+html2canvas, zip via JSZip).
  The animatic places connection artifacts (bridges, and later dissolves/fades) *between*
  moments on the timeline.
- Full storyboard editor (Screen 3): moment reordering, editing descriptions, per-moment
  regenerate, "Generate All Images" with the cost estimate.
- Future connection modes: dissolve/crossfade and fade-to-black are *deterministic* editor
  effects for the animatic/export pipeline — never Kling calls. Match-cut planning, wipes,
  and J/L-cuts (need audio) are further out. `ConnectionMode` is the extension point.
- Bridge style presets (Handheld continuous, Slow push, Slow lateral track, etc.) mapping to
  deterministic prompt text — deferred; the free-text bridge-direction field covers the MVP.
  Default remains the conservative "Subtle continuous" fallback. Never add a "morph" preset.
- 10-second moment clips: Kling 1.6 accepts `duration: '10'` but it is **not smoke-tested**;
  moments longer than 5s currently still get 5s clips. Same test gate as everything else
  before mapping `durationSeconds` to it.
- Character-description AI assist (Claude-powered refinement loop for the character field) —
  approved idea, parked as its own future sub-project; treat as in-scope when picked up.
- Design pass on Screen 1 (currently functional but unstyled) — the Superdesign skill is
  set up for this (`.claude/skills/superdesign`) if/when a polish pass is wanted.

**Known deferred cleanups (all Minor):**
- "Generate Storyboard" stays clickable while a generation is in flight; clicking it replaces
  all moment ids and orphans any in-flight (paid) video result. Fix: disable it while any
  generating-id set is non-empty.
- `handleGenerateImage`/`handleAnimateMoment`/`handleGenerateBridge` in `page.tsx` share a
  structural pattern — three instances now exist, so extracting a shared per-item async
  helper is fair game in the next cleanup pass.

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build (run before every commit that touches Server Actions)
- `npm run lint` — ESLint check
- `npx shadcn@latest add <component>` — add a new shadcn component (never hand-roll one that shadcn already provides)

## Architecture — do not relitigate

- No database. No auth. Persistence is localStorage only.
- All AI calls (Claude + FAL.ai) go through Server Actions in `/app/actions/`. Never call
  Anthropic or FAL.ai directly from a client component.
- PDF export (jsPDF + html2canvas) and image zip (JSZip) are pure client-side — no server involvement.
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
  labeled context only; no Claude call is involved.
- Hard Cut is not an AI call: selecting it must make zero network requests.
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
