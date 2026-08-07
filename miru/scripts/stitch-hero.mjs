// Stitch the hero clips into one seamless looping file.
//
// Doing the transitions here rather than in the browser means the runtime is a single
// <video loop> tag: no double-buffered players, no timeupdate handler racing the end of a
// clip, no black frame at a changeover, one HTTP request. Build-time work, matching how the
// demo assets are prepared — playback in the app is still a native <video> tag.
//
// Requires ffmpeg on PATH. Usage:
//   node scripts/stitch-hero.mjs                      (all hero-*.mp4, in name order)
//   node scripts/stitch-hero.mjs hero-01.mp4 hero-02.mp4
//   node scripts/stitch-hero.mjs --fade=1.2 --crf=26
//
// Writes public/hero/hero-loop.mp4.

import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DIR = join('public', 'hero')
const OUT = join(DIR, 'hero-loop.mp4')

const args = process.argv.slice(2)
const FADE = Number(args.find((a) => a.startsWith('--fade='))?.split('=')[1] ?? 1.0)
const CRF = args.find((a) => a.startsWith('--crf='))?.split('=')[1] ?? '26'
// Everything is normalised to one size and frame rate before compositing: xfade refuses to
// join streams whose dimensions, rate, or pixel aspect differ, and there is no guarantee the
// provider returns them identical.
const W = 1280
const H = 720
const FPS = 30

const named = args.filter((a) => !a.startsWith('--'))
const inputs =
  named.length > 0
    ? named
    : (await readdir(DIR)).filter((f) => /^hero-\d+\.mp4$/.test(f)).sort()

if (inputs.length === 0) {
  console.error(`No hero-NN.mp4 files in ${DIR}. Run generate-hero.mjs first.`)
  process.exit(1)
}
console.log(`Stitching ${inputs.length} clip(s): ${inputs.join(', ')}\n`)

async function duration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    join(DIR, file),
  ])
  return Number.parseFloat(stdout.trim())
}

const durations = []
for (const file of inputs) durations.push(await duration(file))
durations.forEach((d, i) => console.log(`  ${inputs[i]}  ${d.toFixed(2)}s`))

// Normalise every input, then chain xfades. Each transition's offset is measured from the
// start of the accumulated timeline, and every crossfade overlaps the clips, so the running
// total loses one FADE per join.
const filters = inputs.map(
  (_, i) =>
    `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `crop=${W}:${H},fps=${FPS},format=yuv420p,setsar=1[v${i}]`
)

let chain = '[v0]'
let elapsed = durations[0]
for (let i = 1; i < inputs.length; i++) {
  const offset = (elapsed - FADE).toFixed(3)
  const out = i === inputs.length - 1 ? 'xf' : `x${i}`
  filters.push(`${chain}[v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset}[${out}]`)
  chain = `[${out}]`
  elapsed = elapsed + durations[i] - FADE
}

// Single clip: nothing to cross-fade, just normalise it.
if (inputs.length === 1) filters.push('[v0]null[xf]')

// Dip to black at both ends. This is what makes the LOOP seamless: the join is black-to-black
// rather than a hard cut back to a different composition. The footage is already very dark, so
// it reads as intentional rather than as a fade.
const fadeOutStart = Math.max(elapsed - FADE, 0).toFixed(3)
filters.push(
  `[xf]fade=t=in:st=0:d=${FADE},fade=t=out:st=${fadeOutStart}:d=${FADE}[out]`
)

console.log(`\nOutput length: ${elapsed.toFixed(2)}s`)

await run('ffmpeg', [
  '-y',
  ...inputs.flatMap((f) => ['-i', join(DIR, f)]),
  '-filter_complex', filters.join(';'),
  '-map', '[out]',
  '-an',                      // no audio anywhere in the hero
  '-c:v', 'libx264',
  '-crf', CRF,
  '-preset', 'slow',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',  // start playing before the whole file arrives
  OUT,
])

const { size } = await stat(OUT)
console.log(`\nWrote ${OUT} — ${(size / 1e6).toFixed(1)} MB`)
console.log("Set HERO_VIDEO in src/components/landing-hero.tsx to '/hero/hero-loop.mp4'.")
