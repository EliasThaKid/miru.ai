// Controlled ablation study for the frame-1 black-image collapse.
//
// I (the assistant) cannot run this — the repo policy forbids me from reading FAL_KEY. YOU
// run it with your own key; it prints the exact evidence needed to find the smallest prompt
// fragment that produces a black frame, using the SAME endpoint + image settings as the app.
//
// Usage (bash):        export $(grep -E '^FAL_KEY=' .env.local | xargs) && node scripts/ablation-black-frame.mjs
// Usage (PowerShell):  $env:FAL_KEY=(Get-Content .env.local | Select-String '^FAL_KEY=').ToString().Split('=',2)[1].Trim(); node scripts/ablation-black-frame.mjs
//
// Never prints the key. Image URLs are public fal.media assets (host only is shown).

import { fal } from '@fal-ai/client'
import sharp from 'sharp'

if (!process.env.FAL_KEY) {
  console.error('Set FAL_KEY in your environment first (never commit it).')
  process.exit(1)
}
fal.config({ credentials: process.env.FAL_KEY })

const ENDPOINT = 'fal-ai/flux-pro/v1.1'
const IMAGE_SIZE = 'portrait_16_9'
const FIXED_SEED = 123456 // hold the seed constant across ablations so only the PROMPT varies

// ---------------------------------------------------------------------------------------
// The EXACT failing frame-1 prompt (verbatim), and its faithful section decomposition.
const P = {
  style: 'hyper-realistic render, photoreal detail, high dynamic range, physically accurate materials',
  framing: 'wide shot, full scene and environment visible',
  settingLock:
    'SETTING LOCK — narrow aging coin laundromat at closing time, clearly showing row of silver front-loading washers, orange plastic chairs, wall clock above the counter, lit by fluorescent tubes half switched off, harsh white light at the entrance fading to shadow toward the back row of washers',
  focalAction: 'Focal action: Nadia shouldering through the door with the trash bag pressed against her chest',
  actionPhase: 'Frozen in the instant just before the action begins',
  object:
    "Large black trash bag full of clothes, clothes packed inside, no visible contents from outside, held upright against Nadia's chest by both arms, sides bulging with bundled laundry, top loosely twisted shut, asymmetric and irregular, not arranged or displayed",
  nadia:
    "In the foreground on the left of the frame, Nadia Brooks (medium-dark complexion, rain-wet, long box braids, dark and dripping at the ends, oversized faded denim jacket over navy scrubs, white sneakers wet and dark at the toe) is fully visible, facing the camera, looking toward Mr. Park at the counter, both arms wrapped around a large black trash bag, body angled slightly inward from the door",
  park:
    'In the background on the right of the frame, Mr. Park (light complexion, early-sixties, short gray hair, pale blue button-down shirt, forest-green laundromat apron) is fully visible, turned three-quarters to the left, looking toward Nadia, standing behind the counter, one hand near the edge, head turned toward the entrance',
  startFrame:
    'Nadia stands in the doorway mid-push, trash bag pressed against her chest, wet sneakers on the threshold tile, rain-blurred street visible behind her through the open door; Mr. Park stands behind the counter in the far background, head turned toward the clock on the wall above him',
  settingDesc:
    'The scene takes place in this specific location: Narrow, aging laundromat in Brooklyn with rows of silver washers, orange plastic chairs, scratched folding tables and flickering fluorescent lights. Soap residue marks the tile floor. At closing time, half the lights are off and the room feels unexpectedly intimate. Render this exact environment, not a generic one',
  identity:
    'Character identity reference (appearance only) — Nadia Brooks — Black woman, 32, medium-dark skin, long box braids and tired brown eyes, Lean build, Wearing navy nursing scrubs beneath an oversized faded denim jacket and wet white sneakers; Mr. Park — Korean man, early 60s, short gray hair, Wearing a pale blue button-down shirt, dark trousers and a forest-green laundromat apron',
  continuity:
    'render each character with one consistent identity throughout — the same skin tone, hairstyle, and wardrobe as their anchors above — matching appearance and lighting only, never their pose, placement, camera angle, or composition',
  avoid: 'Avoid: symmetrical two-shot, posed portrait, both subjects centered at the same depth',
  format: 'vertical 9:16 composition, portrait orientation, Instagram Reels format, no text or watermarks',
}

const ORIGINAL_PROMPT = [
  P.style, P.framing, P.settingLock, P.focalAction, P.actionPhase, P.object, P.nadia, P.park,
  P.startFrame, P.settingDesc, P.identity, P.continuity, P.avoid, P.format,
].join('. ')

// Remove ONLY the dark-lighting language (isolate "too dark" as the cause).
function stripDarkness(s) {
  return s
    .replace(
      'lit by fluorescent tubes half switched off, harsh white light at the entrance fading to shadow toward the back row of washers',
      'evenly lit by bright fluorescent ceiling lights'
    )
    .replace(' At closing time, half the lights are off and the room feels unexpectedly intimate.', '')
    .replace('flickering fluorescent lights', 'bright fluorescent lights')
}

// A 60–100 word simplified positive prompt of the same scene.
const SIMPLIFIED_PROMPT =
  'Cinematic still, night. Nadia, a Black woman of 32 with long box braids and navy nursing scrubs under a faded denim jacket, shoulders through the door of a Brooklyn laundromat, a bulging black trash bag of clothes hugged to her chest, rain dripping from her hair. Behind the counter, Mr. Park, a Korean man in his early 60s with a forest-green apron, looks up. Rows of silver washers and orange chairs, fluorescent light. Vertical 9:16 portrait.'
// ---------------------------------------------------------------------------------------

async function run(label, prompt, opts = {}) {
  const input = {
    prompt,
    image_size: IMAGE_SIZE,
    num_images: 1,
    seed: opts.seed ?? FIXED_SEED,
    enable_safety_checker: opts.enableSafetyChecker ?? true,
    ...(opts.safetyTolerance ? { safety_tolerance: opts.safetyTolerance } : {}),
  }
  let res
  try {
    res = await fal.subscribe(ENDPOINT, { input, logs: false })
  } catch (err) {
    console.log(row(label, { error: err?.message?.slice(0, 80) ?? 'submit failed' }))
    return
  }
  const data = res.data ?? {}
  const img = data.images?.[0]
  let meanLum = null
  let black = null
  if (img?.url) {
    try {
      const buf = Buffer.from(await (await fetch(img.url)).arrayBuffer())
      const { channels } = await sharp(buf).stats()
      meanLum = Math.round(Math.max(...channels.slice(0, 3).map((c) => c.mean)))
      black = meanLum < 12
    } catch {
      meanLum = 'fetch/decode-failed'
    }
  }
  console.log(
    row(label, {
      words: prompt.split(/\s+/).length,
      seed: data.seed,
      nsfw: JSON.stringify(data.has_nsfw_concepts),
      dims: img ? `${img.width}x${img.height}` : 'none',
      meanLum,
      black,
      host: img?.url ? new URL(img.url).host : 'none',
      safety: input.enable_safety_checker,
    })
  )
}
function row(label, o) {
  return `${label.padEnd(30)} | ${Object.entries(o).map(([k, v]) => `${k}=${v}`).join('  ')}`
}

const cumulative = (parts) => parts.map((k) => P[k]).join('. ') + '. ' + P.format

;(async () => {
  console.log(`endpoint=${ENDPOINT} image_size=${IMAGE_SIZE} fixed_seed=${FIXED_SEED}\n`)

  await run('V0 exact-original (fixed seed)', ORIGINAL_PROMPT)
  await run('V1 exact-original (fresh seed)', ORIGINAL_PROMPT, { seed: Math.floor(Math.random() * 1e9) })
  await run('V2 simplified 60-100w', SIMPLIFIED_PROMPT)

  // Add sections back one at a time (base = framing + action + startFrame).
  const base = ['framing', 'focalAction', 'actionPhase', 'startFrame']
  const add = ['settingLock', 'nadia', 'park', 'object', 'continuity', 'avoid']
  for (let i = 0; i <= add.length; i++) {
    await run(`V3.${i} base+${add.slice(0, i).join('+') || 'none'}`.slice(0, 30), cumulative([...base, ...add.slice(0, i)]))
  }

  // Isolate darkness, and the safety checker.
  await run('V4 original − darkness', stripDarkness(ORIGINAL_PROMPT))
  await run('V5 only the SETTING LOCK line', P.settingLock + '. ' + P.format)
  await run('V6 SETTING LOCK − darkgradient', stripDarkness(P.settingLock) + '. ' + P.format)
  await run('V7 safety_checker=off', ORIGINAL_PROMPT, { enableSafetyChecker: false })
  await run('V8 safety_tolerance=6', ORIGINAL_PROMPT, { safetyTolerance: '6' })

  console.log('\nblack=true isolates the collapsing fragment. Compare V0 vs V4/V6 for the dark-lighting effect;')
  console.log('compare V5 vs V6 to see the SETTING LOCK gradient alone; V7/V8 test the safety checker.')
})()
