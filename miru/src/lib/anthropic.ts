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
      "durationSeconds": 3
    }
  ]
}

Rules:
- durationSeconds must be 2-10. Size each moment by its content: a quick action beat runs 2-3 seconds; a lingering emotional or atmospheric beat can run up to 10.
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
}

export interface MomentBreakdownResult {
  moments: BreakdownMoment[]
}

async function callClaude(script: string, retry: boolean): Promise<string> {
  // This model rejects assistant-turn prefill (400: "does not support assistant message
  // prefill"), so the retry reminder is sent as a plain user message, not a forced "{" start.
  const messages = retry
    ? [{ role: 'user' as const, content: `${script}\n\n${RETRY_REMINDER}` }]
    : [{ role: 'user' as const, content: script }]

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
      system: SYSTEM_PROMPT,
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

export async function breakdownMoments(script: string): Promise<MomentBreakdownResult> {
  let rawText = await callClaude(script, false)

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(rawText))
  } catch {
    // One retry with an explicit "JSON only" reminder before surfacing an error.
    rawText = await callClaude(script, true)
    try {
      parsed = JSON.parse(stripCodeFence(rawText))
    } catch {
      throw new Error("We couldn't generate a moment breakdown from that script. Please try again.")
    }
  }

  const errors = validate(parsed)
  if (errors.length > 0) {
    throw new Error("We couldn't generate a valid moment breakdown from that script. Please try again.")
  }

  return parsed as MomentBreakdownResult
}
