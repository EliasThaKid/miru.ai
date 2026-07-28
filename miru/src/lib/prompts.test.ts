import { describe, expect, it } from 'vitest'
import {
  buildImagePrompt,
  castForMoment,
  composeCharacterDescription,
  focusShowsCharacters,
  parseAvoid,
  resolveImagePrompt,
  settingForMoment,
  visualFocusForMoment,
} from '@/lib/prompts'
import type { MomentBlocking, ShotType, StylePreset, VisualFocus } from '@/types'

// The Last Wash fixture, trimmed to the fields the composer touches.
const NADIA = { name: 'Nadia Brooks', description: 'Black woman, 32, long box braids, navy nursing scrubs under a faded denim jacket' }
const PARK = { name: 'Mr. Park', description: 'Korean man, early 60s, gray hair, rectangular glasses, forest-green laundromat apron' }
const LAUNDROMAT = { name: 'Neighborhood laundromat', description: 'Narrow aging Brooklyn laundromat, silver front-loading washers, flickering fluorescent lights' }
const STREET = { name: 'Rainy street outside', description: 'Dark commercial block, glowing streetlights blurred by heavy rain' }

const characters = [NADIA, PARK]
const settings = [LAUNDROMAT, STREET]

// Compose exactly the way the render path does, for a given canonical moment state.
function composeFor(moment: {
  characterNames?: string[] | null
  locationName?: string | null
  startFrame?: string | null
  description?: string
  userPromptOverride?: string | null
  visualFocus?: VisualFocus | null
  shotType?: ShotType
  blocking?: MomentBlocking | null
  stylePreset?: StylePreset
  referenceImage?: { url: string; conditions: 'identity' | 'composition' } | null
}) {
  const cast = castForMoment(characters, moment.characterNames)
  return resolveImagePrompt({
    override: moment.userPromptOverride,
    stylePreset: moment.stylePreset ?? 'cinematic',
    characterDescription: composeCharacterDescription(cast),
    shotType: moment.shotType ?? 'close-up',
    composition: moment.startFrame ?? moment.description ?? '',
    settingDescription: settingForMoment(settings, moment.locationName)?.description ?? null,
    characterNames: cast.map((c) => c.name),
    visualFocus: moment.visualFocus,
    blocking: moment.blocking,
    referenceImage: moment.referenceImage,
  })
}

// Substring of CHARACTER_CONTINUITY that is absent from object/environment continuity.
const CHARACTER_IDENTITY_CLAUSE = 'one consistent identity throughout'

describe('castForMoment', () => {
  it('null assignment falls back to the whole cast (legacy)', () => {
    expect(castForMoment(characters, null)).toEqual(characters)
    expect(castForMoment(characters, undefined)).toEqual(characters)
  })
  it('empty array means deliberately nobody', () => {
    expect(castForMoment(characters, [])).toEqual([])
  })
  it('selects only the named cast', () => {
    expect(castForMoment(characters, ['Nadia Brooks'])).toEqual([NADIA])
  })
})

describe('resolveImagePrompt — cast toggle propagation', () => {
  const base = { locationName: LAUNDROMAT.name, startFrame: 'Nadia stands at a washer' }

  it('enabling Nadia puts her description in the composed prompt', () => {
    const prompt = composeFor({ ...base, characterNames: ['Nadia Brooks'] })
    expect(prompt).toContain('box braids')
    expect(prompt).not.toContain('laundromat apron') // Mr. Park is off
  })

  it('disabling Nadia removes her from the composed prompt', () => {
    const prompt = composeFor({ ...base, characterNames: ['Mr. Park'] })
    expect(prompt).not.toContain('box braids')
    expect(prompt).toContain('laundromat apron')
  })

  it('toggling the cast changes the composed prompt (the core regression)', () => {
    const withNadia = composeFor({ ...base, characterNames: ['Nadia Brooks', 'Mr. Park'] })
    const withoutNadia = composeFor({ ...base, characterNames: ['Mr. Park'] })
    expect(withNadia).not.toEqual(withoutNadia)
  })
})

describe('resolveImagePrompt — setting override propagation', () => {
  it('changing the location changes the composed prompt', () => {
    const inside = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    const outside = composeFor({ characterNames: ['Nadia Brooks'], locationName: STREET.name, startFrame: 'x' })
    expect(inside).toContain('front-loading washers')
    expect(outside).toContain('streetlights')
    expect(inside).not.toEqual(outside)
  })
})

describe('resolveImagePrompt — override behavior', () => {
  it('an intentional override is used verbatim, bypassing composition', () => {
    const prompt = composeFor({
      characterNames: ['Mr. Park'],
      locationName: STREET.name,
      userPromptOverride: 'MY EXACT PROMPT',
    })
    expect(prompt).toBe('MY EXACT PROMPT')
  })
  it('a blank/whitespace override falls through to composition', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, userPromptOverride: '   ' })
    expect(prompt).toContain('box braids')
  })
})

// This is the exact reported bug: a moment that was generated once (so imagePrompt holds an
// OLD prompt) then had Nadia toggled in. Because regeneration no longer consults
// imagePrompt, the freshly composed prompt must include Nadia and differ from the stale one.
describe('regression — stale provenance prompt must not shadow regeneration', () => {
  it('recomposes with the new cast instead of reusing the old generated prompt', () => {
    const staleGeneratedPrompt = composeFor({ characterNames: ['Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    // Nadia is now toggled on; userPromptOverride stays null (only imagePrompt held the old text).
    const recomposed = composeFor({ characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(recomposed).toContain('box braids')
    expect(recomposed).not.toEqual(staleGeneratedPrompt)
  })
})

describe('visualFocusForMoment derivation', () => {
  it('derives from cast size when no explicit focus', () => {
    expect(visualFocusForMoment(null, 0)).toBe('environment')
    expect(visualFocusForMoment(undefined, 1)).toBe('character')
    expect(visualFocusForMoment(null, 3)).toBe('multiple_characters')
  })
  it('an explicit focus always wins', () => {
    expect(visualFocusForMoment('object', 5)).toBe('object')
    expect(visualFocusForMoment('environment', 2)).toBe('environment')
  })
  it('object/environment are the no-character foci', () => {
    expect(focusShowsCharacters('object')).toBe(false)
    expect(focusShowsCharacters('environment')).toBe(false)
    expect(focusShowsCharacters('character')).toBe(true)
    expect(focusShowsCharacters('mixed')).toBe(true)
  })
})

// The reproduction: an object-only insert of the yellow dress inside the washer must NOT
// pull in a person or character-identity continuity, even if cast names are still attached.
describe('object-focus composition (object-only-shots-generate-people fix)', () => {
  const dress = 'Inside the washer drum, a bright yellow child-sized dress lies crumpled among navy uniforms behind the circular glass door'

  it('drops character identity continuity entirely', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: [], locationName: LAUNDROMAT.name, startFrame: dress })
    expect(prompt).not.toContain(CHARACTER_IDENTITY_CLAUSE)
    expect(prompt).toContain('the location, architecture, fixtures')
  })
  it('states the object is unworn with no person present', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: [], locationName: LAUNDROMAT.name, startFrame: dress })
    expect(prompt).toContain('No person is present in the frame')
    expect(prompt).toContain('empty and unworn')
  })
  it('uses insert framing, never the person-implying word "subject"', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: [], locationName: LAUNDROMAT.name, startFrame: dress })
    expect(prompt).toContain('insert detail shot')
    expect(prompt).not.toContain('framing on subject')
  })
  it('an explicit object focus suppresses characters even if cast names are still attached', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: dress })
    expect(prompt).not.toContain('braids')
    expect(prompt).not.toContain('clearly visible')
    expect(prompt).not.toContain(CHARACTER_IDENTITY_CLAUSE)
  })
})

describe('environment-focus composition', () => {
  it('marks an empty location with no people and no identity continuity', () => {
    const prompt = composeFor({ visualFocus: 'environment', characterNames: [], locationName: LAUNDROMAT.name, startFrame: 'the empty laundromat at closing' })
    expect(prompt).toContain('no people are present')
    expect(prompt).not.toContain(CHARACTER_IDENTITY_CLAUSE)
  })
})

describe('character focus still carries identity continuity', () => {
  it('a character shot keeps the identity clause and presence', () => {
    const prompt = composeFor({ visualFocus: 'character', characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'Nadia at the washer' })
    expect(prompt).toContain(CHARACTER_IDENTITY_CLAUSE)
    expect(prompt).toContain('Nadia Brooks is clearly visible as the primary subject')
  })
})

describe('shot-grammar-aware presence (OTS-two-shot fix, no blocking)', () => {
  it('over-the-shoulder does NOT demand every character be clearly visible', () => {
    const prompt = composeFor({ shotType: 'over-the-shoulder', characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).not.toContain('do not omit any of them')
    expect(prompt).toContain('only their shoulder and the back of their head are visible')
    expect(prompt).toContain('do not stage this as a flat, symmetrical, face-to-face two-shot')
  })
  it('a normal medium shot still keeps the do-not-omit list', () => {
    const prompt = composeFor({ shotType: 'medium', characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).toContain('do not omit any of them')
  })
})

describe('continuity no longer references the previous image (composition-leak fix)', () => {
  it('character continuity is appearance-only, not "from the previous image"', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).not.toContain('from the previous image')
    expect(prompt).toContain('never their pose, placement, camera angle, or composition')
  })
})

describe('object framing softened (garment-as-display fix)', () => {
  it('object close-up is off-center, never camera-centered', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: [], locationName: LAUNDROMAT.name, startFrame: 'the dress in the drum' })
    expect(prompt).not.toContain('camera centered')
    expect(prompt).toContain('off-center')
    expect(prompt).toContain('never arranged, folded flat, pressed against the glass, or displayed like a product')
  })
})

describe('structured blocking composition', () => {
  const otsBlocking: MomentBlocking = {
    actionPhase: 'mid_action',
    focalAction: 'Luis extends a detergent packet toward Nadia',
    subjects: [
      { name: 'Nadia Brooks', visibility: 'shoulder_only', depth: 'extreme_foreground', screenRegion: 'left', bodyOrientation: 'back_to_camera' },
      { name: 'Mr. Park', visibility: 'full', depth: 'midground', screenRegion: 'right', bodyOrientation: 'three_quarter_left', pose: 'holding out a small packet' },
    ],
    avoid: ['symmetrical two-shot', 'posed portrait'],
  }

  it('foreground OTS subject is described partial, never "clearly visible"', () => {
    const prompt = composeFor({ shotType: 'over-the-shoulder', characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x', blocking: otsBlocking })
    expect(prompt).toContain('only one shoulder and the back of their head in frame')
    expect(prompt).not.toContain('clearly visible')
    expect(prompt).not.toContain('do not omit any of them') // structured blocking replaces the flat directive
  })
  it('leads with the focal action, ahead of the identity block', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x', blocking: otsBlocking })
    expect(prompt).toContain('Focal action: Luis extends a detergent packet toward Nadia')
    expect(prompt.indexOf('Focal action:')).toBeLessThan(prompt.indexOf('Character identity reference'))
  })
  it('emits distinct depths/regions so the two characters are not stacked', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x', blocking: otsBlocking })
    expect(prompt).toContain('In the extreme foreground on the left of the frame')
    expect(prompt).toContain('In the midground on the right of the frame')
  })
  it('surfaces the avoid list as negative cues', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x', blocking: otsBlocking })
    expect(prompt).toContain('Avoid: symmetrical two-shot, posed portrait')
  })
  it('object physics enforce gravity + asymmetry for an object shot', () => {
    const prompt = composeFor({
      visualFocus: 'object', characterNames: [], locationName: LAUNDROMAT.name, startFrame: 'the dress',
      blocking: { objectPhysics: [{ item: 'a yellow child-sized dress', gravityState: 'sinking under its own weight', deformation: 'crumpling as it folds', containment: 'inside the drum behind the glass', symmetry: 'avoid' }] },
    })
    expect(prompt).toContain('sinking under its own weight')
    expect(prompt).toContain('inside the drum behind the glass')
    expect(prompt).toContain('asymmetric and irregular, not arranged or displayed')
  })
})

// ---- Continuity-lock patch ----
describe('inline visible identity anchors (continuity lock)', () => {
  const nadiaSubject = {
    name: 'Nadia Brooks', visibility: 'full' as const, depth: 'foreground' as const, screenRegion: 'left' as const,
    pose: 'watching the machine turn', skin: 'medium-dark skin', hair: 'long box braids', wardrobe: 'navy nursing scrubs',
  }
  it('inlines skin/hair/wardrobe right after the name', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x', blocking: { subjects: [nadiaSubject] } })
    expect(prompt).toContain('Nadia Brooks (medium-dark skin, long box braids, navy nursing scrubs)')
  })
  it('visible identity occurs inline BEFORE the pose/blocking detail', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x', blocking: { subjects: [nadiaSubject] } })
    expect(prompt.indexOf('medium-dark skin')).toBeLessThan(prompt.indexOf('watching the machine turn'))
  })
  it('drops the INLINE anchors the visibility cannot show (silhouette); trailing reference is unaffected', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x', blocking: { subjects: [{ ...nadiaSubject, visibility: 'silhouette' }] } })
    expect(prompt).toContain('Nadia Brooks is shown only as a silhouette')
    expect(prompt).not.toContain('(medium-dark skin') // no inline anchor parenthetical
  })
})

describe('SETTING LOCK', () => {
  const blocking = {
    focalAction: 'Nadia loads the machine',
    settingCategory: 'public commercial coin laundromat',
    practicalLighting: 'fluorescent tubes, half switched off at closing time',
    environmentAnchors: ['row of silver front-loading washers', 'orange plastic chairs', 'scratched folding table'],
    subjects: [{ name: 'Nadia Brooks', visibility: 'partial' as const, depth: 'foreground' as const, screenRegion: 'left' as const }],
  }
  it('commercial laundromat category + anchors appear BEFORE the action', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking })
    expect(prompt).toContain('SETTING LOCK — public commercial coin laundromat')
    expect(prompt).toContain('row of silver front-loading washers')
    expect(prompt.indexOf('row of silver front-loading washers')).toBeLessThan(prompt.indexOf('Focal action'))
  })
})

describe('practical lighting overrides "natural lighting"', () => {
  it('a fluorescent location does NOT keep the style prefix "natural lighting"', () => {
    const prompt = composeFor({ stylePreset: 'hyper-realistic', shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking: { practicalLighting: 'fluorescent tubes, half off at closing time' } })
    expect(prompt).not.toContain('natural lighting')
    expect(prompt).toContain('fluorescent')
  })
  it('without practical lighting, the style prefix keeps its natural lighting', () => {
    const prompt = composeFor({ stylePreset: 'hyper-realistic', shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'x' })
    expect(prompt).toContain('natural lighting')
  })
})

describe('contradiction cleanup', () => {
  it('no accepting/not-reaching contradiction', () => {
    const prompt = composeFor({
      shotType: 'medium', characterNames: ['Nadia Brooks'], startFrame: 'x',
      blocking: { actionPhase: 'action_ready', focalAction: 'Nadia accepts the detergent packet', subjects: [{ name: 'Nadia Brooks', visibility: 'partial', depth: 'foreground', screenRegion: 'left', pose: 'her hand still in her lap' }] },
    })
    expect(prompt).not.toContain('accepts the detergent')
    expect(prompt).toContain('not yet accepting')
  })
  it('"fully visible" cannot accompany a waist-up (medium) frame', () => {
    const prompt = composeFor({ shotType: 'medium', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking: { subjects: [{ name: 'Nadia Brooks', visibility: 'full', depth: 'foreground', screenRegion: 'left' }] } })
    expect(prompt).not.toContain('fully visible')
  })
  it('foreground-centre subject cannot coexist with an avoid-centred cue', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking: { avoid: ['centered composition'], subjects: [{ name: 'Nadia Brooks', visibility: 'full', depth: 'foreground', screenRegion: 'center' }] } })
    expect(prompt).toContain('In the foreground on the left of the frame')
    expect(prompt).not.toContain('In the foreground at the centre of the frame')
  })
})

describe('no invisible wardrobe / footwear requirements', () => {
  const desc = 'Nadia — medium-dark skin, box braids, navy scrubs, wet white sneakers. Moves quickly and speaks defensively when embarrassed'
  const subj = { subjects: [{ name: 'Nadia', visibility: 'full' as const, depth: 'foreground' as const, screenRegion: 'left' as const, wardrobe: 'navy scrubs, wet white sneakers' }] }
  it('waist-up (medium) strips footwear from BOTH the inline anchor and the trailing reference', () => {
    const prompt = buildImagePrompt('cinematic', desc, 'medium', 'x', null, ['Nadia'], 'character', subj)
    expect(prompt).not.toContain('sneakers')
    expect(prompt).not.toMatch(/\bshoes\b/)
  })
  it('a full wide shot keeps footwear (feet are in frame)', () => {
    const prompt = buildImagePrompt('cinematic', desc, 'wide', 'x', null, ['Nadia'], 'character', subj)
    expect(prompt).toContain('sneakers')
  })
  it('strips behavioral/personality prose from the trailing reference', () => {
    const prompt = buildImagePrompt('cinematic', desc, 'medium', 'x', null, ['Nadia'], 'character', subj)
    expect(prompt).not.toContain('speaks defensively')
    expect(prompt).not.toContain('Moves quickly')
  })
})

describe('no fake reference claim without a supplied reference', () => {
  it('omits established-cast / previous-image / reference-image language by default', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).not.toContain('established cast')
    expect(prompt).not.toContain('previous image')
    expect(prompt).not.toContain('reference image')
  })
  it('emits reference-image language ONLY when a real reference is supplied', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x', referenceImage: { url: 'https://x/ref.png', conditions: 'identity' } })
    expect(prompt).toContain('A reference image is supplied; use it for identity continuity')
  })
})

// ---- Regression patch (three fixes) ----
describe('parseAvoid (normalize only on save)', () => {
  it('preserves a multi-word phrase as one token', () => {
    expect(parseAvoid('posed portrait, symmetrical two-shot')).toEqual(['posed portrait', 'symmetrical two-shot'])
  })
  it('trailing spaces and empty tokens do not create blanks', () => {
    expect(parseAvoid('posed portrait,  ,  ')).toEqual(['posed portrait'])
    expect(parseAvoid('a ,  b ')).toEqual(['a', 'b'])
  })
  it('a whitespace-only draft normalizes to an empty list', () => {
    expect(parseAvoid('   ')).toEqual([])
  })
})

describe('yellow-dress object insert — collapsed material', () => {
  const blocking = {
    objectPhysics: [{ item: "a yellow child's dress", gravityState: 'sunk beneath the other clothes', containment: 'inside the drum behind the circular glass door', symmetry: 'avoid' as const }],
  }
  it('requires substantial occlusion / collapsed material and prohibits an intact worn shape', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: [], shotType: 'close-up', locationName: LAUNDROMAT.name, startFrame: "the yellow child's dress deep inside the drum behind the glass", blocking })
    expect(prompt).toContain('collapsed into itself')
    expect(prompt).toContain('mostly buried')
    expect(prompt).toContain('heavily occluded')
    expect(prompt).toContain('no intact worn shape')
  })
})

describe('visibility sanitation applies to ALL free-text fields (waist-up)', () => {
  it('strips footwear/floor/threshold from startFrame, focalAction and setting anchors', () => {
    const prompt = composeFor({
      shotType: 'medium', characterNames: ['Nadia Brooks'],
      startFrame: 'Nadia at the washer, wet white sneakers on the tile floor',
      blocking: { focalAction: 'Nadia steps over the threshold onto the visible floor', settingCategory: 'coin laundromat', environmentAnchors: ['row of silver washers', 'soap residue on the tile floor'] },
    })
    expect(prompt).not.toMatch(/\bsneakers\b/)
    expect(prompt).not.toMatch(/\bthreshold\b/)
    expect(prompt).not.toContain('visible floor')
    expect(prompt).not.toContain('tile floor')
    expect(prompt).toContain('row of silver washers') // non-floor anchor survives
  })
  it('a full wide shot keeps floor/footwear (feet are in frame)', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'Nadia at the washer, wet white sneakers on the tile floor', blocking: {} })
    expect(prompt).toContain('sneakers')
  })
})

describe('no-person object frame: no positive held/hand claim, no door/glass contradiction', () => {
  it('drops positive "held in a hand" language when nobody is in frame', () => {
    const prompt = composeFor({
      visualFocus: 'object', characterNames: [], shotType: 'close-up',
      startFrame: 'a detergent scoop held in a hand, resting inside the open drawer',
      blocking: { objectPhysics: [{ item: 'detergent scoop', occlusion: 'held against the drawer wall' }] },
    })
    expect(prompt).not.toContain('held in a hand')
    expect(prompt).not.toContain('held against the drawer')
  })
  it('resolves open-door vs behind-glass to the closed reading', () => {
    const prompt = composeFor({
      visualFocus: 'object', characterNames: [], shotType: 'close-up',
      startFrame: 'the washer door is open, the dress visible behind the circular glass', blocking: {},
    })
    expect(prompt).not.toMatch(/door is open|open door/i)
    expect(prompt).toContain('behind the circular glass')
  })
})

describe('buildImagePrompt basics', () => {
  it('omits the appearance segment when the cast is empty', () => {
    const prompt = buildImagePrompt('cinematic', '', 'medium', 'a room', null, [])
    expect(prompt).not.toContain('Character appearance')
  })
  it('keeps the 9:16 output constraint', () => {
    expect(buildImagePrompt('cinematic', '', 'medium', 'a room', null, [])).toContain('9:16')
  })
})

describe('subject-presence directive (Nadia-omission fix)', () => {
  it('a single selected character is named as the primary subject', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).toContain('Nadia Brooks is clearly visible as the primary subject')
  })
  it('multiple selected characters get an explicit do-not-omit list', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).toContain('do not omit any of them')
    expect(prompt).toContain('Nadia Brooks')
    expect(prompt).toContain('Mr. Park')
  })
  it('no presence directive when nobody is selected', () => {
    const prompt = composeFor({ characterNames: [], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).not.toContain('clearly visible')
    expect(prompt).not.toContain('do not omit')
  })
})

describe('setting grounding (generic-interior fix)', () => {
  it('grounds the specific location and forbids a generic environment', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).toContain('front-loading washers')
    expect(prompt).toContain('Render this exact environment, not a generic one')
  })
})
