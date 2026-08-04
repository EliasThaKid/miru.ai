'use server'

import { createHash, randomUUID } from 'node:crypto'
import { mirrorBytes } from '@/lib/asset-store'
import { generateImage } from '@/lib/fal'
import { AssetError, fetchAndDecodeImage, type RenderStage } from '@/lib/image-validate'
import { beginGeneration, tokenCost } from '@/lib/metering'
import { resolveImagePrompt } from '@/lib/prompts'
import type { Moment, StylePreset } from '@/types'

export type GenerateImageResult =
  // imageStoragePath is the durable reference for a mirrored still; null means the still
  // lives only at the (temporary) provider URL.
  | { ok: true; imageUrl: string; imagePrompt: string; imageStoragePath: string | null }
  | { ok: false; error: string; stage: RenderStage }

const DEV = process.env.NODE_ENV !== 'production'
const MODEL = 'fal-ai/flux-pro/v1.1'

// Secret-safe staged diagnostics (dev only). Never logs the prompt text, the image URL, or
// any credential — only a prompt hash/length, the URL host, and sanitized shape metadata.
function diag(fields: Record<string, unknown>): void {
  if (DEV) console.log('[render]', JSON.stringify(fields))
}
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'invalid-url'
  }
}

export async function generateMomentImage(
  moment: Moment,
  stylePreset: StylePreset,
  characterDescription: string,
  // Intentional user override (moment.userPromptOverride). Used verbatim when present;
  // otherwise the prompt is freshly composed from the current state. This is NOT the
  // stored provenance prompt — passing that here is what previously froze regeneration.
  promptOverride?: string | null,
  // The assigned Setting's description (location continuity segment).
  settingDescription?: string | null,
  // The assigned cast NAMES for the explicit required-presence directive.
  characterNames: string[] = [],
  // Optional batch grouping id for diagnostics (individual renders pass none).
  batchId?: string
): Promise<GenerateImageResult> {
  // If an image already exists for this moment, return it instantly rather than re-calling
  // the API — a cached hit is free (no tokens spent).
  if (moment.imageUrl) {
    return {
      ok: true,
      imageUrl: moment.imageUrl,
      imagePrompt: moment.imagePrompt ?? '',
      imageStoragePath: moment.imageStoragePath ?? null,
    }
  }

  // Reserve tokens before any paid work; refund on failure below.
  const meter = await beginGeneration(tokenCost.still(), 'spend:still', moment.id)
  if (!meter.ok) return { ok: false, error: meter.error, stage: 'compose' }

  const attemptId = randomUUID().slice(0, 8)
  let stage: RenderStage = 'compose'
  try {
    // ---- compose ----
    // startFrame (frozen opening instant) drives the still; description is the legacy fallback.
    const imagePrompt = resolveImagePrompt({
      override: promptOverride,
      stylePreset,
      characterDescription,
      shotType: moment.shotType,
      composition: moment.startFrame ?? moment.description,
      settingDescription,
      characterNames,
      visualFocus: moment.visualFocus,
      blocking: moment.blocking,
    })
    diag({
      stage: 'compose',
      attemptId,
      batchId,
      momentId: moment.id,
      model: MODEL,
      promptLen: imagePrompt.length,
      promptHash: createHash('sha256').update(imagePrompt).digest('hex').slice(0, 10),
      payloadKeys: ['prompt', 'image_size', 'num_images'], // referenceImage is never sent to fal
    })

    // ---- submit + provider ----
    stage = 'provider'
    const t0 = Date.now()
    const imageUrl = await generateImage(imagePrompt)
    diag({ stage: 'provider', attemptId, ms: Date.now() - t0, urlPresent: !!imageUrl, host: hostOf(imageUrl) })

    // ---- asset-fetch + asset-decode (decode is the authority) ----
    stage = 'asset-fetch'
    const asset = await fetchAndDecodeImage(imageUrl)
    diag({
      stage: 'asset',
      attemptId,
      contentType: asset.contentType,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      format: asset.format,
      uniform: asset.uniform,
    })
    // A suspiciously uniform/near-black frame is KEPT (still a success) but flagged for review.
    if (asset.uniform) {
      diag({ stage: 'review', attemptId, momentId: moment.id, warning: 'suspiciously uniform/near-black frame — kept, flagged for manual review' })
    }

    // ---- persist ----
    // Mirror the validated bytes into the user's Storage folder so the project doesn't rot
    // when fal's CDN URL expires. Best-effort: a failure keeps the provider URL.
    stage = 'persist'
    const mirrored = await mirrorBytes(asset.buffer, asset.contentType, 'still', moment.id, imageUrl)
    diag({ stage: 'persist', attemptId, mirrored: !!mirrored })

    return {
      ok: true,
      imageUrl: mirrored?.url ?? imageUrl,
      imagePrompt,
      imageStoragePath: mirrored?.path ?? null,
    }
  } catch (err) {
    // No usable image was produced — refund the reserved tokens.
    await meter.refund()
    const failStage: RenderStage = err instanceof AssetError ? err.stage : stage
    const message = err instanceof Error ? err.message : 'Image generation failed. Please try again.'
    diag({
      stage: 'failed',
      attemptId,
      batchId,
      momentId: moment.id,
      failStage,
      error: err instanceof Error ? `${err.name}: ${message}` : String(err),
    })
    // Retain a useful reason in the UI; in dev, prefix the exact failing stage.
    return { ok: false, error: DEV ? `[${failStage}] ${message}` : message, stage: failStage }
  }
}
