'use server'

import { generateImage } from '@/lib/fal'
import { buildImagePrompt } from '@/lib/prompts'
import type { Scene, StylePreset } from '@/types'

export type GenerateImageResult =
  | { ok: true; imageUrl: string; imagePrompt: string }
  | { ok: false; error: string }

export async function generateSceneImage(
  scene: Scene,
  stylePreset: StylePreset,
  characterDescription: string
): Promise<GenerateImageResult> {
  // If an image already exists for this scene, return it instantly rather than re-calling the API.
  if (scene.imageUrl) {
    return { ok: true, imageUrl: scene.imageUrl, imagePrompt: scene.imagePrompt ?? '' }
  }

  try {
    const imagePrompt = buildImagePrompt(stylePreset, characterDescription, scene.shotType, scene.description)
    const imageUrl = await generateImage(imagePrompt)
    return { ok: true, imageUrl, imagePrompt }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Image generation failed. Please try again.',
    }
  }
}
