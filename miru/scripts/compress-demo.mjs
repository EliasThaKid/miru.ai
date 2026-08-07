// Re-encode the demo clips for the web. Run after build-demo.mjs.
//
// fal returns 720x1280 clips at ~12 Mbps, which is roughly six times what this footage needs
// on a web page. Left alone the demo is ~72 MB — permanent weight in the repo, and every
// visitor who watches the animatic through pulls all of it.
//
// This is a BUILD-TIME step, not a runtime one. CLAUDE.md's "no FFmpeg" rule is about the
// app: playback stays a native <video> tag and nothing transcodes on a server or in a
// browser. Preparing static assets on a laptop is a different activity.
//
// Requires ffmpeg on PATH. Usage:  node scripts/compress-demo.mjs [--crf=28]

import { execFile } from 'node:child_process'
import { readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DIR = join('public', 'demo')
const CRF = process.argv.find((a) => a.startsWith('--crf='))?.split('=')[1] ?? '28'

const files = (await readdir(DIR)).filter((f) => f.endsWith('.mp4'))
if (files.length === 0) {
  console.error(`No .mp4 files in ${DIR}. Run build-demo.mjs first.`)
  process.exit(1)
}

let before = 0
let after = 0

for (const file of files) {
  const input = join(DIR, file)
  const temp = join(DIR, `.tmp-${file}`)
  const originalSize = (await stat(input)).size

  await run('ffmpeg', [
    '-y',
    '-i', input,
    '-an',                      // the animatic has no audio design; the track is dead weight
    '-c:v', 'libx264',
    '-crf', CRF,                // quality-targeted rather than bitrate-targeted
    '-preset', 'slow',          // clips are 5s, so spend the encode time
    '-pix_fmt', 'yuv420p',      // required for Safari/QuickTime playback
    '-movflags', '+faststart',  // moov atom first, so playback starts before full download
    temp,
  ])

  await unlink(input)
  await rename(temp, input)

  const newSize = (await stat(input)).size
  before += originalSize
  after += newSize
  console.log(
    `  ${file}: ${(originalSize / 1e6).toFixed(1)} → ${(newSize / 1e6).toFixed(1)} MB ` +
      `(${Math.round((1 - newSize / originalSize) * 100)}% smaller)`
  )
}

console.log(
  `\nTotal: ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} MB ` +
    `(${Math.round((1 - after / before) * 100)}% smaller)`
)
