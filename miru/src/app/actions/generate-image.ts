'use server'

import { generateImage } from '@/lib/fal'
import { buildImagePrompt } from '@/lib/prompts'
import type { Moment, StylePreset } from '@/types'

export type GenerateImageResult =
  | { ok: true; imageUrl: string; imagePrompt: string }
  | { ok: false; error: string }

export async function generateMomentImage(
  moment: Moment,
  stylePreset: StylePreset,
  characterDescription: string
): Promise<GenerateImageResult> {
  // If an image already exists for this moment, return it instantly rather than re-calling the API.
  if (moment.imageUrl) {
    return { ok: true, imageUrl: moment.imageUrl, imagePrompt: moment.imagePrompt ?? '' }
  }

  try {
    const imagePrompt = buildImagePrompt(stylePreset, characterDescription, moment.shotType, moment.description)
    const imageUrl = await generateImage(imagePrompt)
    return { ok: true, imageUrl, imagePrompt }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Image generation failed. Please try again.',
    }
  }
}
