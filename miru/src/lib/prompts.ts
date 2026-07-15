import type { ShotType, StylePreset } from '@/types'

const STYLE_PREFIXES: Record<StylePreset, string> = {
  cinematic: 'cinematic photography, 35mm film grain, dramatic chiaroscuro lighting, shallow depth of field, subtle anamorphic lens flare',
  anime: 'anime key visual, cel-shaded, vibrant saturated colors, clean linework, dynamic composition',
  illustrated: 'digital illustration, painterly brushwork, rich color grading, storybook atmosphere',
  'hyper-realistic': 'hyper-realistic render, photoreal detail, natural lighting, high dynamic range, physically accurate materials',
}

const SHOT_LABELS: Record<ShotType, string> = {
  wide: 'wide shot, full scene and environment visible',
  medium: 'medium shot, subject from waist up',
  'close-up': 'close-up shot, tight framing on subject',
  pov: 'point-of-view shot, seen through the subject\'s eyes',
  'over-the-shoulder': 'over-the-shoulder shot, subject framed past a foreground figure',
}

// Mirrors the prompt structure smoke-tested in
// personalprojects/scenelab-api-test/test-flux.js: style prefix, character description,
// shot label, scene description, consistency reminder, then the fixed format constraints.
export function buildImagePrompt(
  stylePreset: StylePreset,
  characterDescription: string,
  shotType: ShotType,
  description: string
): string {
  return [
    STYLE_PREFIXES[stylePreset],
    `Main character: ${characterDescription}`,
    SHOT_LABELS[shotType],
    description,
    'maintain consistent character identity, facial features, hairstyle, wardrobe, color palette, lighting direction, and cinematic atmosphere from the previous image',
    'vertical 9:16 composition, portrait orientation, Instagram Reels format, no text or watermarks',
  ].join('. ')
}

const SHOT_MOTION: Record<ShotType, string> = {
  wide: 'slow cinematic push-in, subtle environmental movement in the background, gentle camera drift. Cinematic, smooth, 5 seconds.',
  medium: 'gentle handheld movement, subject breathing, natural micro-motion. Cinematic, smooth, 5 seconds.',
  'close-up': 'subtle facial micro-expression, natural blinking and breathing, minimal camera movement, shallow focus holds steady. Cinematic, smooth, 5 seconds.',
  pov: 'handheld drift matching natural head movement, subtle parallax between foreground and background. Cinematic, smooth, 5 seconds.',
  'over-the-shoulder': 'gentle handheld movement, foreground figure stays anchored, subject in the background breathes and shifts naturally. Cinematic, smooth, 5 seconds.',
}

// Motion mapping ported from personalprojects/scenelab-api-test/test-kling.js for 'medium'
// (the only confirmed value); the other four shot types were drafted to match its tone and
// approved during design review (docs/superpowers/specs/2026-07-16-animate-scene-design.md).
export function buildVideoPrompt(shotType: ShotType, description: string): string {
  return [SHOT_MOTION[shotType], description].join('. ')
}
