'use server'

import { generateBridge, generateImage } from '@/lib/fal'
import { beginGeneration, tokenCost } from '@/lib/metering'
import { buildImagePrompt, buildVideoPrompt } from '@/lib/prompts'
import type { Moment, StylePreset } from '@/types'

export type GenerateAnchoredVideoResult =
  | { ok: true; videoUrl: string; videoPrompt: string; endImageUrl: string }
  | { ok: false; error: string }

// Dual-keyframe animation: renders the moment's END pose as a second still, then animates
// start→end with Kling O3 (the same validated dual-keyframe endpoint bridges use). With
// both frames pinned, reversed action staging is structurally impossible. 5s only — O3 is
// not smoke-tested at 10s.
export async function generateAnchoredMomentVideo(
  moment: Moment,
  stylePreset: StylePreset,
  characterDescription: string,
  settingDescription?: string | null,
  characterNames: string[] = []
): Promise<GenerateAnchoredVideoResult> {
  if (!moment.imageUrl) {
    return { ok: false, error: 'Render the frame first — anchored animation starts from it.' }
  }
  if (moment.durationSeconds >= 8) {
    return { ok: false, error: 'Anchored animation supports 5-second clips only (Kling O3 is not validated at 10s).' }
  }

  // Cost = one O3 clip, plus one still only when we must render a fresh end pose (a reused
  // endImageUrl is already paid for).
  const amount = tokenCost.clip() + (moment.endImageUrl ? 0 : tokenCost.still())
  const meter = await beginGeneration(amount, 'spend:anchored', moment.id)
  if (!meter.ok) return { ok: false, error: meter.error }

  try {
    // Reuse a previously paid end still; otherwise render the closing pose.
    let endImageUrl = moment.endImageUrl ?? null
    if (!endImageUrl) {
      endImageUrl = await generateImage(
        buildImagePrompt(
          stylePreset,
          characterDescription,
          moment.shotType,
          moment.endFrame ?? moment.description,
          settingDescription,
          characterNames,
          moment.visualFocus,
          moment.blocking
        )
      )
    }

    const videoPrompt = buildVideoPrompt(moment.shotType, moment.motion ?? moment.description, 5)
    const videoUrl = await generateBridge(moment.imageUrl, endImageUrl, videoPrompt)
    return { ok: true, videoUrl, videoPrompt, endImageUrl }
  } catch (err) {
    await meter.refund()
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Anchored animation failed. Please try again.',
    }
  }
}
