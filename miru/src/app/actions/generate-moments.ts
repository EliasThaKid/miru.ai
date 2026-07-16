'use server'

import { breakdownMoments } from '@/lib/anthropic'
import type { Moment } from '@/types'

export type GenerateMomentsResult = { ok: true; moments: Moment[] } | { ok: false; error: string }

export async function generateMoments(script: string): Promise<GenerateMomentsResult> {
  try {
    const { moments } = await breakdownMoments(script)

    return {
      ok: true,
      moments: moments.map((moment) => ({
        id: crypto.randomUUID(),
        number: moment.number,
        shotType: moment.shotType,
        description: moment.description,
        durationSeconds: moment.durationSeconds,
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
