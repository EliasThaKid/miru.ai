'use server'

import { breakdownScenes } from '@/lib/anthropic'
import type { Scene } from '@/types'

export type GenerateScenesResult = { ok: true; scenes: Scene[] } | { ok: false; error: string }

export async function generateScenes(script: string): Promise<GenerateScenesResult> {
  try {
    const { scenes } = await breakdownScenes(script)

    return {
      ok: true,
      scenes: scenes.map((scene) => ({
        id: crypto.randomUUID(),
        number: scene.number,
        shotType: scene.shotType,
        description: scene.description,
        durationSeconds: scene.durationSeconds,
        imageUrl: null,
        imagePrompt: null,
        videoUrl: null,
        videoPrompt: null,
        imageGeneratedAt: null,
        videoGeneratedAt: null,
      })),
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Something went wrong generating the storyboard. Please try again.',
    }
  }
}
