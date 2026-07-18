import type { ShotType } from '@/types'

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
      "scriptAnchor": "The alarm blares. Maya's eyes snap"
    }
  ]
}

Rules:
- durationSeconds must be 2-10. Size each moment by its content: a quick action beat runs 2-3 seconds; a lingering emotional or atmospheric beat can run up to 10.
- scriptAnchor is the VERBATIM first 4-8 words of the passage of the ORIGINAL script this moment is drawn from — copied character-for-character (same punctuation, same capitalization), never paraphrased. Anchors must appear in the same order as the script. If a moment has no contiguous source passage, use null for scriptAnchor instead of guessing.
- Descriptions must be visual and specific. Not 'she looks sad' - 'a young woman stares out a rain-streaked window, her reflection ghostly against the dark street below.'
- First moment must be a strong visual hook.
- Distribute shot types naturally across the breakdown.
- Never return anything outside the JSON object.
- Do not wrap the JSON in a code block (no \`\`\`json or \`\`\`). Your entire response must be the raw JSON object, starting with { and ending with }.`

const RETRY_REMINDER = 'Return ONLY the JSON object. No explanation, no markdown, no code fences.'

const VALID_SHOT_TYPES: ShotType[] = ['wide', 'medium', 'close-up', 'pov', 'over-the-shoulder']

export interface BreakdownMoment {
  number: number
  shotType: ShotType
  description: string
  durationSeconds: number
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
      max_tokens: 2000,
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

export async function breakdownMoments(script: string): Promise<MomentBreakdownResult> {
  const parsed = await callAndParse(
    SYSTEM_PROMPT,
    script,
    "We couldn't generate a moment breakdown from that script. Please try again."
  )

  const errors = validate(parsed)
  if (errors.length > 0) {
    throw new Error("We couldn't generate a valid moment breakdown from that script. Please try again.")
  }

  const result = parsed as MomentBreakdownResult
  resolveScriptSpans(script, result.moments)
  return result
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
