import { fal } from '@fal-ai/client'

fal.config({
  credentials: process.env.FAL_KEY,
})

// Endpoint and image_size ported as-is from the smoke-tested
// personalprojects/scenelab-api-test/test-flux.js — do not guess a new slug or enum.
export async function generateImage(prompt: string): Promise<string> {
  const result = await fal.subscribe('fal-ai/flux-pro/v1.1', {
    input: {
      prompt,
      image_size: 'portrait_16_9',
      num_images: 1,
      // The FLUX safety checker FALSE-POSITIVES on ordinary storyboard prompts and returns
      // an all-black frame with has_nsfw_concepts=[true]. Verified by ablation
      // (scripts/ablation-black-frame.mjs): an identical 464-word prompt is blacked out at
      // the default tolerance but renders cleanly at safety_tolerance '6'; toggling
      // enable_safety_checker had no effect. '5' cuts the false blackouts while keeping a
      // guardrail. This is a parameter fix, not a prompt change.
      safety_tolerance: '5',
    },
    logs: false,
  })

  const data = result.data as { images?: { url?: string }[]; has_nsfw_concepts?: boolean[] } | undefined
  const url = data?.images?.[0]?.url
  const flagged = Array.isArray(data?.has_nsfw_concepts) && data.has_nsfw_concepts.some(Boolean)

  // Secret-safe provider-shape diagnostic (dev only): request id + response shape, no URL/key.
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[render] fal',
      JSON.stringify({
        requestId: (result as { requestId?: string }).requestId,
        dataKeys: Object.keys(data ?? {}),
        images: Array.isArray(data?.images) ? data.images.length : 0,
        urlPresent: !!url,
        nsfwFlagged: flagged,
      })
    )
  }

  // A flagged frame comes back all-black; surface a specific, actionable error rather than
  // returning a silently-black asset (which the app would otherwise treat as a valid image).
  if (flagged) {
    throw new Error(
      'The image provider’s safety filter blocked this frame as sensitive. Try rephrasing the shot (avoid ambiguous body/contact wording), or reduce the number of clauses.'
    )
  }
  if (!url) {
    throw new Error('fal returned no image URL in the response. Please try again.')
  }

  return url
}

// Endpoint and params ported as-is from the smoke-tested
// personalprojects/scenelab-api-test/test-kling.js; duration '10' additionally validated
// live 2026-07-18 (test-kling-10s.js, ~4.7 min). Only these two values are tested.
export async function animateMoment(
  imageUrl: string,
  motionPrompt: string,
  duration: '5' | '10' = '5'
): Promise<string> {
  const result = await fal.subscribe('fal-ai/kling-video/v1.6/standard/image-to-video', {
    input: {
      prompt: motionPrompt,
      image_url: imageUrl,
      duration,
    },
    logs: false,
  })

  const url = result.data?.video?.url
  if (!url) {
    throw new Error('Video generation failed — no video was returned. Please try again.')
  }

  return url
}

// Uploads a browser-captured frame (JPEG data URL) to FAL storage and returns a fetchable
// https URL. Used when a bridge must start from the final frame of an animated moment —
// FAL keyframe params want a URL, and storage upload keeps the queue payload small.
export async function uploadFrame(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(',')[1]
  if (!base64) {
    throw new Error('Frame upload failed — the captured frame was empty. Please try again.')
  }
  const blob = new Blob([Buffer.from(base64, 'base64')], { type: 'image/jpeg' })
  return fal.storage.upload(blob)
}

// Endpoint and params ported as-is from the smoke-tested
// personalprojects/scenelab-api-test/test-kling-transition.js (validated live 2026-07-16,
// ~60s on Standard tier) — do not guess a new slug or param shape.
export async function generateBridge(
  startImageUrl: string,
  endImageUrl: string,
  transitionPrompt: string
): Promise<string> {
  const result = await fal.subscribe('fal-ai/kling-video/o3/standard/image-to-video', {
    input: {
      image_url: startImageUrl,
      end_image_url: endImageUrl,
      prompt: transitionPrompt,
      duration: '5',
      generate_audio: false,
    },
    logs: false,
  })

  const url = result.data?.video?.url
  if (!url) {
    throw new Error('Bridge generation failed — no video was returned. Please try again.')
  }

  return url
}
