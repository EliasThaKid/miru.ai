'use server'

import { generateBridge } from '@/lib/fal'
import { buildTransitionPrompt } from '@/lib/prompts'
import type { Moment, Transition } from '@/types'

export type GenerateBridgeResult =
  | { ok: true; videoUrl: string; transitionPrompt: string }
  | { ok: false; error: string }

export async function generateBridgeVideo(
  fromMoment: Moment,
  toMoment: Moment,
  existing: Transition | null,
  bridgeDirection: string | null
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
    const transitionPrompt = buildTransitionPrompt(fromMoment.description, toMoment.description, bridgeDirection)
    const videoUrl = await generateBridge(fromMoment.imageUrl, toMoment.imageUrl, transitionPrompt)
    return { ok: true, videoUrl, transitionPrompt }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Bridge generation failed. Please try again.',
    }
  }
}
