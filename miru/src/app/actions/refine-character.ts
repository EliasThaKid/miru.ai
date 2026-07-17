'use server'

import { refineCharacter } from '@/lib/anthropic'

export type RefineCharacterResult =
  | { ok: true; refined: string; notes: string[] }
  | { ok: false; error: string }

export async function refineCharacterDescription(
  script: string,
  description: string
): Promise<RefineCharacterResult> {
  if (!script.trim() && !description.trim()) {
    return { ok: false, error: 'Add a script or a character description first.' }
  }

  try {
    const result = await refineCharacter(script, description)
    return { ok: true, refined: result.refined, notes: result.notes }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Refinement failed. Please try again.',
    }
  }
}
