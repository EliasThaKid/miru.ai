'use server'

import { animateMoment } from '@/lib/fal'
import { buildVideoPrompt } from '@/lib/prompts'
import type { Moment } from '@/types'

// Kling 1.6 typically takes 2-5 minutes (per test-kling.js); default Server Action
// timeouts are far shorter. Next.js only recognizes `maxDuration` as route segment
// config in page.tsx/layout.tsx/route.ts — not in an action file itself (a 'use server'
// file may only export async functions) — so the extension is set in page.tsx instead,
// where it applies to every Server Action used on that page.

export type GenerateVideoResult =
  | { ok: true; videoUrl: string; videoPrompt: string }
  | { ok: false; error: string }

export async function generateMomentVideo(moment: Moment): Promise<GenerateVideoResult> {
  // If a video already exists for this moment, return it instantly rather than re-calling the API.
  if (moment.videoUrl) {
    return { ok: true, videoUrl: moment.videoUrl, videoPrompt: moment.videoPrompt ?? '' }
  }

  try {
    const videoPrompt = buildVideoPrompt(moment.shotType, moment.description)
    const videoUrl = await animateMoment(moment.imageUrl ?? '', videoPrompt)
    return { ok: true, videoUrl, videoPrompt }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Video generation failed. Please try again.',
    }
  }
}
