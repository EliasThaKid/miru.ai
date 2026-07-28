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

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

// ---- Structural state → prompt (still holds after the architecture change) ----
describe('castForMoment', () => {
  it('null/undefined = whole cast (legacy); [] = nobody; names select', () => {
    expect(castForMoment(characters, null)).toEqual(characters)
    expect(castForMoment(characters, undefined)).toEqual(characters)
    expect(castForMoment(characters, [])).toEqual([])
    expect(castForMoment(characters, ['Nadia Brooks'])).toEqual([NADIA])
  })
})

describe('cast + setting propagation', () => {
  const base = { locationName: LAUNDROMAT.name, startFrame: 'Nadia stands at a washer' }
  it('enabling/disabling Nadia adds/removes her identity from the prompt', () => {
    expect(composeFor({ ...base, characterNames: ['Nadia Brooks'] })).toContain('box braids')
    const parkOnly = composeFor({ ...base, characterNames: ['Mr. Park'] })
    expect(parkOnly).not.toContain('box braids')
    expect(parkOnly).toContain('laundromat apron')
  })
  it('changing the location changes the composed prompt', () => {
    const inside = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    const outside = composeFor({ characterNames: ['Nadia Brooks'], locationName: STREET.name, startFrame: 'x' })
    expect(inside).toContain('front-loading washers')
    expect(outside).toContain('streetlights')
    expect(inside).not.toEqual(outside)
  })
})

describe('override behavior', () => {
  it('an intentional override is used verbatim; blank falls through to composition', () => {
    expect(composeFor({ characterNames: ['Mr. Park'], userPromptOverride: 'MY EXACT PROMPT' })).toBe('MY EXACT PROMPT')
    expect(composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, userPromptOverride: '   ' })).toContain('box braids')
  })
})

describe('regression — stale provenance prompt must not shadow regeneration', () => {
  it('recomposes with the new cast, not the old generated prompt', () => {
    const stale = composeFor({ characterNames: ['Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    const recomposed = composeFor({ characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(recomposed).toContain('box braids')
    expect(recomposed).not.toEqual(stale)
  })
})

describe('visualFocusForMoment / focusShowsCharacters', () => {
  it('derives from cast size, explicit wins, object/environment are no-character', () => {
    expect(visualFocusForMoment(null, 0)).toBe('environment')
    expect(visualFocusForMoment(undefined, 1)).toBe('character')
    expect(visualFocusForMoment(null, 3)).toBe('multiple_characters')
    expect(visualFocusForMoment('object', 5)).toBe('object')
    expect(focusShowsCharacters('object')).toBe(false)
    expect(focusShowsCharacters('character')).toBe(true)
  })
})

// ---- Architecture guards (the black-frame revision) ----
describe('positive-only, no negative-prompt leakage', () => {
  const p = () =>
    composeFor({
      characterNames: ['Nadia Brooks'],
      locationName: LAUNDROMAT.name,
      startFrame: 'Nadia at the washer',
      blocking: { avoid: ['posed portrait', 'symmetrical two-shot', 'catalog lighting', 'dutch angle'] },
    })
  it('never serializes the Avoid list into the (positive-only) prompt', () => {
    expect(p()).not.toContain('Avoid:')
    expect(p()).not.toContain('symmetrical two-shot')
  })
  it('drops the continuity negations and any prior-reference claim', () => {
    const prompt = p()
    expect(prompt).not.toContain('never their pose')
    expect(prompt).not.toContain('from the previous image')
    expect(prompt).not.toContain('established cast')
  })
})

describe('word budget', () => {
  it('a simple character/object prompt stays within budget', () => {
    const obj = composeFor({ visualFocus: 'object', characterNames: [], shotType: 'close-up', locationName: LAUNDROMAT.name, startFrame: 'the dress in the drum', blocking: { objectPhysics: [{ item: "a yellow child's dress", containment: 'inside the drum behind the glass' }] } })
    expect(words(obj)).toBeLessThanOrEqual(75)
    const char = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'Nadia at the washer' })
    expect(words(char)).toBeLessThanOrEqual(75)
  })
  it('optional flourish is dropped before essential subject/setting content', () => {
    // A dense two-subject blocking keeps every subject (essential) even past the soft budget.
    const prompt = composeFor({
      shotType: 'over-the-shoulder', characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'over the shoulder',
      blocking: { subjects: [
        { name: 'Nadia Brooks', visibility: 'shoulder_only', depth: 'extreme_foreground', screenRegion: 'left' },
        { name: 'Mr. Park', visibility: 'full', depth: 'midground', screenRegion: 'right' },
      ] },
    })
    expect(prompt).toContain('Nadia Brooks')
    expect(prompt).toContain('Mr. Park')
  })
})

describe('object focus — positive clause, no negation pile, no person', () => {
  const dress = 'the yellow child-sized dress deep inside the washer drum behind the circular glass'
  it('states one positive object clause with a single "no person" constraint', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: [], locationName: LAUNDROMAT.name, startFrame: dress, blocking: { objectPhysics: [{ item: "a yellow child's dress", containment: 'inside the drum behind the glass', gravityState: 'sunk beneath the clothes' }] } })
    expect(prompt).toContain('no person in frame')
    expect(prompt).toContain('sunk beneath the clothes')
    // the old negation pile is gone
    expect(prompt).not.toContain('never arranged, folded flat')
    expect(prompt).not.toContain('empty and unworn')
  })
  it('a fabric item with no physics still reads as collapsed, positively', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: [], startFrame: dress, blocking: { objectPhysics: [{ item: 'a cotton dress' }] } })
    expect(prompt).toContain('a loose crumpled tangle of fabric')
  })
  it('drops all character identity and uses insert framing (off-center, no "camera centered")', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: ['Nadia Brooks', 'Mr. Park'], startFrame: dress, blocking: { objectPhysics: [{ item: 'a dress' }] } })
    expect(prompt).not.toContain('box braids')
    expect(prompt).toContain('off-center')
    expect(prompt).not.toContain('camera centered')
  })
})

describe('environment focus', () => {
  it('reads as an empty location with no people, no identity', () => {
    const prompt = composeFor({ visualFocus: 'environment', characterNames: [], locationName: LAUNDROMAT.name, startFrame: 'the empty laundromat' })
    expect(prompt).toContain('no people present')
    expect(prompt).not.toContain('box braids')
  })
})

describe('character focus — identity once, positive presence', () => {
  it('includes identity and a positive subject line (no "clearly visible", no "do not omit")', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], locationName: LAUNDROMAT.name, startFrame: 'Nadia at the washer' })
    expect(prompt).toContain('box braids')
    expect(prompt).toContain('Nadia Brooks the clear subject of the frame')
    expect(prompt).not.toContain('do not omit')
  })
  it('states multiple characters positively', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).toContain('Nadia Brooks and Mr. Park both in frame')
    expect(prompt).not.toContain('do not omit')
  })
})

describe('shot-grammar-aware presence (no blocking)', () => {
  it('over-the-shoulder reads positively, no two-shot negation', () => {
    const prompt = composeFor({ shotType: 'over-the-shoulder', characterNames: ['Nadia Brooks', 'Mr. Park'], locationName: LAUNDROMAT.name, startFrame: 'x' })
    expect(prompt).toContain("framed over Nadia Brooks's shoulder")
    expect(prompt).not.toContain('do not stage')
    expect(prompt).not.toContain('two-shot')
  })
})

describe('structured blocking (subject + action first, inline anchors)', () => {
  const otsBlocking: MomentBlocking = {
    actionPhase: 'action_ready',
    focalAction: 'Luis extends a detergent packet toward Nadia',
    subjects: [
      { name: 'Nadia Brooks', visibility: 'shoulder_only', depth: 'extreme_foreground', screenRegion: 'left', bodyOrientation: 'back_to_camera', skin: 'medium-dark skin', hair: 'long box braids', wardrobe: 'navy scrubs' },
      { name: 'Luis Ortega', visibility: 'full', depth: 'midground', screenRegion: 'right', bodyOrientation: 'three_quarter_left', pose: 'holding out a small packet', skin: 'warm brown skin', hair: 'short black hair', wardrobe: 'brown jacket' },
    ],
    avoid: ['symmetrical two-shot', 'posed portrait'],
  }
  it('inlines visible identity anchors right after the name, before pose', () => {
    const prompt = composeFor({ shotType: 'over-the-shoulder', characterNames: ['Nadia Brooks', 'Luis Ortega'], startFrame: 'over the shoulder', blocking: otsBlocking })
    expect(prompt).toContain('Nadia Brooks (medium-dark skin, long box braids, navy scrubs)')
    expect(prompt.indexOf('long box braids')).toBeLessThan(prompt.indexOf('back to the camera'))
  })
  it('OTS foreground subject stays partial (shoulder-only), never a full "clear subject"', () => {
    const prompt = composeFor({ shotType: 'over-the-shoulder', characterNames: ['Nadia Brooks', 'Luis Ortega'], startFrame: 'x', blocking: otsBlocking })
    expect(prompt).toContain('only one shoulder and the back of their head in frame')
    expect(prompt).not.toContain('clear subject of the frame')
  })
  it('gives the two characters distinct depths/regions (not stacked)', () => {
    const prompt = composeFor({ shotType: 'over-the-shoulder', characterNames: ['Nadia Brooks', 'Luis Ortega'], startFrame: 'x', blocking: otsBlocking })
    expect(prompt).toContain('In the extreme foreground on the left of the frame')
    expect(prompt).toContain('In the midground on the right of the frame')
  })
  it('the composition/subject leads the prompt (subject + action first)', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks', 'Luis Ortega'], startFrame: 'THE-INSTANT', blocking: otsBlocking })
    expect(prompt.startsWith('THE-INSTANT')).toBe(true)
  })
  it('still never serializes the avoid list', () => {
    const prompt = composeFor({ characterNames: ['Nadia Brooks'], startFrame: 'x', blocking: otsBlocking })
    expect(prompt).not.toContain('Avoid:')
  })
  it('drops inline anchors the visibility cannot show (silhouette)', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking: { subjects: [{ name: 'Nadia Brooks', visibility: 'silhouette', depth: 'foreground', screenRegion: 'left', skin: 'medium-dark skin', hair: 'long box braids' }] } })
    expect(prompt).not.toContain('(medium-dark skin')
    expect(prompt).toContain('shown only as a silhouette')
  })
})

describe('SETTING LOCK + practical lighting', () => {
  const blocking: MomentBlocking = {
    settingCategory: 'public commercial coin laundromat',
    practicalLighting: 'fluorescent tubes, half switched off at closing time',
    environmentAnchors: ['row of silver front-loading washers', 'orange plastic chairs'],
    subjects: [{ name: 'Nadia Brooks', visibility: 'partial', depth: 'foreground', screenRegion: 'left' }],
  }
  it('emits a single SETTING LOCK with the venue + anchors', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking })
    expect(prompt).toContain('SETTING LOCK — public commercial coin laundromat')
    expect(prompt).toContain('row of silver front-loading washers')
  })
  it('a fluorescent location strips the style prefix "natural lighting"', () => {
    const prompt = composeFor({ stylePreset: 'hyper-realistic', shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking })
    expect(prompt).not.toContain('natural lighting')
    expect(prompt).toContain('fluorescent')
  })
})

describe('contradiction cleanup', () => {
  it('resolves accepting/not-reaching', () => {
    const prompt = composeFor({ shotType: 'medium', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking: { actionPhase: 'action_ready', focalAction: 'Nadia accepts the detergent packet', subjects: [{ name: 'Nadia Brooks', visibility: 'partial', depth: 'foreground', screenRegion: 'left', pose: 'her hand still in her lap' }] } })
    // focalAction is no longer serialized, but the rewrite still prevents an "accepts" claim
    expect(prompt).not.toContain('accepts the detergent')
  })
  it('waist-up cannot be "fully visible"', () => {
    const prompt = composeFor({ shotType: 'medium', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking: { subjects: [{ name: 'Nadia Brooks', visibility: 'full', depth: 'foreground', screenRegion: 'left' }] } })
    expect(prompt).not.toContain('fully visible')
  })
  it('foreground-centre shifts off-centre under an avoid-centred cue', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'x', blocking: { avoid: ['centered composition'], subjects: [{ name: 'Nadia Brooks', visibility: 'full', depth: 'foreground', screenRegion: 'center' }] } })
    expect(prompt).toContain('In the foreground on the left of the frame')
  })
})

describe('visibility sanitation across all free-text fields (waist-up)', () => {
  it('strips footwear/floor/threshold from startFrame, object physics and setting anchors', () => {
    const prompt = composeFor({
      shotType: 'medium', characterNames: ['Nadia Brooks'],
      startFrame: 'Nadia at the washer, wet white sneakers on the tile floor',
      blocking: { settingCategory: 'coin laundromat', environmentAnchors: ['row of washers', 'soap residue on the tile floor'] },
    })
    expect(prompt).not.toMatch(/\bsneakers\b/)
    expect(prompt).not.toContain('tile floor')
    expect(prompt).toContain('row of washers')
  })
  it('a wide shot keeps footwear (feet are in frame)', () => {
    const prompt = composeFor({ shotType: 'wide', characterNames: ['Nadia Brooks'], startFrame: 'Nadia, wet white sneakers on the tile floor' })
    expect(prompt).toContain('sneakers')
  })
  it('strips behavioral prose from the identity line', () => {
    const prompt = buildImagePrompt('cinematic', 'Nadia — box braids, navy scrubs. Moves quickly and speaks defensively', 'medium', 'x', null, ['Nadia'], 'character', null)
    expect(prompt).not.toContain('speaks defensively')
  })
})

describe('no-person object frame — no positive held claim, no door/glass contradiction', () => {
  it('drops "held in a hand" and resolves open-door vs behind-glass', () => {
    const prompt = composeFor({ visualFocus: 'object', characterNames: [], shotType: 'close-up', startFrame: 'the washer door is open, a scoop held in a hand, the dress behind the circular glass', blocking: { objectPhysics: [{ item: 'a scoop' }] } })
    expect(prompt).not.toContain('held in a hand')
    expect(prompt).not.toMatch(/door is open|open door/i)
    expect(prompt).toContain('behind the circular glass')
  })
})

describe('reference-image pathway', () => {
  it('emits reference language only when a real reference is supplied', () => {
    expect(composeFor({ characterNames: ['Nadia Brooks'], startFrame: 'x' })).not.toContain('reference image')
    expect(composeFor({ characterNames: ['Nadia Brooks'], startFrame: 'x', referenceImage: { url: 'https://x/ref.png', conditions: 'identity' } })).toContain('using the supplied reference image for identity')
  })
})

describe('parseAvoid (normalize on save, cap at three)', () => {
  it('keeps multi-word phrases and trims empties', () => {
    expect(parseAvoid('posed portrait, symmetrical two-shot')).toEqual(['posed portrait', 'symmetrical two-shot'])
    expect(parseAvoid('a ,  b ')).toEqual(['a', 'b'])
    expect(parseAvoid('   ')).toEqual([])
  })
  it('caps at three concepts', () => {
    expect(parseAvoid('a, b, c, d, e')).toEqual(['a', 'b', 'c'])
  })
})

describe('buildImagePrompt basics', () => {
  it('keeps the 9:16 format and omits an empty cast', () => {
    const prompt = buildImagePrompt('cinematic', '', 'medium', 'a room', null, [], 'environment', null)
    expect(prompt).toContain('9:16')
    expect(prompt).not.toContain('box braids')
  })
})
