import type { ShotType } from '@/types'

// Ported from personalprojects/scenelab-api-test/test-scene-breakdown.js — this prompt
// has been iterated on and validated against varied scripts (fast-paced, dialogue-heavy,
// twist-reveal, very-short, very-dense, talking-head). Do not rewrite it.
const SYSTEM_PROMPT = `You are a professional storyboard artist and script supervisor. Given a short-form video script, break it into 8-12 scenes. Each scene represents a distinct visual moment. Return ONLY valid JSON - no explanation, no markdown, no code fences.

Schema:
{
  "scenes": [
    {
      "number": 1,
      "shotType": "wide | medium | close-up | pov | over-the-shoulder",
      "description": "Visual description of what the camera sees. 1-2 sentences. Include subject, action, environment, mood, lighting. Written as a camera direction, not a script line.",
      "durationSeconds": 3
    }
  ]
}

Rules:
- durationSeconds must be 2-5. Vary it based on scene complexity and emotional weight.
- Descriptions must be visual and specific. Not 'she looks sad' - 'a young woman stares out a rain-streaked window, her reflection ghostly against the dark street below.'
- First scene must be a strong visual hook.
- Distribute shot types naturally across the breakdown.
- Never return anything outside the JSON object.
- Do not wrap the JSON in a code block (no \`\`\`json or \`\`\`). Your entire response must be the raw JSON object, starting with { and ending with }.`

const RETRY_REMINDER = 'Return ONLY the JSON object. No explanation, no markdown, no code fences.'

const VALID_SHOT_TYPES: ShotType[] = ['wide', 'medium', 'close-up', 'pov', 'over-the-shoulder']

export interface SceneBreakdownScene {
  number: number
  shotType: ShotType
  description: string
  durationSeconds: number
}

export interface SceneBreakdownResult {
  scenes: SceneBreakdownScene[]
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

// This model rejects assistant-turn prefill (400: "does not support assistant message
// prefill"), so we can't force the response to start with "{". Instead, strip a wrapping
// ```json ... ``` fence if the model adds one anyway.
function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : text
}

function validate(data: unknown): string[] {
  const errors: string[] = []
  const sceneData = data as SceneBreakdownResult

  if (!sceneData.scenes || !Array.isArray(sceneData.scenes)) {
    errors.push('Missing or invalid "scenes" array')
    return errors
  }

  if (sceneData.scenes.length > 12) {
    errors.push(`Scene count ${sceneData.scenes.length} exceeds the 12-scene cap`)
  }

  sceneData.scenes.forEach((scene, i) => {
    const label = `Scene ${scene.number ?? i + 1}`
    if (!VALID_SHOT_TYPES.includes(scene.shotType)) {
      errors.push(`${label}: invalid shotType "${scene.shotType}"`)
    }
    if (typeof scene.durationSeconds !== 'number' || scene.durationSeconds < 2 || scene.durationSeconds > 5) {
      errors.push(`${label}: durationSeconds ${scene.durationSeconds} outside 2-5 range`)
    }
    if (!scene.description || scene.description.length < 20) {
      errors.push(`${label}: description missing or too short`)
    }
  })

  return errors
}

export async function breakdownScenes(script: string): Promise<SceneBreakdownResult> {
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
      throw new Error("We couldn't generate a scene breakdown from that script. Please try again.")
    }
  }

  const errors = validate(parsed)
  if (errors.length > 0) {
    throw new Error("We couldn't generate a valid scene breakdown from that script. Please try again.")
  }

  return parsed as SceneBreakdownResult
}
