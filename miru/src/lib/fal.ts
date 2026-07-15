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
