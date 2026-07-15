# Animate Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user turn a scene's generated image into a short animated clip via FAL.ai Kling 1.6, opt-in per scene, triggered by an "Animate Scene" button on the existing scene card.

**Architecture:** Extends the exact pattern already used for image generation: a `lib/fal.ts` client function → a `'use server'` Server Action in `app/actions/` that builds a prompt and calls it, returning a `{ ok, ... } | { ok: false, error }` union → client-side state in `page.tsx` that calls the action and merges the result into the persisted `Project`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), `@fal-ai/client` (Kling 1.6 `fal-ai/kling-video/v1.6/standard/image-to-video`), TypeScript, shadcn/ui.

## Global Constraints

- No auth, no database — persistence is `Project` in localStorage only (`lib/storage.ts`), already wired.
- All AI calls happen in Server Actions under `src/app/actions/`. Never call FAL directly from a client component.
- Comment only where something non-obvious is happening — don't narrate straightforward code.
- Every AI call must handle failure with a human-readable, user-facing error. No silent failures, no unhandled promise rejections. "Retry" means the user can click the button again — no automatic retry loop (matches the existing image-gen pattern).
- Regeneration touches only the single scene object — never re-run the full pipeline for a per-scene action.
- If `scene.videoUrl` already exists, return it instantly — do not re-call the API.
- **No unit test framework exists in this repo** (no Jest/Vitest, no `test` script in `package.json`). The established verification convention for this project (used for scene breakdown, image gen, and localStorage persistence) is live E2E verification against the real dev server via the `playwright-skill:playwright-skill` plugin, plus `npm run build` and `npm run lint`. Do not introduce a unit test framework as part of this plan — that's a separate, unrequested scope expansion. "Testable deliverable" in this plan means: builds clean, lints clean, and is verified live in a real browser against the real APIs.
- Run `npm run build` (Next.js typechecks as part of build) and `npm run lint` after every task, before committing.
- Endpoint slugs and param shapes for FAL calls are ported verbatim from the smoke-tested scripts in `personalprojects/scenelab-api-test/` — do not invent or "fix" param names even if they look unusual. If a live call rejects a param, that's discovered and fixed during Task 6's live verification, not guessed at in advance.

---

### Task 1: Motion prompt mapping in `lib/prompts.ts`

**Files:**
- Modify: `miru/src/lib/prompts.ts`

**Interfaces:**
- Consumes: `ShotType` from `@/types` (already imported in this file).
- Produces: `buildVideoPrompt(shotType: ShotType, description: string): string`, used by Task 3.

- [ ] **Step 1: Add the motion mapping and function**

Append to the end of `miru/src/lib/prompts.ts` (after the existing `buildImagePrompt` function, currently ending at line 35):

```typescript
const SHOT_MOTION: Record<ShotType, string> = {
  wide: 'slow cinematic push-in, subtle environmental movement in the background, gentle camera drift. Cinematic, smooth, 5 seconds.',
  medium: 'gentle handheld movement, subject breathing, natural micro-motion. Cinematic, smooth, 5 seconds.',
  'close-up': 'subtle facial micro-expression, natural blinking and breathing, minimal camera movement, shallow focus holds steady. Cinematic, smooth, 5 seconds.',
  pov: 'handheld drift matching natural head movement, subtle parallax between foreground and background. Cinematic, smooth, 5 seconds.',
  'over-the-shoulder': 'gentle handheld movement, foreground figure stays anchored, subject in the background breathes and shifts naturally. Cinematic, smooth, 5 seconds.',
}

// Motion mapping ported from personalprojects/scenelab-api-test/test-kling.js for 'medium'
// (the only confirmed value); the other four shot types were drafted to match its tone and
// approved during design review (docs/superpowers/specs/2026-07-16-animate-scene-design.md).
export function buildVideoPrompt(shotType: ShotType, description: string): string {
  return [SHOT_MOTION[shotType], description].join('. ')
}
```

- [ ] **Step 2: Verify the build and lint are clean**

Run: `cd miru && npm run build`
Expected: `✓ Compiled successfully`, no TypeScript errors.

Run: `cd miru && npm run lint`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add miru/src/lib/prompts.ts
git commit -m "feat: add buildVideoPrompt motion mapping for Animate Scene"
```

---

### Task 2: `animateScene()` in `lib/fal.ts`

**Files:**
- Modify: `miru/src/lib/fal.ts`

**Interfaces:**
- Consumes: nothing new (uses the existing `fal` client already configured in this file).
- Produces: `animateScene(imageUrl: string, motionPrompt: string): Promise<string>`, used by Task 3.

- [ ] **Step 1: Add the function**

Append to the end of `miru/src/lib/fal.ts` (after the existing `generateImage` function, currently ending at line 25):

```typescript
// Endpoint and duration ported as-is from the smoke-tested
// personalprojects/scenelab-api-test/test-kling.js — do not guess a new slug or param shape.
export async function animateScene(imageUrl: string, motionPrompt: string): Promise<string> {
  const result = await fal.subscribe('fal-ai/kling-video/v1.6/standard/image-to-video', {
    input: {
      prompt: motionPrompt,
      image_url: imageUrl,
      duration: '5',
    },
    logs: false,
  })

  const url = result.data?.video?.url
  if (!url) {
    throw new Error('Video generation failed — no video was returned. Please try again.')
  }

  return url
}
```

- [ ] **Step 2: Verify the build and lint are clean**

Run: `cd miru && npm run build`
Expected: `✓ Compiled successfully`, no TypeScript errors.

Run: `cd miru && npm run lint`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add miru/src/lib/fal.ts
git commit -m "feat: add animateScene FAL client function"
```

---

### Task 3: `generate-scene-video.ts` Server Action

**Files:**
- Create: `miru/src/app/actions/generate-scene-video.ts`

**Interfaces:**
- Consumes: `buildVideoPrompt(shotType, description): string` from Task 1 (`@/lib/prompts`); `animateScene(imageUrl, motionPrompt): Promise<string>` from Task 2 (`@/lib/fal`); `Scene` type from `@/types`.
- Produces: `generateSceneVideo(scene: Scene): Promise<GenerateVideoResult>` where `GenerateVideoResult = { ok: true; videoUrl: string; videoPrompt: string } | { ok: false; error: string }`. Used by Task 5.

- [ ] **Step 1: Write the Server Action**

Create `miru/src/app/actions/generate-scene-video.ts`:

```typescript
'use server'

import { animateScene } from '@/lib/fal'
import { buildVideoPrompt } from '@/lib/prompts'
import type { Scene } from '@/types'

// Kling 1.6 typically takes 2-5 minutes (per test-kling.js); default Server Action /
// serverless timeouts are far shorter, so this needs an explicit extension.
export const maxDuration = 300

export type GenerateVideoResult =
  | { ok: true; videoUrl: string; videoPrompt: string }
  | { ok: false; error: string }

export async function generateSceneVideo(scene: Scene): Promise<GenerateVideoResult> {
  // If a video already exists for this scene, return it instantly rather than re-calling the API.
  if (scene.videoUrl) {
    return { ok: true, videoUrl: scene.videoUrl, videoPrompt: scene.videoPrompt ?? '' }
  }

  try {
    const videoPrompt = buildVideoPrompt(scene.shotType, scene.description)
    const videoUrl = await animateScene(scene.imageUrl ?? '', videoPrompt)
    return { ok: true, videoUrl, videoPrompt }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Video generation failed. Please try again.',
    }
  }
}
```

- [ ] **Step 2: Verify the build and lint are clean**

Run: `cd miru && npm run build`
Expected: `✓ Compiled successfully`, no TypeScript errors.

Run: `cd miru && npm run lint`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add miru/src/app/actions/generate-scene-video.ts
git commit -m "feat: add generateSceneVideo server action"
```

---

### Task 4: `scene-card.tsx` UI — video display and Animate Scene button

**Files:**
- Modify: `miru/src/components/scene-card.tsx`

**Interfaces:**
- Consumes: `Scene` type from `@/types` (already imported). No dependency on Tasks 1-3 — this is a pure UI change to props/rendering.
- Produces: `SceneCardProps` gains `isGeneratingVideo: boolean`, `videoError: string | null`, `onAnimateScene: () => void`. Used by Task 5.

- [ ] **Step 1: Replace the full file contents**

Replace `miru/src/components/scene-card.tsx` in full with:

```tsx
'use client'

import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Scene } from '@/types'

interface SceneCardProps {
  scene: Scene
  isGenerating: boolean
  error: string | null
  onGenerateImage: () => void
  isGeneratingVideo: boolean
  videoError: string | null
  onAnimateScene: () => void
}

export function SceneCard({
  scene,
  isGenerating,
  error,
  onGenerateImage,
  isGeneratingVideo,
  videoError,
  onAnimateScene,
}: SceneCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Scene {scene.number}</span>
          <Badge variant="outline">{scene.shotType}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{scene.description}</p>
        <p className="text-xs text-muted-foreground">{scene.durationSeconds}s</p>

        {isGenerating || isGeneratingVideo ? (
          <Skeleton className="aspect-9/16 w-full rounded-2xl" />
        ) : scene.videoUrl ? (
          <video
            src={scene.videoUrl}
            poster={scene.imageUrl ?? undefined}
            controls
            className="aspect-9/16 w-full rounded-2xl object-cover"
          />
        ) : scene.imageUrl ? (
          <div className="relative aspect-9/16 w-full overflow-hidden rounded-2xl">
            <Image src={scene.imageUrl} alt={scene.description} fill className="object-cover" unoptimized />
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {videoError ? <p className="text-xs text-destructive">{videoError}</p> : null}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {!scene.imageUrl && (
          <Button onClick={onGenerateImage} disabled={isGenerating} className="w-full">
            {isGenerating ? 'Generating…' : 'Generate Image'}
          </Button>
        )}
        {scene.imageUrl && !scene.videoUrl && (
          <Button onClick={onAnimateScene} disabled={isGeneratingVideo} className="w-full">
            {isGeneratingVideo ? 'Animating… (~2-5 min)' : 'Animate Scene'}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
```

- [ ] **Step 2: Verify the build and lint are clean**

Run: `cd miru && npm run build`
Expected: this will currently FAIL — `page.tsx` renders `<SceneCard>` without the three new required props. That's expected; Task 5 fixes it. Confirm the error is specifically about missing `isGeneratingVideo` / `videoError` / `onAnimateScene` props on `<SceneCard>` in `page.tsx`, not something else.

- [ ] **Step 3: Commit**

```bash
git add miru/src/components/scene-card.tsx
git commit -m "feat: add video display and Animate Scene button to scene-card"
```

---

### Task 5: Wire `page.tsx`

**Files:**
- Modify: `miru/src/app/page.tsx`

**Interfaces:**
- Consumes: `generateSceneVideo(scene: Scene): Promise<GenerateVideoResult>` from Task 3 (`@/app/actions/generate-scene-video`); `SceneCardProps` from Task 4.
- Produces: nothing new for later tasks — this is the final wiring task.

- [ ] **Step 1: Add the import**

In `miru/src/app/page.tsx`, add this import alongside the existing action imports (after line 5, `import { generateSceneImage } from '@/app/actions/generate-image'`):

```typescript
import { generateSceneVideo } from '@/app/actions/generate-scene-video'
```

- [ ] **Step 2: Add video-generation state**

After the existing `imageErrors` state declaration (line 44: `const [imageErrors, setImageErrors] = useState<Record<string, string>>({})`), add:

```typescript
  const [generatingVideoIds, setGeneratingVideoIds] = useState<Set<string>>(new Set())
  const [videoErrors, setVideoErrors] = useState<Record<string, string>>({})
```

- [ ] **Step 3: Add the handler**

After the existing `handleGenerateImage` function (ends at line 106), add:

```typescript
  async function handleAnimateScene(scene: Scene) {
    setGeneratingVideoIds((prev) => new Set(prev).add(scene.id))
    setVideoErrors((prev) => ({ ...prev, [scene.id]: '' }))

    const result = await generateSceneVideo(scene)

    if (result.ok) {
      setProject((prev) => ({
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.id === scene.id
            ? { ...s, videoUrl: result.videoUrl, videoPrompt: result.videoPrompt, videoGeneratedAt: new Date().toISOString() }
            : s
        ),
        updatedAt: new Date().toISOString(),
      }))
    } else {
      setVideoErrors((prev) => ({ ...prev, [scene.id]: result.error }))
    }

    setGeneratingVideoIds((prev) => {
      const next = new Set(prev)
      next.delete(scene.id)
      return next
    })
  }
```

- [ ] **Step 4: Pass the new props to `<SceneCard>`**

Replace the existing `<SceneCard>` usage (lines 161-167):

```tsx
            <SceneCard
              key={scene.id}
              scene={scene}
              isGenerating={generatingImageIds.has(scene.id)}
              error={imageErrors[scene.id] || null}
              onGenerateImage={() => handleGenerateImage(scene)}
            />
```

with:

```tsx
            <SceneCard
              key={scene.id}
              scene={scene}
              isGenerating={generatingImageIds.has(scene.id)}
              error={imageErrors[scene.id] || null}
              onGenerateImage={() => handleGenerateImage(scene)}
              isGeneratingVideo={generatingVideoIds.has(scene.id)}
              videoError={videoErrors[scene.id] || null}
              onAnimateScene={() => handleAnimateScene(scene)}
            />
```

- [ ] **Step 5: Verify the build and lint are clean**

Run: `cd miru && npm run build`
Expected: `✓ Compiled successfully`, no TypeScript errors (this also confirms Task 4's expected failure is now resolved).

Run: `cd miru && npm run lint`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add miru/src/app/page.tsx
git commit -m "feat: wire Animate Scene handler into page.tsx"
```

---

### Task 6: Live end-to-end verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: the fully wired feature from Tasks 1-5.
- Produces: nothing for later tasks — this is the final gate before considering the feature done.

- [ ] **Step 1: Confirm `.env.local` has real keys**

Confirm `ANTHROPIC_API_KEY` and `FAL_KEY` are set (do not read or print the file's contents — this repo's `CLAUDE.md` forbids it). If a prior session already verified image generation works live, the keys are already known-good.

- [ ] **Step 2: Start the dev server**

Run: `cd miru && npm run dev`
Expected: `✓ Ready` on `http://localhost:3000` (or the next available port if 3000 is in use — check the terminal output for the actual port).

- [ ] **Step 3: Invoke the `playwright-skill:playwright-skill` plugin to drive the flow**

Use the skill (auto-detects the dev server, writes its script to `/tmp`) to:
1. Navigate to the app.
2. Fill in a short script and a character description.
3. Click "Generate Storyboard" and wait for scene cards to render.
4. Click "Generate Image" on the first scene card and wait for the image to render.
5. Click "Animate Scene" on that same card.
6. Wait up to 5 minutes for a `<video>` element to appear with a non-empty `src` pointing at a real FAL-hosted URL (not a blob/data URL).
7. Confirm the `<video>` element has both `controls` and a `poster` attribute set.
8. Check for any console errors during the whole flow.

- [ ] **Step 4: Confirm no errors and a real video URL**

Expected: no console errors, no `.text-destructive` error text visible on the animated scene's card, and the `<video src>` is a real `https://` FAL URL.

If the call fails (e.g. the `duration: '5'` param is rejected — flagged as an open risk in the design spec), read the actual error message returned, fix `lib/fal.ts`'s input shape to match what FAL's API actually expects, and re-run from Step 2.

- [ ] **Step 5: Clean up and final commit if fixes were needed**

If Step 4 required a fix to `lib/fal.ts`, stage and commit it:

```bash
git add miru/src/lib/fal.ts
git commit -m "fix: correct Kling 1.6 param shape based on live API response"
```

If no fixes were needed, this task requires no commit — it's a pure verification pass.

---

## Self-Review Notes

- **Spec coverage:** Motion mapping (Task 1), `lib/fal.ts` client (Task 2), Server Action + `maxDuration` (Task 3), UI display/button (Task 4), page wiring (Task 5), and live verification via `playwright-skill` (Task 6) all map directly to sections in `docs/superpowers/specs/2026-07-16-animate-scene-design.md`. The spec's "Open risk" (unconfirmed `duration` param) is explicitly handled in Task 6 rather than guessed at earlier.
- **No unit tests:** deliberate, not an oversight — see Global Constraints. This repo has no test runner, and the established convention (reused from scene breakdown / image gen / persistence work) is live E2E verification.
- **Type consistency:** `GenerateVideoResult` (Task 3) matches the shape consumed in Task 5's `handleAnimateScene`. `SceneCardProps` (Task 4) matches exactly what Task 5 passes into `<SceneCard>`. `buildVideoPrompt` (Task 1) and `animateScene` (Task 2) signatures match how Task 3 calls them.
