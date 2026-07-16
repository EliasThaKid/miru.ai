@AGENTS.md

> **Agent delegation policy:** see the repo-root `CLAUDE.md` (Token-Efficient Agent
> Delegation Policy). Default is 0 subagents; subagent-driven-development only on explicit
> user request by name. That policy overrides any plan-doc or skill workflow suggestion.

# SCENELAB

Script-to-storyboard and animatic generator for short-form content creators.
Portfolio project for Stew (Type.ai) — will be read in interviews. Prioritize
clean, readable code over cleverness.

Next.js 14+ App Router · Tailwind CSS · shadcn/ui · TypeScript · Anthropic API · FAL.ai · Vercel

**Current state:** Week 1 vertical slice plus Animate Scene are done and verified live
(script in → scene breakdown → per-scene image → per-scene Kling 1.6 video):
`types/index.ts`, `lib/anthropic.ts`, `lib/fal.ts`, `lib/prompts.ts` (image + video prompt
builders), `app/actions/{generate-scenes,generate-image,generate-scene-video}.ts`,
`components/scene-card.tsx` (image display, Animate Scene button, native `<video>` playback),
and Screen 1 in `app/page.tsx` all work end to end against the real APIs. `lib/storage.ts`
persists the active `Project` to localStorage (load-on-mount, save-on-change) so state
survives a refresh. Note: `maxDuration = 300` lives in `page.tsx`, not the action file — a
`'use server'` module may only export async functions; page-level placement is the documented
Next.js mechanism for extending Server Action timeouts. Design docs live in
`docs/superpowers/{specs,plans}/`. A related sandbox repo,
`personalprojects/scenelab-api-test`, has the smoke-test scripts the FAL calls were ported from.

**Not yet built:**
- Chain Transition (Kling O3 Standard) — next up, but **still not smoke-tested**; write and
  run a test script in `scenelab-api-test/` first (same pattern as `test-flux.js`) before
  wiring any Server Action to it.
- Animatic preview (Screen 4) and export (Screen 5: PDF via jsPDF+html2canvas, zip via JSZip).
- Full storyboard editor (Screen 3): scene reordering, editing descriptions, per-scene
  regenerate, "Generate All Images" with the cost estimate.
- Character-description AI assist (Claude-powered refinement loop for the character field) —
  approved idea, parked as its own future sub-project; treat as in-scope when picked up.
- Design pass on Screen 1 (currently functional but unstyled) — the Superdesign skill is
  set up for this (`.claude/skills/superdesign`) if/when a polish pass is wanted.

**Known deferred cleanups (from the Animate Scene code review, all Minor):**
- "Generate Storyboard" stays clickable while a generation is in flight; clicking it replaces
  all scene ids and orphans any in-flight (paid) video result. Fix: disable it while
  `generatingImageIds`/`generatingVideoIds` are non-empty.
- `handleGenerateImage`/`handleAnimateScene` in `page.tsx` are structurally parallel — extract
  a shared helper only when Chain Transition adds a third instance, not before.

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

## File structure conventions

- `/app/actions/` — Server Actions only (scene breakdown, image gen, video gen, chain transition)
- `/components/` — all React components. Never put components directly in `/app`.
- `/lib/` — API clients and helpers (`lib/anthropic.ts`, `lib/fal.ts`, `lib/prompts.ts`)
- `/types/index.ts` — all shared types (`Scene`, `Project`, `Transition`, `ShotType`, `StylePreset`)
- `/public/demo/` — pre-cached demo project assets

## Data model

Source of truth is `/types/index.ts`. Don't redefine `Scene`, `Project`, or `Transition` shapes
inline elsewhere — import them. Current shape:

```typescript
type ShotType = 'wide' | 'medium' | 'close-up' | 'pov' | 'over-the-shoulder'
type StylePreset = 'anime' | 'cinematic' | 'illustrated' | 'hyper-realistic'

interface Scene {
  id: string
  number: number
  shotType: ShotType
  description: string
  durationSeconds: number
  imageUrl: string | null
  imagePrompt: string | null
  videoUrl: string | null
  videoPrompt: string | null
  imageGeneratedAt: string | null
  videoGeneratedAt: string | null
}

interface Transition {
  id: string
  fromSceneId: string          // Scene.id of the earlier scene
  toSceneId: string            // Scene.id of the next scene — must be adjacent
  videoUrl: string | null      // Kling O3 Standard output
  transitionPrompt: string | null
  generatedAt: string | null
}

interface Project {
  id: string
  title: string
  script: string
  characterDescription: string
  stylePreset: StylePreset
  scenes: Scene[]
  transitions: Transition[]   // sparse — only populated for chained adjacent pairs
  createdAt: string
  updatedAt: string
}
```

## AI call rules

- Claude scene breakdown: max 12 scenes, hard cap enforced in both the prompt and the UI.
  Must return raw JSON only — no markdown fences, no preamble. If parsing fails, retry once
  with an explicit "return ONLY the JSON object" reminder before surfacing an error to the user.
- Image generation (FAL.ai FLUX.2 Pro): always 9:16 vertical. Prompts are built via
  `buildImagePrompt()` in `lib/prompts.ts` — style prefix + character description + shot
  label + scene description. Never generate images in parallel; sequential only, to avoid
  rate spikes.
- Video generation (FAL.ai Kling 1.6): always opt-in per scene, triggered only by explicit
  "Animate Scene" click. Never auto-triggered on image generation. If `scene.videoUrl`
  already exists, return it instantly — do not re-call the API.
- Chain Transition (FAL.ai Kling O3 Standard, dual-keyframe): a separate endpoint from
  "Animate Scene" — do not assume they share a client call shape or param names. Always
  opt-in, always between two *adjacent* scenes that both already have generated images.
  Never auto-triggered. Reuses existing `imageUrl`s — no new image generation cost. If a
  `Transition` already exists for that scene pair, return it instantly rather than
  re-calling the API. Confirm the exact input schema (`image_url`, `end_image_url`, etc.)
  against current FAL docs before wiring the Server Action — endpoint slugs and params
  shift between Kling versions.
- Every AI call must handle failure with a human-readable, user-facing error and a retry
  option. No silent failures, no unhandled promise rejections.

## Conventions

- Comment only where something non-obvious is happening. Don't narrate straightforward code.
- Regeneration (image or video) touches only the single scene object — never re-run the
  full pipeline for a per-scene action. Same rule applies to Chain Transition: regenerating
  one transition never touches the scenes' images or any other transition.
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
a database, social publishing, or full-project (non-per-scene, non-adjacent-pair) video
generation. Chain Transition is in scope as specced above — opt-in, adjacent scene pairs
only. Do not extend it to auto-chain an entire project or generate transitions for
non-adjacent scenes without explicit confirmation.