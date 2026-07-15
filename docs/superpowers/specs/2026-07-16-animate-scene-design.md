# Animate Scene (Kling 1.6 image-to-video) — Design

## Context

Week 1 vertical slice (script → scene breakdown → image) is done and verified live. This is
the next sub-project in the "impressive cinematic video ASAP" build order, decomposed as:

1. **Animate Scene** (this spec) — per-scene image-to-video
2. Chain Transition (Kling O3 Standard) — scene-to-scene transitions
3. Animatic preview (Screen 4) — sequenced playback

Source of truth for the app's locked conventions is `miru/CLAUDE.md`. This spec only covers
what's new for Animate Scene; it doesn't relitigate architecture already decided there
(no auth/database, Server Actions own all AI calls, localStorage-only persistence, etc).

## Goal

Let a user turn a scene's generated image into a short animated clip via FAL.ai Kling 1.6,
opt-in per scene, triggered by an "Animate Scene" button on the existing scene card.

## Non-goals

- Scene-to-scene transitions (separate sub-project, Chain Transition).
- Animatic assembly/playback (separate sub-project).
- Regenerating a video once one exists (no "regenerate" affordance — same as image gen today).
- Matching video length to `scene.durationSeconds` — always requests a fixed 5s clip from
  Kling (see Decisions below).

## Motion prompt mapping

`buildVideoPrompt(shotType, description)` in `lib/prompts.ts`, alongside the existing
`buildImagePrompt()`. Prepends a per-shot-type motion description, appends the scene's visual
description. No style-preset or character-consistency lines (not applicable to motion).

Only `medium` is a confirmed value, ported verbatim from `test-kling.js`. The other four were
drafted for this spec, matching its tone (movement type + natural micro-motion + fixed
"Cinematic, smooth, 5 seconds." suffix), and approved by the user during design review:

- **medium** *(confirmed, ported from test-kling.js)*: "gentle handheld movement, subject
  breathing, natural micro-motion. Cinematic, smooth, 5 seconds."
- **wide**: "slow cinematic push-in, subtle environmental movement in the background, gentle
  camera drift. Cinematic, smooth, 5 seconds."
- **close-up**: "subtle facial micro-expression, natural blinking and breathing, minimal
  camera movement, shallow focus holds steady. Cinematic, smooth, 5 seconds."
- **pov**: "handheld drift matching natural head movement, subtle parallax between foreground
  and background. Cinematic, smooth, 5 seconds."
- **over-the-shoulder**: "gentle handheld movement, foreground figure stays anchored, subject
  in the background breathes and shifts naturally. Cinematic, smooth, 5 seconds."

## lib/fal.ts

New export `animateScene(imageUrl: string, motionPrompt: string): Promise<string>`, ported
as-is from `test-kling.js`:

- Endpoint: `fal-ai/kling-video/v1.6/standard/image-to-video`
- Input: `{ prompt: motionPrompt, image_url: imageUrl, duration: '5' }`
- Same shape/error-handling as the existing `generateImage()`: throws a human-readable error
  if no video URL comes back.

## app/actions/generate-scene-video.ts

Mirrors `generate-image.ts`:

- `export const maxDuration = 300` (5 min) — matches the "typically 2-5 min" note in
  `test-kling.js`. If real-world calls exceed this, it'll surface as a failure in testing and
  get bumped then, rather than over-engineering a polling architecture now.
- Idempotency: if `scene.videoUrl` already exists, return it instantly — no re-call.
- Builds the prompt via `buildVideoPrompt(scene.shotType, scene.description)`.
- Returns `{ ok: true; videoUrl: string; videoPrompt: string } | { ok: false; error: string }`,
  same union pattern as `generate-image.ts`.
- No new input validation — the UI only shows the trigger once `scene.imageUrl` exists, and
  the app has no auth boundary to defend against direct-POST abuse.

## UI: scene-card.tsx + page.tsx

`SceneCard` gets new props: `isGeneratingVideo`, `videoError`, `onAnimateScene`.

- **Trigger**: "Animate Scene" button, shown once `scene.imageUrl` exists and
  `scene.videoUrl` doesn't yet. Disabled while generating.
- **Loading label**: "Animating… (~2-5 min)" — explicit wait-time framing, since this call is
  10-50x slower than image gen and a bare spinner would read as broken.
- **On success**: media slot switches from image/skeleton to a native
  `<video src={scene.videoUrl} poster={scene.imageUrl} controls />` (per `CLAUDE.md`: native
  tag only, no FFmpeg/Remotion). No autoplay/loop — user-initiated playback.
- **Error**: same `text-destructive` pattern as image errors.

`page.tsx` adds `handleAnimateScene`, mirroring `handleGenerateImage`: a
`generatingVideoIds: Set<string>` and `videoErrors: Record<string, string>`, calling the new
Server Action and merging `videoUrl` / `videoPrompt` / `videoGeneratedAt` into the scene on
success.

## Testing

Same live-verification approach used for scene breakdown and image gen, but via the
`playwright-skill:playwright-skill` plugin (auto-detects the dev server, writes test scripts
to `/tmp`) instead of the ad-hoc temp-install-and-delete approach used earlier in this
project — no reason to keep reinventing that per feature. Flow: generate a scene image, click
"Animate Scene," confirm a `<video>` renders with a real FAL-hosted URL and `controls`/`poster`
are set correctly, check `npm run build` / `npm run lint` are clean.

## Open risk

`duration: '5'` is ported from a script whose own comment flags the exact param
name/type as unconfirmed against current Kling 1.6 docs (string vs number varies by FAL model
version — same category of risk we hit and resolved for FLUX's `image_size`). If the live call
rejects this param shape, that's a live-testing fix, not a design gap.
