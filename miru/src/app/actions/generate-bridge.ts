'use server'

import { generateBridge, uploadFrame } from '@/lib/fal'
import { buildTransitionPrompt } from '@/lib/prompts'
import type { Moment, Transition } from '@/types'

export type GenerateBridgeResult =
  | { ok: true; videoUrl: string; transitionPrompt: string }
  | { ok: false; error: string }

export async function generateBridgeVideo(
  fromMoment: Moment,
  toMoment: Moment,
  existing: Transition | null,
  bridgeDirection: string | null,
  // Final frame of the "from" moment's animated clip (JPEG data URL, captured client-side).
  // When present, the bridge starts where the animation actually ends instead of jumping
  // back to the moment's still image. The "to" side needs no equivalent: a bridge ends on
  // toMoment's image, which is exactly where that moment's own animation begins.
  startFrameDataUrl: string | null
): Promise<GenerateBridgeResult> {
  // If a bridge was already generated for this pair, return it instantly rather than
  // re-calling the API — even if the pair is currently set to Hard Cut.
  if (existing?.videoUrl) {
    return { ok: true, videoUrl: existing.videoUrl, transitionPrompt: existing.transitionPrompt ?? '' }
  }

  if (!fromMoment.imageUrl || !toMoment.imageUrl) {
    return { ok: false, error: 'Both moments need images before a bridge can be generated.' }
  }

  try {
    const startImageUrl = startFrameDataUrl ? await uploadFrame(startFrameDataUrl) : fromMoment.imageUrl
    const transitionPrompt = buildTransitionPrompt(fromMoment.description, toMoment.description, bridgeDirection)
    const videoUrl = await generateBridge(startImageUrl, toMoment.imageUrl, transitionPrompt)
    return { ok: true, videoUrl, transitionPrompt }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Bridge generation failed. Please try again.',
    }
  }
}
