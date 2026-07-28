import type {
  ActionPhase,
  BodyOrientation,
  DepthPlane,
  MomentBlocking,
  ObjectPhysics,
  ScreenRegion,
  ShotType,
  SubjectBlocking,
  SymmetryIntent,
  VisibilityMode,
  VisualFocus,
} from '@/types'

// Ported from personalprojects/scenelab-api-test/test-scene-breakdown.js and revised
// 2026-07-17 for the moments rebrand (scenes→moments, durations 2-5→2-10). The revision
// was re-validated against the sandbox test script before shipping. Do not rewrite the
// prompt beyond validated changes.
const SYSTEM_PROMPT = `You are a professional storyboard artist and script supervisor. Given a short-form video script, break it into 8-12 moments — the distinct visual beats that together form one continuous scene. Return ONLY valid JSON - no explanation, no markdown, no code fences.

Schema:
{
  "moments": [
    {
      "number": 1,
      "shotType": "wide | medium | close-up | pov | over-the-shoulder",
      "description": "Visual description of what the camera sees. 1-2 sentences. Include subject, action, environment, mood, lighting. Written as a camera direction, not a script line.",
      "durationSeconds": 3,
      "scriptAnchor": "The alarm blares. Maya's eyes snap",
      "visualFocus": "character",
      "characters": ["Maya"],
      "startFrame": "Maya lies in bed with her eyes just snapped open, room dark, alarm clock glowing beside her",
      "motion": "She sits up sharply and swings her legs off the bed; the camera holds steady at bedside height",
      "endFrame": "Maya sits upright on the edge of the bed, feet on the floor, silhouetted against the window",
      "location": "Maya's bedroom",
      "blocking": {
        "actionPhase": "pre_action",
        "focalAction": "Maya's eyes snapping open in the dark",
        "settingCategory": "small urban bedroom at night",
        "practicalLighting": "dim glow from the bedside alarm clock, no other light",
        "environmentAnchors": ["glowing red alarm clock", "rumpled bedsheets", "curtained window"],
        "subjects": [
          { "name": "Maya", "visibility": "full", "depth": "foreground", "screenRegion": "left", "bodyOrientation": "toward_camera", "gazeTarget": "the ceiling", "pose": "lying on her back, one hand near her face", "skin": "pale complexion", "hair": "short dark bob", "wardrobe": "grey sleep shirt" }
        ],
        "objectPhysics": [],
        "avoid": ["posed portrait", "symmetrical two-shot"]
      }
    }
  ]
}

Rules:
- durationSeconds must be 2-10. Size each moment by its content: a quick action beat runs 2-3 seconds; a lingering emotional or atmospheric beat can run up to 10.
- scriptAnchor is the VERBATIM first 4-8 words of the passage of the ORIGINAL script this moment is drawn from — copied character-for-character (same punctuation, same capitalization), never paraphrased. Anchors must appear in the same order as the script. If a moment has no contiguous source passage, use null for scriptAnchor instead of guessing.
- visualFocus classifies what the frame is ABOUT: "character" (a single person is the subject), "multiple_characters" (several people together), "object" (an insert or detail of a thing — a prop, a garment, an item — with NO person in the frame), "environment" (an empty location or establishing shot with no people), or "mixed" (a person AND a prominent object both matter). An insert or detail shot of a thing is "object", never "character" — e.g. a shot of clothes tumbling inside a washer drum is "object".
- characters lists which members of the provided CAST are VISIBLY PRESENT in this moment's frame — only names from the cast list, spelled exactly as given. A close-up of one person lists only that person. Use [] for moments where no cast member is on screen (empty environments, objects, inserts). If no cast list is provided, always use []. When visualFocus is "object" or "environment", characters MUST be [] — there is no person in that frame.
- startFrame and endFrame are STILL descriptions: the exact frozen instant the shot OPENS (before any of the shot's action has occurred) and the frozen instant it CLOSES (after the action completes). Write both as static compositions — what a paused frame shows: subject placement, pose, expression, environment. Never write them as ongoing narration.
- When the script implies a spatial relationship between the subject and an object, or between two objects, make it EXPLICIT and visible in startFrame/endFrame: which object is inside/behind/on top of/held by/positioned relative to which. An object inside a container must be described as visibly inside it (e.g. "a yellow dress tumbling behind the circular glass door of the washing machine", not just "doing laundry"). Name the key foreground object and where it sits in the frame.
- startFrame is ONE frozen instant, never a sequence. Do not chain multiple points in time (e.g. NOT "the drum is empty, water begins to pour, the dress falls and settles beneath the clothes" — pick the single instant this shot opens on). Do not describe a container as both open and closed-behind-glass. In an object-only insert with no person in frame, nothing is "held" or "in someone's hand" — describe items as resting, sunk, or piled, not held.
- motion describes only what CHANGES between startFrame and endFrame, as forward progression: the subject's action first, then camera movement. Never restate the composition.
- blocking is the composition plan — a shot label alone is not one. Fill it so the still reads as motivated cinematic blocking, not a posed portrait or a catalog display:
  - actionPhase: one of "pre_action" | "action_ready" | "mid_action" | "post_action".
  - focalAction: the single most important thing happening AT THE FROZEN startFrame INSTANT, in a few words. It must match startFrame's moment in time — never describe a later beat from motion/endFrame. If startFrame shows a character's hand still in her lap, focalAction must NOT say she is accepting or taking anything.
  - settingCategory: the explicit venue type in plain words (e.g. "public commercial coin laundromat", "small urban bedroom at night"). Name the category, not a mood.
  - practicalLighting: the light the LOCATION itself produces (e.g. "fluorescent tubes, half switched off at closing time"). Prefer the practical source over generic "natural light".
  - environmentAnchors: exactly 2-3 concrete, visible fixtures of this location (e.g. ["row of silver front-loading washers", "orange plastic chairs", "scratched folding table"]).
  - subjects: one entry PER visible character (use the exact cast name). Each has visibility ("full" | "partial" | "back_only" | "shoulder_only" | "hands_only" | "silhouette" | "offscreen"), depth ("extreme_foreground" | "foreground" | "midground" | "background"), screenRegion ("far_left" | "left" | "center" | "right" | "far_right"), and optionally bodyOrientation ("toward_camera" | "three_quarter_left" | "three_quarter_right" | "profile_left" | "profile_right" | "back_to_camera" | "toward_object" | "away_from_other_character"), gazeTarget, pose, occludedBy. Also give compact VISIBLE identity anchors: skin (skin tone/complexion), hair (hairstyle), wardrobe (dominant visible garments) — only what THIS shot and this visibility can physically show (no shoes in a waist-up shot; nothing for a silhouette). Give characters DIFFERENT depths/regions when the action separates them; do not stack everyone frontally at center. For an over-the-shoulder shot, the foreground character's visibility is "shoulder_only" or "back_only", never "full".
  - objectPhysics: one entry per important object (especially for object/mixed focus). Each has item, and optionally gravityState (how it is supported or falling), deformation (how the material bends/crumples), containment (what it is inside/behind), occlusion, and symmetry ("natural" | "avoid" | "intentional"). Loose fabric and unsupported items use symmetry "avoid".
  - avoid: 1-3 composition clichés this specific shot should NOT fall into (e.g. "symmetrical two-shot", "posed portrait", "garment displayed flat like a product"). A foreground-centre subject must not be combined with an avoid-centred cue.
- location names which entry from the provided SETTINGS list this shot takes place in — copy the setting's name exactly as spelled in the list. Strongly PREFER an existing setting: different phrasings of the same physical place ("outside the pharmacy", "pharmacy entrance", "the parking lot in front of the pharmacy") all resolve to the SAME setting. Multiple shots in one place must share one setting name. Assign every shot to a provided setting unless no setting could plausibly contain it; only then use null. Never invent a location outside the list.
- Descriptions must be visual and specific. Not 'she looks sad' - 'a young woman stares out a rain-streaked window, her reflection ghostly against the dark street below.'
- First moment must be a strong visual hook.
- Distribute shot types naturally across the breakdown.
- Every moment must include ALL schema fields: number, shotType, description, durationSeconds, scriptAnchor, visualFocus, characters, startFrame, motion, endFrame, location, blocking. Never omit a field.
- Never return anything outside the JSON object.
- Do not wrap the JSON in a code block (no \`\`\`json or \`\`\`). Your entire response must be the raw JSON object, starting with { and ending with }.`

const RETRY_REMINDER = 'Return ONLY the JSON object. No explanation, no markdown, no code fences.'

const VALID_SHOT_TYPES: ShotType[] = ['wide', 'medium', 'close-up', 'pov', 'over-the-shoulder']

const VALID_VISUAL_FOCUS: VisualFocus[] = ['character', 'multiple_characters', 'object', 'environment', 'mixed']

// A recognized focus passes through; anything else → null (derived from cast size later).
function normalizeVisualFocus(value: unknown): VisualFocus | null {
  return typeof value === 'string' && (VALID_VISUAL_FOCUS as string[]).includes(value)
    ? (value as VisualFocus)
    : null
}

// ---- Blocking normalization (never fatal: bad values are dropped, not thrown) ----
const VISIBILITY: VisibilityMode[] = ['full', 'partial', 'back_only', 'shoulder_only', 'hands_only', 'silhouette', 'offscreen']
const DEPTH: DepthPlane[] = ['extreme_foreground', 'foreground', 'midground', 'background']
const REGION: ScreenRegion[] = ['far_left', 'left', 'center', 'right', 'far_right']
const ORIENTATION: BodyOrientation[] = [
  'toward_camera', 'three_quarter_left', 'three_quarter_right', 'profile_left', 'profile_right',
  'back_to_camera', 'toward_object', 'away_from_other_character',
]
const PHASE: ActionPhase[] = ['pre_action', 'action_ready', 'mid_action', 'post_action']
const SYMMETRY: SymmetryIntent[] = ['natural', 'avoid', 'intentional']

function oneOf<T extends string>(valid: T[], value: unknown): T | null {
  return typeof value === 'string' && (valid as string[]).includes(value) ? (value as T) : null
}
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// A subject is kept only if it has the three required placement enums; optional fields are
// coerced or dropped. This tolerates a partial/hallucinated blocking object without failing.
function normalizeSubjects(value: unknown): SubjectBlocking[] {
  if (!Array.isArray(value)) return []
  const out: SubjectBlocking[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const visibility = oneOf(VISIBILITY, r.visibility)
    const depth = oneOf(DEPTH, r.depth)
    const screenRegion = oneOf(REGION, r.screenRegion)
    if (!visibility || !depth || !screenRegion) continue
    out.push({
      name: str(r.name),
      visibility,
      depth,
      screenRegion,
      bodyOrientation: oneOf(ORIENTATION, r.bodyOrientation),
      gazeTarget: str(r.gazeTarget),
      pose: str(r.pose),
      occludedBy: str(r.occludedBy),
      skin: str(r.skin),
      hair: str(r.hair),
      wardrobe: str(r.wardrobe),
    })
  }
  return out
}

function normalizeObjectPhysics(value: unknown): ObjectPhysics[] {
  if (!Array.isArray(value)) return []
  const out: ObjectPhysics[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const item = str(r.item)
    if (!item) continue
    out.push({
      item,
      gravityState: str(r.gravityState),
      deformation: str(r.deformation),
      containment: str(r.containment),
      occlusion: str(r.occlusion),
      symmetry: oneOf(SYMMETRY, r.symmetry),
    })
  }
  return out
}

// Returns a cleaned blocking object, or null if nothing usable survived — so a moment that
// the model left blank (or malformed) simply composes with the legacy shot-label behavior.
function normalizeBlocking(value: unknown): MomentBlocking | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const blocking: MomentBlocking = {
    actionPhase: oneOf(PHASE, r.actionPhase),
    focalAction: str(r.focalAction),
    subjects: normalizeSubjects(r.subjects),
    objectPhysics: normalizeObjectPhysics(r.objectPhysics),
    avoid: Array.isArray(r.avoid) ? r.avoid.map(str).filter((s): s is string => !!s).slice(0, 4) : [],
    settingCategory: str(r.settingCategory),
    practicalLighting: str(r.practicalLighting),
    environmentAnchors: Array.isArray(r.environmentAnchors)
      ? r.environmentAnchors.map(str).filter((s): s is string => !!s).slice(0, 3)
      : [],
  }
  const empty =
    !blocking.actionPhase &&
    !blocking.focalAction &&
    !blocking.settingCategory &&
    !blocking.practicalLighting &&
    blocking.environmentAnchors!.length === 0 &&
    blocking.subjects!.length === 0 &&
    blocking.objectPhysics!.length === 0 &&
    blocking.avoid!.length === 0
  return empty ? null : blocking
}

export interface BreakdownMoment {
  number: number
  shotType: ShotType
  description: string
  durationSeconds: number
  // What the frame is about; object/environment frames carry no visible cast.
  visualFocus?: VisualFocus | null
  // Composition/blocking plan (normalized server-side; always optional — never fatal).
  blocking?: MomentBlocking | null
  // Which provided cast members are visibly present in this moment's frame.
  characters?: string[]
  // Temporal split: frozen opening composition / forward change / frozen closing composition.
  startFrame?: string | null
  motion?: string | null
  endFrame?: string | null
  // Which provided setting this shot takes place in (null when none provided/fits).
  location?: string | null
  scriptAnchor?: string | null
  // Derived server-side from scriptAnchor via whitespace-tolerant in-order matching —
  // never trusted from the model directly (models can't do character arithmetic).
  scriptSpan?: { start: number; end: number } | null
}

export interface MomentBreakdownResult {
  moments: BreakdownMoment[]
}

async function callClaude(system: string, userContent: string, retry: boolean): Promise<string> {
  // This model rejects assistant-turn prefill (400: "does not support assistant message
  // prefill"), so the retry reminder is sent as a plain user message, not a forced "{" start.
  const messages = retry
    ? [{ role: 'user' as const, content: `${userContent}\n\n${RETRY_REMINDER}` }]
    : [{ role: 'user' as const, content: userContent }]

  const key = process.env.ANTHROPIC_API_KEY

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      // The breakdown's per-moment fields (startFrame/motion/endFrame + the blocking plan)
      // make responses several× longer than the original schema; 6000 risked truncation on
      // 10-12 moments once per-subject blocking was added.
      max_tokens: 9000,
      system,
      messages,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${body}`)
  }

  const data = await response.json()
  return data.content.find((block: { type: string }) => block.type === 'text')?.text ?? ''
}

// Strip a wrapping ```json ... ``` fence if the model adds one despite the prompt.
function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : text
}

function validate(data: unknown): string[] {
  const errors: string[] = []
  const breakdown = data as MomentBreakdownResult

  if (!breakdown.moments || !Array.isArray(breakdown.moments)) {
    errors.push('Missing or invalid "moments" array')
    return errors
  }

  if (breakdown.moments.length > 12) {
    errors.push(`Moment count ${breakdown.moments.length} exceeds the 12-moment cap`)
  }

  breakdown.moments.forEach((moment, i) => {
    const label = `Moment ${moment.number ?? i + 1}`
    if (!VALID_SHOT_TYPES.includes(moment.shotType)) {
      errors.push(`${label}: invalid shotType "${moment.shotType}"`)
    }
    if (typeof moment.durationSeconds !== 'number' || moment.durationSeconds < 2 || moment.durationSeconds > 10) {
      errors.push(`${label}: durationSeconds ${moment.durationSeconds} outside 2-10 range`)
    }
    if (!moment.description || moment.description.length < 20) {
      errors.push(`${label}: description missing or too short`)
    }
  })

  return errors
}

// Shared call-parse-retry flow: one retry with an explicit "JSON only" reminder before
// surfacing a human-readable error.
async function callAndParse(system: string, userContent: string, failureMessage: string): Promise<unknown> {
  let rawText = await callClaude(system, userContent, false)
  try {
    return JSON.parse(stripCodeFence(rawText))
  } catch {
    rawText = await callClaude(system, userContent, true)
    try {
      return JSON.parse(stripCodeFence(rawText))
    } catch {
      throw new Error(failureMessage)
    }
  }
}

// Whitespace-tolerant, in-order anchor resolution (validated in
// scenelab-api-test/test-scene-breakdown.js, anchor yield 11-12/12 on normal scripts).
// Collapses whitespace runs on both sides while keeping an index map back to raw offsets.
// A missed anchor degrades to a null span — choreography data, never a breakdown failure.
function resolveScriptSpans(script: string, moments: BreakdownMoment[]): void {
  const map: number[] = []
  let normalized = ''
  let lastWasSpace = true
  for (let i = 0; i < script.length; i++) {
    if (/\s/.test(script[i])) {
      if (!lastWasSpace) {
        normalized += ' '
        map.push(i)
        lastWasSpace = true
      }
    } else {
      normalized += script[i]
      map.push(i)
      lastWasSpace = false
    }
  }

  const starts: (number | null)[] = []
  let searchFrom = 0
  for (const moment of moments) {
    const anchor = moment.scriptAnchor
    if (typeof anchor !== 'string' || anchor.trim().length < 4) {
      starts.push(null)
      continue
    }
    const idx = normalized.indexOf(anchor.trim().replace(/\s+/g, ' '), searchFrom)
    if (idx === -1) {
      starts.push(null)
      continue
    }
    starts.push(map[idx])
    searchFrom = idx + anchor.trim().replace(/\s+/g, ' ').length
  }

  // Each resolved moment's span runs from its anchor to the next resolved anchor.
  moments.forEach((moment, i) => {
    const start = starts[i]
    if (start === null || start === undefined) {
      moment.scriptSpan = null
      return
    }
    let end = script.length
    for (let j = i + 1; j < starts.length; j++) {
      const next = starts[j]
      if (next !== null && next !== undefined) {
        end = next
        break
      }
    }
    moment.scriptSpan = start < end ? { start, end } : null
  })
}

export async function breakdownMoments(
  script: string,
  cast: { name: string; description: string }[] = [],
  settings: { name: string; description: string }[] = []
): Promise<MomentBreakdownResult> {
  const describedCast = cast.filter((c) => c.name.trim() && c.description.trim())
  const describedSettings = settings.filter((s) => s.name.trim() && s.description.trim())
  const blocks: string[] = []
  if (describedCast.length > 0) {
    blocks.push(`CAST:\n${describedCast.map((c) => `${c.name.trim()} — ${c.description.trim()}`).join('\n')}`)
  }
  if (describedSettings.length > 0) {
    blocks.push(`SETTINGS:\n${describedSettings.map((s) => `${s.name.trim()} — ${s.description.trim()}`).join('\n')}`)
  }
  blocks.push(blocks.length > 0 ? `SCRIPT:\n${script}` : script)
  const userContent = blocks.join('\n\n')

  const parsed = await callAndParse(
    SYSTEM_PROMPT,
    userContent,
    "We couldn't generate a moment breakdown from that script. Please try again."
  )

  const errors = validate(parsed)
  if (errors.length > 0) {
    throw new Error("We couldn't generate a valid moment breakdown from that script. Please try again.")
  }

  const result = parsed as MomentBreakdownResult
  resolveScriptSpans(script, result.moments)

  // Keep only names that actually exist in the cast — a hallucinated name silently drops.
  const knownNames = new Set(describedCast.map((c) => c.name.trim()))
  const settingNames = describedSettings.map((s) => s.name.trim())
  for (const moment of result.moments) {
    moment.characters = Array.isArray(moment.characters)
      ? moment.characters.filter((n) => knownNames.has(n))
      : []
    // Normalize the focus; drop an invalid value so it derives from cast size downstream.
    moment.visualFocus = normalizeVisualFocus(moment.visualFocus)
    // Clean the blocking plan; malformed/blank → null (composes with legacy shot labels).
    moment.blocking = normalizeBlocking(moment.blocking)
    // Enforce the invariant the prompt asks for: an object/environment frame has no cast,
    // even if the model attached one. This is the server-side guard that stops the
    // whole-cast-on-an-insert bug regardless of what the model returns.
    if (moment.visualFocus === 'object' || moment.visualFocus === 'environment') {
      moment.characters = []
    }
    // Resolve the model's location phrasing to a real setting (exact → normalized →
    // single distinctive-token match); ambiguous or none → null (never a wrong guess).
    moment.location = resolveSettingName(moment.location, settingNames)
  }

  return result
}

// Deterministic scene→setting resolver (validated in
// scenelab-api-test/test-fuzzy-setting.js). Accepts a fuzzy match only when it identifies
// exactly ONE candidate; genuine ambiguity returns null rather than guessing.
const RESOLVE_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'inside', 'outside', 'near',
  'by', 'behind', 'front', 'into', 'out', 'up', 'down', 'over', 'under', 'is', 'it',
])

function distinctiveTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !RESOLVE_STOPWORDS.has(w))
  )
}

export function resolveSettingName(location: unknown, settingNames: string[]): string | null {
  if (typeof location !== 'string' || !location.trim() || settingNames.length === 0) return null
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const target = norm(location)

  const exact = settingNames.find((n) => norm(n) === target)
  if (exact) return exact

  const contains = settingNames.filter((n) => norm(n).includes(target) || target.includes(norm(n)))
  if (contains.length === 1) return contains[0]

  const locTokens = distinctiveTokens(location)
  const overlaps = settingNames.filter((n) => {
    const st = distinctiveTokens(n)
    for (const t of locTokens) if (st.has(t)) return true
    return false
  })
  return overlaps.length === 1 ? overlaps[0] : null
}

// ---- Auto-population: extract cast + settings from a raw script ----
// Ported from personalprojects/scenelab-api-test/test-extract-context.js (3/3 cases pass:
// render-ready descriptions, unnamed-character handling, location merging).
const EXTRACT_SYSTEM_PROMPT = `You are a script breakdown assistant for an AI storyboard tool. Given a short-form video script, extract two things: the CHARACTERS (every speaking or visually important person/being) and the SETTINGS (every distinct physical location). Return ONLY valid JSON - no explanation, no markdown, no code fences.

Schema:
{
  "characters": [
    { "name": "Maya", "description": "Late-20s woman, dark bob haircut, oversized cream sweater, anxious sharp features, pale complexion, muted cool-toned palette" }
  ],
  "settings": [
    { "name": "Maya's apartment", "description": "Cramped top-floor walk-up at night, warm lamp light, rain-streaked windows, cluttered desk, worn wooden floors" }
  ]
}

Rules:
- Name characters as the script names them; invent a short descriptive name only if unnamed (e.g. "The stranger"). Never duplicate a character.
- Each character description is render-ready: 15-45 words of VISUAL attributes only — approximate age, build, hair, wardrobe with colors, one distinguishing feature, overall palette. Never a bare noun phrase like "young woman". No backstory, no personality, no art-style words.
- Merge locations that are the same physical place under ONE setting, even if the script phrases them differently ("outside the pharmacy", "pharmacy entrance", "parking lot outside pharmacy" are all one setting). Give each a clear name and a 15-45 word visual description: light, time of day, condition, atmosphere, notable objects.
- If the script clearly has no distinct characters (pure landscape) or one location, return the minimal true set — do not invent.
- Never return anything outside the JSON object. Do not wrap it in a code block.`

export interface ExtractedContext {
  characters: { name: string; description: string }[]
  settings: { name: string; description: string }[]
}

export async function extractContext(script: string): Promise<ExtractedContext> {
  const parsed = (await callAndParse(
    EXTRACT_SYSTEM_PROMPT,
    script,
    "We couldn't detect characters and settings from that script. Please try again."
  )) as ExtractedContext

  if (!Array.isArray(parsed.characters) || !Array.isArray(parsed.settings)) {
    throw new Error("We couldn't detect characters and settings from that script. Please try again.")
  }
  const clean = (arr: { name?: unknown; description?: unknown }[]) =>
    arr
      .filter((e) => typeof e.name === 'string' && e.name.trim() && typeof e.description === 'string' && e.description.trim())
      .map((e) => ({ name: (e.name as string).trim(), description: (e.description as string).trim() }))
  return { characters: clean(parsed.characters), settings: clean(parsed.settings) }
}

// Ported from personalprojects/scenelab-api-test/test-character-refine.js — validated
// 2026-07-18 (5/5 runs: attribute preservation, length bounds, no style-word leakage).
const REFINE_SYSTEM_PROMPT = `You are a character designer for AI-generated storyboards. Given a video script and the user's character description, rewrite the description so the same character renders consistently across many independently generated frames. Return ONLY valid JSON - no explanation, no markdown, no code fences.

Schema:
{
  "refined": "The rewritten character description",
  "notes": ["1-3 short notes explaining what you added or tightened and why"]
}

Rules:
- Preserve every concrete visual attribute the user gave (age, hair, clothing, colors, species, features). Never contradict or drop one.
- Add only what improves cross-frame consistency: approximate age, hair style/color, one or two wardrobe items with colors, overall palette, and at most one distinguishing feature. Prefer details the script implies; invent as little as possible.
- Write the refined description as comma-separated visual descriptors, 25-60 words, third person, no name required.
- Visual facts only: no backstory, personality, camera directions, or art-style words (no "anime", "photorealistic", "cinematic" - the app adds style separately).
- notes must be brief and user-facing (they explain the changes to a non-expert).
- Never return anything outside the JSON object. Do not wrap the JSON in a code block. Your entire response must be the raw JSON object, starting with { and ending with }.`

export interface CharacterRefinement {
  refined: string
  notes: string[]
}

export async function refineCharacter(script: string, description: string): Promise<CharacterRefinement> {
  const parsed = (await callAndParse(
    REFINE_SYSTEM_PROMPT,
    `Script:\n${script}\n\nUser's character description:\n${description}`,
    "We couldn't refine the character description. Please try again."
  )) as CharacterRefinement

  if (typeof parsed.refined !== 'string' || !parsed.refined.trim() || !Array.isArray(parsed.notes)) {
    throw new Error("We couldn't refine the character description. Please try again.")
  }

  return { refined: parsed.refined.trim(), notes: parsed.notes.slice(0, 4) }
}

// Setting variant of the refine flow — same structure, tuned for place/atmosphere
// (light, time, condition, notable objects) instead of wardrobe/features.
const REFINE_SETTING_SYSTEM_PROMPT = `You are a location scout for AI-generated storyboards. Given a video script and the user's location description, rewrite it so the same place renders consistently across many independently generated frames. Return ONLY valid JSON - no explanation, no markdown, no code fences.

Schema:
{
  "refined": "The rewritten location description",
  "notes": ["1-3 short notes explaining what you added or tightened and why"]
}

Rules:
- Preserve every concrete visual detail the user gave (place type, time of day, condition, objects). Never contradict or drop one.
- Add only what improves cross-frame consistency: lighting quality and source, time of day, weather/condition, overall palette, and one or two distinctive fixed objects or architectural features. Prefer details the script implies; invent as little as possible.
- Write the refined description as comma-separated visual descriptors, 20-55 words, no people (describe the empty place).
- Visual facts only: no story, no camera directions, no art-style words (no "anime", "cinematic" - the app adds style separately).
- notes must be brief and user-facing.
- Never return anything outside the JSON object. Do not wrap the JSON in a code block.`

export async function refineSetting(script: string, description: string): Promise<CharacterRefinement> {
  const parsed = (await callAndParse(
    REFINE_SETTING_SYSTEM_PROMPT,
    `Script:\n${script}\n\nUser's location description:\n${description}`,
    "We couldn't refine the location description. Please try again."
  )) as CharacterRefinement

  if (typeof parsed.refined !== 'string' || !parsed.refined.trim() || !Array.isArray(parsed.notes)) {
    throw new Error("We couldn't refine the location description. Please try again.")
  }

  return { refined: parsed.refined.trim(), notes: parsed.notes.slice(0, 4) }
}
