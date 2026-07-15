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
