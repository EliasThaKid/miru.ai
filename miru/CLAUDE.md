@AGENTS.md

# SCENELAB

Script-to-storyboard and animatic generator for short-form content creators.
Portfolio project for Stew (Type.ai) — will be read in interviews. Prioritize
clean, readable code over cleverness.

Next.js 14+ App Router · Tailwind CSS · shadcn/ui · TypeScript · Anthropic API · FAL.ai · Vercel

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

- `/app/actions/` — Server Actions only (scene breakdown, image gen, video gen)
- `/components/` — all React components. Never put components directly in `/app`.
- `/lib/` — API clients and helpers (`lib/anthropic.ts`, `lib/fal.ts`, `lib/prompts.ts`)
- `/types/index.ts` — all shared types (`Scene`, `Project`, `ShotType`, `StylePreset`)
- `/public/demo/` — pre-cached demo project assets

## Data model

Source of truth is `/types/index.ts`. Don't redefine `Scene` or `Project` shapes inline
elsewhere — import them. Current shape:

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

interface Project {
  id: string
  title: string
  script: string
  characterDescription: string
  stylePreset: StylePreset
  scenes: Scene[]
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
- Every AI call must handle failure with a human-readable, user-facing error and a retry
  option. No silent failures, no unhandled promise rejections.

## Conventions

- Comment only where something non-obvious is happening. Don't narrate straightforward code.
- Regeneration (image or video) touches only the single scene object — never re-run the
  full pipeline for a per-scene action.
- Cost-sensitive actions ("Generate All Images") should show an estimate before running.

## Don't touch

- `/public/demo/` — pre-cached demo project (images + videoUrls). This is what makes the
  Stew demo run at $0 cost with zero live API calls. Do not regenerate, overwrite, or "clean up"
  these assets without explicit confirmation.
- `.env.local` — never read, print, log, or commit contents. Keys: `ANTHROPIC_API_KEY`, `FAL_KEY`.

## Scope discipline

This repo has a locked MVP scope (see project brief). If a task requests something outside
Screens 1–5 as specced (script input → processing → storyboard editor → animatic preview →
export), flag it as a scope expansion and confirm before building it. Do not add auth,
a database, social publishing, or full-project (non-per-scene) video generation.
