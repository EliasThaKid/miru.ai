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
// personalprojects/scenelab-api-test/test-flux.js: style prefix, character description(s),
// shot label, moment description, consistency reminder, then the fixed format constraints.
// characterDescription is the composed cast (see composeCharacterDescription) and may be
// empty, in which case the segment is omitted rather than emitting "Main character: ".
// `composition` should be the moment's startFrame (frozen opening instant) when
// available — passing the full action-arc description makes the model render the
// completed action, which is what caused reversed-motion clips. settingDescription
// is the assigned Setting's description (location continuity); omitted when absent.
export function buildImagePrompt(
  stylePreset: StylePreset,
  characterDescription: string,
  shotType: ShotType,
  composition: string,
  settingDescription?: string | null
): string {
  return [
    STYLE_PREFIXES[stylePreset],
    characterDescription.trim() ? `Main character${characterDescription.includes(';') ? 's' : ''}: ${characterDescription}` : null,
    settingDescription?.trim() ? `Setting: ${settingDescription.trim()}` : null,
    SHOT_LABELS[shotType],
    composition,
    'maintain consistent character identity, facial features, hairstyle, wardrobe, color palette, lighting direction, and cinematic atmosphere from the previous image',
    'vertical 9:16 composition, portrait orientation, Instagram Reels format, no text or watermarks',
  ]
    .filter((segment): segment is string => segment !== null)
    .join('. ')
}

// Advisory (not blocking) — a description this thin tends to produce inconsistent
// generations. Same bar the extraction prompt is validated against. Used for both
// character and setting descriptions in compose.
export function isDescriptionWeak(description: string): boolean {
  const trimmed = description.trim()
  if (!trimmed) return false // empty is a separate "not filled in" state, not "too weak"
  const words = trimmed.split(/\s+/).filter(Boolean).length
  return words < 8 || trimmed.length < 50
}

// The Setting assigned to a moment, or null when unassigned.
export function settingForMoment<T extends { name: string }>(
  settings: T[],
  locationName: string | null | undefined
): T | null {
  if (!locationName) return null
  return settings.find((s) => s.name.trim() === locationName.trim()) ?? null
}

// The cast that actually belongs in a given moment's frame. undefined/null assignment =
// legacy data → whole cast (the old behavior); [] = deliberately nobody on screen.
export function castForMoment<T extends { name: string }>(
  characters: T[],
  characterNames: string[] | null | undefined
): T[] {
  if (characterNames === null || characterNames === undefined) return characters
  const names = new Set(characterNames.map((n) => n.trim()))
  return characters.filter((c) => names.has(c.name.trim()))
}

// Flattens the cast into one prompt segment: "Maya — young woman, dark bob; Theo — tall
// man in a grey coat". Characters without descriptions are skipped; a single unnamed
// character passes through as a bare description (matching the original tested format).
export function composeCharacterDescription(characters: { name: string; description: string }[]): string {
  const described = characters.filter((c) => c.description.trim())
  if (described.length === 0) return ''
  if (described.length === 1 && !described[0].name.trim()) return described[0].description.trim()
  return described
    .map((c) => (c.name.trim() ? `${c.name.trim()} — ${c.description.trim()}` : c.description.trim()))
    .join('; ')
}

const SHOT_MOTION: Record<ShotType, string> = {
  wide: 'slow cinematic push-in, subtle environmental movement in the background, gentle camera drift',
  medium: 'gentle handheld movement, subject breathing, natural micro-motion',
  'close-up': 'subtle facial micro-expression, natural blinking and breathing, minimal camera movement, shallow focus holds steady',
  pov: 'handheld drift matching natural head movement, subtle parallax between foreground and background',
  'over-the-shoulder': 'gentle handheld movement, foreground figure stays anchored, subject in the background breathes and shifts naturally',
}

// Motion mapping ported from personalprojects/scenelab-api-test/test-kling.js for 'medium'
// (the only confirmed value); the other four shot types were drafted to match its tone and
// approved during design review. clipSeconds interpolates into the fixed suffix — the 5s
// output is byte-identical to the originally validated prompt; 10s was smoke-tested
// 2026-07-18 (test-kling-10s.js).
// `motion` should be the moment's forward-motion field when available (falling back to
// description for legacy moments). The first-frame preamble mirrors the validated bridge
// prompt's framing and pins the supplied still as the point the action moves FORWARD from
// — the other half of the reversed-action fix.
export function buildVideoPrompt(shotType: ShotType, motion: string, clipSeconds: 5 | 10 = 5): string {
  return [
    'Begin exactly from the supplied first frame. The action moves forward from this pose, never backward:',
    motion,
    `${SHOT_MOTION[shotType]}. Cinematic, smooth, ${clipSeconds} seconds.`,
  ].join(' ')
}

const BRIDGE_FALLBACK =
  'Natural minimal movement connects the first frame to the second frame. Subtle subject motion and restrained camera movement. Maintain visual and spatial continuity.'

// Generated-bridge prompt (Kling O3 dual-keyframe). Motion leads; the two static moment
// descriptions ride along as labeled context only — the supplied frames already carry
// appearance, composition, and style. The optional user-written bridgeDirection replaces
// the conservative fallback; no Claude call is involved in building this prompt.
export function buildTransitionPrompt(
  fromDescription: string,
  toDescription: string,
  bridgeDirection?: string | null
): string {
  return [
    'Begin exactly from the first supplied frame.',
    bridgeDirection?.trim() || BRIDGE_FALLBACK,
    'Motion progresses naturally and continuously toward the second supplied frame.',
    `Context — first frame: ${fromDescription}`,
    `Second frame: ${toDescription}`,
    'Preserve character identity, facial features, clothing, object identity, lighting, environment, and spatial continuity. Use restrained cinematic camera movement. End exactly on the second supplied frame. No morphing, melting, object substitution, teleportation, sudden identity changes, extra limbs, extra subjects, text, or unmotivated scene transformation. 5 seconds.',
  ].join(' ')
}
