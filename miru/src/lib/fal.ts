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
    },
    logs: false,
  })

  const url = result.data?.images?.[0]?.url
  if (!url) {
    throw new Error('Image generation failed — no image was returned. Please try again.')
  }

  return url
}

// Endpoint and duration ported as-is from the smoke-tested
// personalprojects/scenelab-api-test/test-kling.js — do not guess a new slug or param shape.
export async function animateMoment(imageUrl: string, motionPrompt: string): Promise<string> {
  const result = await fal.subscribe('fal-ai/kling-video/v1.6/standard/image-to-video', {
    input: {
      prompt: motionPrompt,
      image_url: imageUrl,
      duration: '5',
    },
    logs: false,
  })

  const url = result.data?.video?.url
  if (!url) {
    throw new Error('Video generation failed — no video was returned. Please try again.')
  }

  return url
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
