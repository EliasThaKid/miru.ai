// Generate the landing-page hero clips with the same models the product uses.
//
// I (the assistant) cannot run this — repo policy forbids me from reading FAL_KEY. You run it.
//
// Usage (PowerShell):
//   $env:FAL_KEY=(Get-Content .env.local | Select-String '^FAL_KEY=').ToString().Split('=',2)[1].Trim()
//   node scripts/generate-hero.mjs
//
// Optional: node scripts/generate-hero.mjs --only=2   (regenerate just concept 2)
//           node scripts/generate-hero.mjs --stills   (stills only, ~$0.12, no clips)
//
// COST: ~$0.04 per still + ~$0.40 per clip on your fal account. All three concepts ≈ $1.35.
//
// LANDSCAPE ON PURPOSE. The app renders portrait_16_9 everywhere; a full-bleed page header
// needs the opposite. That makes this run double as the 16:9 validation the aspect-ratio
// toggle is waiting on — if these come back well composed, FLUX handles landscape with our
// prompt style, and Kling animating from a landscape frame is confirmed too.
//
// Writes public/hero/hero-0N.jpg and hero-0N.mp4. Run scripts/compress-demo.mjs afterwards
// (point it at public/hero) or the clips will be ~12 Mbps and far too heavy to ship.

import { fal } from '@fal-ai/client'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

if (!process.env.FAL_KEY) {
  console.error('Set FAL_KEY in your environment first (never commit it).')
  process.exit(1)
}
fal.config({ credentials: process.env.FAL_KEY })

const flags = process.argv.slice(2)
const ONLY = Number(flags.find((f) => f.startsWith('--only='))?.split('=')[1] ?? 0)
const STILLS_ONLY = flags.includes('--stills')
const OUT = join('public', 'hero')

// Written against the constraints this footage actually has to satisfy, not "make it cool":
//
//  * It sits BEHIND white text, so it must be dark, low contrast, and quiet in the left third
//    where the headline lands. Bright or busy footage there makes the copy unreadable.
//  * The site is the Dark Editing Studio direction — neutral OKLCH grayscale, no colour.
//    Anything with a colour cast will fight every other surface in the product.
//  * It loops, so the motion must be slow and directionless enough that the wrap is invisible.
//    Anything with a clear beginning and end will visibly snap.
//  * No people. A recognisable face in a loop behind marketing copy is a licensing and
//    likeness problem, and it pulls focus from the words.
const STYLE =
  'monochrome, desaturated to near black-and-white, cinematic, deep shadow, soft volumetric ' +
  'haze, fine film grain, low contrast, shallow depth of field, subdued practical lighting, ' +
  'no text, no logos, no people'

const CONCEPTS = [
  {
    name: 'contact sheet',
    still:
      `${STYLE}. A dark studio wall covered in a grid of small pinned storyboard frames, ` +
      'paper edges catching a raking light from the right, the left half of the wall falling ' +
      'away into shadow, dust suspended in the air, shot on a long lens',
    motion:
      'Begin exactly from the supplied first frame and move forward only. An extremely slow ' +
      'lateral camera drift to the right, dust motes drifting gently, the raking light easing ' +
      'almost imperceptibly across the paper. Nothing enters or leaves frame.',
  },
  {
    name: 'projector beam',
    still:
      `${STYLE}. A single shaft of projector light cutting through a pitch-dark room, thick ` +
      'with slow-moving dust, the beam entering from the upper right and falling on an empty ' +
      'pale wall, the left of the frame almost entirely black',
    motion:
      'Begin exactly from the supplied first frame and move forward only. Dust drifts slowly ' +
      'through the beam, the light flickers very faintly as if from a running projector, the ' +
      'camera holds almost perfectly still. No cuts, no sudden changes in brightness.',
  },
  {
    name: 'editing desk',
    still:
      `${STYLE}. A night-time editing desk seen from across a dark room, two monitors glowing ` +
      'softly and completely out of focus in the right of the frame, an empty chair, the left ' +
      'of the frame deep shadow, warmth only from the monitor glow, heavy bokeh',
    motion:
      'Begin exactly from the supplied first frame and move forward only. An extremely slow ' +
      'push in toward the desk, the out-of-focus monitor glow shifting gently. The room stays ' +
      'still and empty.',
  },
]

await mkdir(OUT, { recursive: true })

for (const [i, concept] of CONCEPTS.entries()) {
  const n = i + 1
  if (ONLY && ONLY !== n) continue

  const tag = String(n).padStart(2, '0')
  console.log(`\n[${n}/${CONCEPTS.length}] ${concept.name}`)

  // ---- still (FLUX, landscape) ----
  process.stdout.write('  still … ')
  const still = await fal.subscribe('fal-ai/flux-pro/v1.1', {
    input: {
      prompt: concept.still,
      image_size: 'landscape_16_9', // the app uses portrait_16_9; this is the inverse
      num_images: 1,
      safety_tolerance: '5', // same false-positive guard as lib/fal.ts
    },
    logs: false,
  })
  const stillUrl = still.data?.images?.[0]?.url
  if (!stillUrl) {
    console.error('FAILED — no image returned. Response keys:', Object.keys(still.data ?? {}))
    continue
  }
  await save(stillUrl, `hero-${tag}.jpg`)

  if (STILLS_ONLY) continue

  // ---- clip (Kling 1.6 from the landscape still) ----
  process.stdout.write('  clip (2-5 min) … ')
  const t0 = Date.now()
  const clip = await fal.subscribe('fal-ai/kling-video/v1.6/standard/image-to-video', {
    input: { prompt: concept.motion, image_url: stillUrl, duration: '5' },
    logs: false,
  })
  const clipUrl = clip.data?.video?.url
  if (!clipUrl) {
    console.error('FAILED — no video returned.')
    continue
  }
  console.log(`${Math.round((Date.now() - t0) / 1000)}s`)
  await save(clipUrl, `hero-${tag}.mp4`)
}

async function save(url, name) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(join(OUT, name), buf)
  console.log(`  saved ${name} (${(buf.byteLength / 1e6).toFixed(1)} MB)`)
}

console.log(
  '\nNext:\n' +
    '  1. Look at public/hero/*.jpg first — if a composition is wrong, rerun that one with\n' +
    '     --only=N before paying for its clip.\n' +
    '  2. node scripts/compress-demo.mjs --dir=public/hero   (raw clips are ~12 Mbps)\n' +
    '  3. Set HERO_VIDEOS in src/components/landing-hero.tsx to the clips you kept.'
)
