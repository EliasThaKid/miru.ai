'use server'

import { extractContext } from '@/lib/anthropic'
import { requireGenerationAccess } from '@/lib/metering'

export type ExtractContextResult =
  | { ok: true; characters: { name: string; description: string }[]; settings: { name: string; description: string }[] }
  | { ok: false; error: string }

export async function extractScriptContext(script: string): Promise<ExtractContextResult> {
  if (!script.trim()) {
    return { ok: false, error: 'Paste a script first.' }
  }

  // This one fires AUTOMATICALLY on a substantial paste, so ungated it meant a stranger
  // could spend the owner's Anthropic budget without clicking anything.
  const access = await requireGenerationAccess()
  if (!access.ok) return { ok: false, error: access.error }

  try {
    const { characters, settings } = await extractContext(script)
    return { ok: true, characters, settings }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Detection failed. Please try again.',
    }
  }
}
