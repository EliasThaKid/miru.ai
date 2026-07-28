import type {
  BodyOrientation,
  DepthPlane,
  MomentBlocking,
  ScreenRegion,
  ShotType,
  StylePreset,
  SubjectBlocking,
  VisibilityMode,
  VisualFocus,
} from '@/types'

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

// Object-focus framing: insert/detail terminology, never the person-implying word "subject".
// Deliberately off-center rather than "centered" — centering pushed the model toward
// symmetrical, catalog-style presentation of the object.
const OBJECT_SHOT_LABELS: Record<ShotType, string> = {
  wide: 'wide insert shot, the object shown within its surroundings',
  medium: 'insert shot, the object framed prominently and off-center',
  'close-up': 'tight insert detail shot on the object, framed off-center, no person in frame',
  pov: 'point-of-view insert, the object seen as a person would look at it, no person visible',
  'over-the-shoulder': 'insert detail shot past a foreground element, focus on the object',
}

// Environment-focus framing: an empty location, explicitly no people.
const ENVIRONMENT_SHOT_LABELS: Record<ShotType, string> = {
  wide: 'wide establishing shot of the empty location, no people present',
  medium: 'shot of the location itself, no people present',
  'close-up': 'close detail of the environment, no people present',
  pov: 'point-of-view shot across the empty space, no people present',
  'over-the-shoulder': 'establishing shot of the location, no people present',
}

// Whether a focus puts one or more people in the frame.
export function focusShowsCharacters(focus: VisualFocus): boolean {
  return focus === 'character' || focus === 'multiple_characters' || focus === 'mixed'
}

// The effective focus for a moment: an explicit classification wins; otherwise it is derived
// from how many cast members are assigned to the frame. A moment with no cast and no explicit
// focus is treated as an empty environment — never a person.
export function visualFocusForMoment(explicit: VisualFocus | null | undefined, castCount: number): VisualFocus {
  if (explicit) return explicit
  if (castCount > 1) return 'multiple_characters'
  if (castCount === 1) return 'character'
  return 'environment'
}

// ---- Blocking phrase maps: enum → natural-language composition cue ----
const VISIBILITY_PHRASES: Record<VisibilityMode, string> = {
  full: 'fully visible',
  partial: 'only partially in frame',
  back_only: 'seen from behind, only their back visible',
  shoulder_only: 'seen from behind, only one shoulder and the back of their head in frame',
  hands_only: 'only their hands visible',
  silhouette: 'shown only as a silhouette',
  offscreen: 'just outside the frame, present but not visible',
}
const DEPTH_PHRASES: Record<DepthPlane, string> = {
  extreme_foreground: 'in the extreme foreground',
  foreground: 'in the foreground',
  midground: 'in the midground',
  background: 'in the background',
}
const SCREEN_PHRASES: Record<ScreenRegion, string> = {
  far_left: 'at the far left of the frame',
  left: 'on the left of the frame',
  center: 'at the centre of the frame',
  right: 'on the right of the frame',
  far_right: 'at the far right of the frame',
}
const ORIENTATION_PHRASES: Record<BodyOrientation, string> = {
  toward_camera: 'facing the camera',
  three_quarter_left: 'turned three-quarters to the left',
  three_quarter_right: 'turned three-quarters to the right',
  profile_left: 'in left profile',
  profile_right: 'in right profile',
  back_to_camera: 'with their back to the camera',
  toward_object: 'turned toward the object of focus',
  away_from_other_character: 'turned away from the other character',
}
function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

// ---- Continuity-lock helpers ----
// Footwear terms — invisible (and so must not be *required*) in any framing tighter than a
// full wide shot. Behavioral/personality prose — stripped from the visual reference block.
// Anything below the waist / floor-contact that a waist-up-or-tighter frame cannot show, so
// it must never be *required*: footwear, feet, floor, threshold, standing surface.
const BELOW_FRAME =
  /\b(shoes?|sneakers?|boots?|heels?|sandals?|footwear|loafers?|slippers?|bare feet|feet|foot placement|threshold|doorway sill|visible floor|floor beneath|tile floor|ground beneath|standing on|stepping (?:in|over|onto))\b/i
const BEHAVIORAL =
  /\b(moves?|moving|speaks?|spoke|speaking|defensive(?:ly)?|quiet(?:ly)?|gentle(?:ly)?|methodical(?:ly)?|observant|calm(?:ly)?|nervous(?:ly)?|anxious(?:ly)?|confident(?:ly)?|shy|timid|manner|personality|tends? to|behaves?|acts?|when (?:she|he|they)\b)/i

// Feet/floor are only in frame on a full wide shot; everything tighter is waist-up or closer.
function feetVisible(shotType: ShotType): boolean {
  return shotType === 'wide'
}

// Drop comma-clauses that require something below the frame (footwear, feet, floor,
// threshold) when the shot can't show it. Applied to every free-text field, not just wardrobe.
function sanitizeForVisibility(text: string, shotType: ShotType): string {
  if (feetVisible(shotType) || !text) return text
  const kept = text
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c && !BELOW_FRAME.test(c))
    .join(', ')
  return kept
}

// Parse the inspector's comma-separated Avoid draft into a normalized token list. This is the
// ONLY place Avoid text is normalized — done on blur/save, never on every keystroke, so the
// raw draft (including trailing spaces and multi-word phrases) is preserved while typing.
export function parseAvoid(raw: string): string[] {
  // Cap at three short concepts (author intent / UI metadata — not serialized into the
  // positive prompt, since flux-pro/v1.1 has no negative-prompt parameter).
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
}

// A fabric/garment object — the class that renders as "worn" or "displayed flat".
const FABRIC =
  /\b(dress|shirt|garment|fabric|cloth(?:es|ing)?|uniform|sock|jacket|coat|gown|skirt|trousers|pants|sleeve|textile|linen|towel|sweater|scarf|blouse|robe|apron|denim|wool|cotton|laundry)\b/i

// No hand/hold language when no person is in the frame (object/environment focus): an item
// can't be "held" if nobody is there to hold it.
function stripHoldLanguage(text: string): string {
  return text
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c && !/\b(held|holding|hand|hands|grip|grasp|grasped|clutch(?:ed|ing)?|carried|carrying)\b/i.test(c))
    .join(', ')
}

// A front-loader is either open OR closed-behind-glass, never both. When items are shown
// inside, keep the closed "behind the glass" reading and drop any open-door clause.
function resolveDoorGlass(text: string): string {
  const behindGlass = /behind (?:the )?(?:circular )?glass|through (?:the )?glass/i.test(text)
  const openDoor = /\bopen (?:door|lid|hatch)\b|\bdoor (?:is )?open\b|\bhatch (?:is )?open\b/i.test(text)
  if (!(behindGlass && openDoor)) return text
  return text
    .split(/,|;/)
    .map((c) => c.trim())
    .filter((c) => c && !/\bopen (?:door|lid|hatch)\b|\bdoor (?:is )?open\b|\bhatch (?:is )?open\b/i.test(c))
    .join(', ')
}

// The trailing full reference, made appearance-only: per character, drop behavioral clauses
// and (when feet aren't visible) footwear clauses, keeping the visual descriptors.
function sanitizeAppearance(appearance: string, shotType: ShotType): string {
  return appearance
    .split(';')
    .map((seg) => {
      const dash = seg.indexOf('—')
      const head = dash >= 0 ? seg.slice(0, dash).trim() : ''
      const body = dash >= 0 ? seg.slice(dash + 1) : seg
      const kept = body
        .split(/,|\.\s/)
        .map((c) => c.trim())
        .filter((c) => c && !BEHAVIORAL.test(c) && (feetVisible(shotType) || !BELOW_FRAME.test(c)))
        .join(', ')
      return head ? `${head} — ${kept}` : kept
    })
    .filter((s) => s.replace(/—/g, '').trim())
    .join('; ')
}

// The compact visible identity anchors for one subject, filtered by what the shot and the
// subject's visibility can physically show (skin tone / hairstyle / dominant wardrobe).
function visibleAnchors(s: SubjectBlocking, shotType: ShotType): string[] {
  const v = s.visibility
  if (v === 'silhouette' || v === 'offscreen' || v === 'hands_only') return [] // nothing identifiable
  const anchors: string[] = []
  const skin = s.skin?.trim()
  const hair = s.hair?.trim()
  const wardrobe = s.wardrobe?.trim()
  // Skin tone reads even from behind (neck, arms); hair reads from any angle but a silhouette.
  if (skin) anchors.push(skin)
  if (hair) anchors.push(hair)
  // Wardrobe: torso is visible unless purely back-of-head; strip anything below the frame.
  if (wardrobe) {
    const w = sanitizeForVisibility(wardrobe, shotType)
    if (w) anchors.push(w)
  }
  return anchors
}

// SETTING LOCK — pins the venue, its own practical light, and up to three visible fixtures,
// emitted right after the camera/style header so the location is fixed before any action.
function settingLockLine(b: MomentBlocking, shotType: ShotType): string | null {
  const cat = b.settingCategory?.trim()
  const light = b.practicalLighting?.trim()
  // Setting anchors are also visibility-filtered: a waist-up shot must not require a visible
  // floor/threshold even when the location has one.
  const anchors = (b.environmentAnchors ?? [])
    .map((a) => sanitizeForVisibility(a.trim(), shotType))
    .filter(Boolean)
    .slice(0, 3)
  if (!cat && !light && anchors.length === 0) return null
  const parts: string[] = []
  if (cat) parts.push(cat)
  if (anchors.length) parts.push(`clearly showing ${anchors.join(', ')}`)
  if (light) parts.push(`lit by ${light}`)
  return `SETTING LOCK — ${parts.join(', ')}`
}

// One subject's blocking → a placement/visibility sentence. The visible identity anchors are
// inlined right after the name (before any pose/orientation detail) so the continuity lock
// leads. Respects visibility so an over-the-shoulder foreground figure reads as partial.
function subjectBlockingLine(s: SubjectBlocking, shotType: ShotType): string {
  const name = s.name?.trim() || 'the figure'
  const anchors = visibleAnchors(s, shotType)
  const who = anchors.length ? `${name} (${anchors.join(', ')})` : name
  const parts = [
    `${DEPTH_PHRASES[s.depth]} ${SCREEN_PHRASES[s.screenRegion]}`,
    `${who} is ${VISIBILITY_PHRASES[s.visibility]}`,
    s.bodyOrientation ? ORIENTATION_PHRASES[s.bodyOrientation] : null,
    s.gazeTarget?.trim() ? `looking toward ${s.gazeTarget.trim()}` : null,
    s.pose?.trim() || null,
    s.occludedBy?.trim() ? `partially occluded by ${s.occludedBy.trim()}` : null,
  ].filter((p): p is string => !!p)
  return cap(parts.join(', '))
}

// Deterministic contradiction cleanup (req 6). Runs before composing so the prompt never
// contains impossible pairings: "fully visible" in a waist-up frame, a foreground-centre
// subject when centring is being avoided, or an "accepting" focal action when a subject's
// pose says the exchange hasn't happened yet.
function sanitizeBlocking(b: MomentBlocking, shotType: ShotType): MomentBlocking {
  const tight = shotType === 'medium' || shotType === 'close-up' // waist-up or closer
  const avoidCentered = (b.avoid ?? []).some((a) => /cent(?:er|re|red|ered)|symmetr/i.test(a))

  const subjects = (b.subjects ?? []).map((s) => {
    let visibility = s.visibility
    let screenRegion = s.screenRegion
    if (visibility === 'full' && tight) visibility = 'partial' // full can't fit a waist-up frame
    if (avoidCentered && (s.depth === 'foreground' || s.depth === 'extreme_foreground') && screenRegion === 'center') {
      screenRegion = 'left' // foreground-centre contradicts an avoid-centred cue
    }
    return { ...s, visibility, screenRegion }
  })

  let focalAction = b.focalAction
  if (focalAction && /\b(accepts?|accepting|takes?|taking|receives?|receiving)\b/i.test(focalAction)) {
    const notYet =
      b.actionPhase === 'pre_action' ||
      b.actionPhase === 'action_ready' ||
      (b.subjects ?? []).some((s) => /\blap\b|not yet|has not|about to|reaching|extend/i.test(s.pose ?? '')) ||
      (b.subjects ?? []).some((s) => /extend|reaching|holding out|offer/i.test(s.pose ?? ''))
    if (notYet) {
      focalAction = focalAction.replace(
        /\b(accepts?|accepting|takes?|taking|receives?|receiving)\b/gi,
        'is not yet accepting (the exchange has not happened)'
      )
    }
  }
  return { ...b, subjects, focalAction }
}

// An explicit "who must be in the frame" directive, derived from the moment's assigned cast
// NAMES. Now shot-grammar-aware: an over-the-shoulder frame must NOT demand every character
// be "clearly visible" (that forced a flat symmetrical two-shot) — the nearest figure is
// explicitly partial. Used when a moment has no structured subject blocking.
function presenceDirective(characterNames: string[], shotType: ShotType): string | null {
  const names = characterNames.map((n) => n.trim()).filter(Boolean)
  if (names.length === 0) return null
  // Positive framing only — no "do not omit" / "do not stage" negations (they summon the
  // very thing they forbid and bloat the prompt).
  if (shotType === 'over-the-shoulder') {
    if (names.length === 1) {
      return `${names[0]} the subject, framed over a foreground figure's near shoulder`
    }
    return `framed over ${names[0]}'s shoulder (their back and shoulder in the near foreground) toward ${names.slice(1).join(' and ')}`
  }
  if (names.length === 1) return `${names[0]} the clear subject of the frame`
  return `${names.join(' and ')} both in frame`
}

// flux-pro/v1.1 has NO negative-prompt parameter: the whole string is positive conditioning,
// so every "no/never/not X" and every "Avoid: X" actively describes X to the model. Long,
// contradictory, repetitive prompts collapse the model (black/degenerate frames). This is the
// architectural guard: assemble prioritized POSITIVE segments, drop exact/contained duplicates
// (so identity/setting/action are stated once), and enforce a hard word budget — essentials
// always kept, optionals dropped once the budget is hit.
const MAX_PROMPT_WORDS = 70

function serializePrompt(segments: { text: string | null | undefined; keep?: boolean }[]): string {
  const chosen: string[] = []
  const seen: string[] = []
  let words = 0
  for (const seg of segments) {
    const text = seg.text?.trim()
    if (!text) continue
    const key = text.toLowerCase().replace(/[.,;:]/g, '').trim()
    // Skip exact repeats and near-duplicates where one long segment contains another
    // (dedupes the same identity/setting/action stated twice). BOTH keys must be long —
    // otherwise a short segment ("x") would swallow every longer one that contains it.
    if (seen.some((s) => s === key || (key.length > 12 && s.length > 12 && (s.includes(key) || key.includes(s))))) continue
    const w = text.split(/\s+/).filter(Boolean).length
    if (!seg.keep && words + w > MAX_PROMPT_WORDS) continue
    chosen.push(text)
    seen.push(key)
    words += w
  }
  return chosen.join('. ')
}

// One positive object clause for an object-focus insert. Replaces the old pile of negations
// ("no person, nothing worn/held, not arranged, not displayed, no wearer, no intact worn
// shape…") with a single concrete description plus one necessary "no person" constraint.
function positiveObjectClause(clean: MomentBlocking | null | undefined, cleanText: (t: string) => string): string {
  const phys = (clean?.objectPhysics ?? []).filter((o) => o.item?.trim())
  if (phys.length === 0) return 'an object-detail insert, no person in frame'
  const o = phys[0]
  const collapse =
    o.deformation?.trim() ||
    o.gravityState?.trim() ||
    (FABRIC.test(o.item) ? 'a loose crumpled tangle of fabric' : null)
  const bits = [o.item.trim(), o.containment?.trim() || null, collapse].filter((b): b is string => !!b)
  return `${cleanText(cap(bits.join(', ')))}, no person in frame`
}

//
// `composition` should be the moment's startFrame (frozen opening instant) — passing the
// full action-arc description makes the model render the completed action (the reversed-
// motion bug). `characterDescription` is the composed cast appearance (may be empty →
// omitted). `characterNames` are the assigned cast names for the presence directive
// (optional; omitted → no presence line, e.g. legacy callers). `settingDescription` is the
// assigned Setting's description (location continuity); omitted when absent.
export function buildImagePrompt(
  stylePreset: StylePreset,
  characterDescription: string,
  shotType: ShotType,
  composition: string,
  settingDescription?: string | null,
  characterNames: string[] = [],
  visualFocus?: VisualFocus | null,
  blocking?: MomentBlocking | null,
  // A REAL supplied reference image (only when the endpoint conditions on one). When null,
  // no reference-language is written — the prompt never claims a reference that isn't sent.
  referenceImage?: { url: string; conditions: 'identity' | 'composition' } | null
): string {
  const names = characterNames.map((n) => n.trim()).filter(Boolean)
  const focus = visualFocusForMoment(visualFocus, names.length)
  const showsCharacters = focusShowsCharacters(focus)
  // Contradiction cleanup runs first so downstream lines can't emit impossible pairings.
  const clean = blocking ? sanitizeBlocking(blocking, shotType) : null

  // Location's own light overrides a generic "natural lighting" baked into the style prefix.
  let style = STYLE_PREFIXES[stylePreset]
  if (clean?.practicalLighting?.trim()) style = style.replace(/,?\s*natural lighting/gi, '')

  const framing =
    focus === 'object' ? OBJECT_SHOT_LABELS[shotType]
    : focus === 'environment' ? ENVIRONMENT_SHOT_LABELS[shotType]
    : SHOT_LABELS[shotType]

  const settingLock = clean ? settingLockLine(clean, shotType) : null

  // Free-text fields get the same shot-visibility sanitation as the identity anchors — a
  // waist-up frame must not require footwear, feet, floor or a threshold anywhere. For a
  // no-person frame, also drop "held/hand" language and resolve open-door vs behind-glass.
  const noPerson = !showsCharacters
  const cleanText = (text: string): string => {
    let t = sanitizeForVisibility(text, shotType)
    if (noPerson) t = resolveDoorGlass(stripHoldLanguage(t))
    return t
  }
  const composed = cleanText(composition)

  // Structured subject blocking (when present) replaces the flat presence directive: it
  // states each character's placement AND how much of them is visible, so it satisfies the
  // "don't omit a selected character" requirement while respecting shot grammar. Fall back
  // to the shot-grammar-aware presence directive when no subject blocking exists.
  const subjectBlocking = (clean?.subjects ?? []).filter((s) => s && s.visibility)
  const blockingLines = showsCharacters ? subjectBlocking.map((s) => subjectBlockingLine(s, shotType)) : []
  const presence =
    showsCharacters && blockingLines.length === 0 ? presenceDirective(names, shotType) : null

  // Object focus → one positive object clause (replaces the negation pile). Environment →
  // one short positive clause. Character focus → structured subject lines or positive presence.
  const objectClause =
    focus === 'object' ? positiveObjectClause(clean, cleanText) : focus === 'environment' ? 'an empty location, no people present' : null

  // Identity is stated ONCE. When subject blocking carries inline anchors, rely on those and
  // drop the long trailing reference (the repetition itself degrades the prompt). Only when
  // there is no inline blocking do we add a single concise identity line.
  const hasInlineAnchors = blockingLines.length > 0
  const identityLine =
    showsCharacters && !hasInlineAnchors && appearanceAllowed(characterDescription)
      ? sanitizeAppearance(characterDescription.trim(), shotType)
      : null

  // Setting is stated ONCE: prefer the structured SETTING LOCK, else the setting description.
  const settingText = settingLock ?? (settingDescription?.trim() ? `in ${settingDescription.trim()}` : null)

  // Subject + action FIRST; a single frozen instant (startFrame — no separate focalAction/
  // actionPhase); setting once; style and format last. No Avoid line (there is no negative
  // prompt param), no continuity negations, no duplicated identity/setting.
  return serializePrompt([
    { text: composed, keep: true }, // the single frozen instant, subject + action, leads
    ...blockingLines.map((t) => ({ text: t, keep: true })),
    { text: objectClause, keep: true },
    { text: presence, keep: true },
    { text: framing }, // shot label (optional under budget)
    { text: settingText, keep: true },
    { text: identityLine }, // concise identity only when no inline anchors
    { text: style },
    referenceImage ? { text: `using the supplied reference image for ${referenceImage.conditions}`, keep: true } : { text: null },
    { text: 'vertical 9:16 portrait', keep: true },
  ])
}

// True when the appearance block has any content left after sanitizing (avoids emitting an
// empty "reference —" fragment).
function appearanceAllowed(appearance: string): boolean {
  return !!appearance.trim()
}

// The single source of truth for WHICH prompt is sent to the image model: an intentional
// user override when one exists, otherwise a prompt freshly composed from the current
// canonical state (cast/setting/startFrame). The stored provenance prompt
// (moment.imagePrompt — the exact text last SENT) is deliberately NOT consulted here, so a
// regeneration after a cast or location change always recomposes rather than reusing a
// stale prompt. Both the render action and any preview must go through this one decision.
export function resolveImagePrompt(args: {
  override?: string | null
  stylePreset: StylePreset
  characterDescription: string
  shotType: ShotType
  composition: string
  settingDescription?: string | null
  characterNames?: string[]
  visualFocus?: VisualFocus | null
  blocking?: MomentBlocking | null
  referenceImage?: { url: string; conditions: 'identity' | 'composition' } | null
}): string {
  const override = args.override?.trim()
  if (override) return override
  return buildImagePrompt(
    args.stylePreset,
    args.characterDescription,
    args.shotType,
    args.composition,
    args.settingDescription,
    args.characterNames ?? [],
    args.visualFocus,
    args.blocking,
    args.referenceImage
  )
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
