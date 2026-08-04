'use server'

import { mirrorAsset } from '@/lib/asset-store'
import { animateMoment } from '@/lib/fal'
import { beginGeneration, tokenCost } from '@/lib/metering'
import { buildVideoPrompt } from '@/lib/prompts'
import type { Moment } from '@/types'

// Kling 1.6 typically takes 2-5 minutes (per test-kling.js); default Server Action
// timeouts are far shorter. Next.js only recognizes `maxDuration` as route segment
// config in page.tsx/layout.tsx/route.ts — not in an action file itself (a 'use server'
// file may only export async functions) — so the extension is set in page.tsx instead,
// where it applies to every Server Action used on that page.

export type GenerateVideoResult =
  // videoStoragePath is the durable reference for a mirrored clip; null means the clip lives
  // only at the (temporary) provider URL.
  | { ok: true; videoUrl: string; videoPrompt: string; videoStoragePath: string | null }
  | { ok: false; error: string }

export async function generateMomentVideo(moment: Moment): Promise<GenerateVideoResult> {
  // If a video already exists for this moment, return it instantly rather than re-calling
  // the API — a cached hit is free (no tokens spent).
  if (moment.videoUrl) {
    return {
      ok: true,
      videoUrl: moment.videoUrl,
      videoPrompt: moment.videoPrompt ?? '',
      videoStoragePath: moment.videoStoragePath ?? null,
    }
  }

  const meter = await beginGeneration(tokenCost.clip(), 'spend:clip', moment.id)
  if (!meter.ok) return { ok: false, error: meter.error }

  try {
    // Long moments (8-10s) get 10-second clips; everything else the validated 5s.
    const clipSeconds = moment.durationSeconds >= 8 ? 10 : 5
    // motion (forward change from the start frame) drives the clip; description is the
    // legacy fallback for pre-split moments.
    const videoPrompt = buildVideoPrompt(moment.shotType, moment.motion ?? moment.description, clipSeconds)
    const videoUrl = await animateMoment(moment.imageUrl ?? '', videoPrompt, clipSeconds === 10 ? '10' : '5')
    // Mirror into Storage so the clip outlives fal's CDN URL. Best-effort — a failure keeps
    // the provider URL rather than losing a paid generation.
    const mirrored = await mirrorAsset(videoUrl, 'clip', moment.id)
    return {
      ok: true,
      videoUrl: mirrored?.url ?? videoUrl,
      videoPrompt,
      videoStoragePath: mirrored?.path ?? null,
    }
  } catch (err) {
    await meter.refund()
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Video generation failed. Please try again.',
    }
  }
}
