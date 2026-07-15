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
