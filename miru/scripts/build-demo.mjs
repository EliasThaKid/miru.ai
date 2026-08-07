// Turn a saved project into the static demo that signed-out visitors see.
//
// The demo has to work with ZERO API calls and zero credentials, so every asset must be a
// local file and every provider URL must be rewritten. Provider URLs expire; that is the whole
// reason this script exists rather than just committing the JSON.
//
// Usage:
//   1. Open the app in the browser where the project lives, then in devtools:
//        copy(localStorage.getItem('scenelab:project:v3'))
//      and paste into a file, e.g. scripts/demo-source.json
//   2. node scripts/build-demo.mjs scripts/demo-source.json
//
// Writes public/demo/*.jpg|mp4 and public/demo/project.json.
//
// No credentials needed: it only fetches URLs that are already in the file. A URL that has
// expired simply fails and is reported — the asset is dropped rather than silently written as
// a broken link.
//
// SIZE MATTERS: these files get committed and shipped in the deployment. Stills are ~1-2 MB
// each and clips 2-5 MB, so a fully animated 10-moment project lands around 40 MB. Use
// --stills-only, or --max-clips=N, if that is more repo weight than you want.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [, , sourceArg, ...flags] = process.argv
const STILLS_ONLY = flags.includes('--stills-only')
const MAX_CLIPS = Number(flags.find((f) => f.startsWith('--max-clips='))?.split('=')[1] ?? Infinity)

if (!sourceArg) {
  console.error('Usage: node scripts/build-demo.mjs <exported-project.json> [--stills-only] [--max-clips=N]')
  process.exit(1)
}

const OUT_DIR = join('public', 'demo')

const project = JSON.parse(await readFile(sourceArg, 'utf8'))
await mkdir(OUT_DIR, { recursive: true })

let downloaded = 0
let failed = 0
let bytes = 0

// Fetch one asset into public/demo and return its public path, or null if it is gone.
async function pull(url, name) {
  if (!url) return null
  if (url.startsWith('/demo/')) return url // already local from a previous run
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0) throw new Error('empty response')
    await writeFile(join(OUT_DIR, name), buf)
    downloaded++
    bytes += buf.byteLength
    console.log(`  ✓ ${name} (${(buf.byteLength / 1e6).toFixed(1)} MB)`)
    return `/demo/${name}`
  } catch (err) {
    failed++
    console.warn(`  ✗ ${name} — ${err.message} (likely an expired provider URL)`)
    return null
  }
}

const pad = (n) => String(n).padStart(2, '0')
let clipsKept = 0

console.log(`\nMoments: ${project.moments?.length ?? 0}`)
for (const moment of project.moments ?? []) {
  const n = pad(moment.number)
  moment.imageUrl = await pull(moment.imageUrl, `moment-${n}.jpg`)

  const wantClip = !STILLS_ONLY && clipsKept < MAX_CLIPS
  moment.videoUrl = wantClip ? await pull(moment.videoUrl, `moment-${n}.mp4`) : null
  if (moment.videoUrl) clipsKept++

  // The end-pose still only exists to drive anchored animation, which the demo never runs.
  moment.endImageUrl = null

  // Storage paths point into a PRIVATE bucket the demo has no session for. Leaving them in
  // would make the app try to re-sign them and blank the local URLs on load.
  delete moment.imageStoragePath
  delete moment.endImageStoragePath
  delete moment.videoStoragePath
}

console.log(`Transitions: ${project.transitions?.length ?? 0}`)
for (const [i, transition] of (project.transitions ?? []).entries()) {
  const keep = !STILLS_ONLY && clipsKept < MAX_CLIPS
  transition.videoUrl = keep ? await pull(transition.videoUrl, `bridge-${pad(i + 1)}.mp4`) : null
  if (transition.videoUrl) clipsKept++
  delete transition.videoStoragePath
}

// Identity that cannot collide with a real user's project, and timestamps that don't imply
// the demo was made just now.
project.id = 'demo'
project.title = project.title?.trim() || 'Demo scene'

await writeFile(join(OUT_DIR, 'project.json'), JSON.stringify(project, null, 2))

console.log(
  `\nWrote ${OUT_DIR}/project.json` +
    `\n  downloaded: ${downloaded}   failed: ${failed}   total: ${(bytes / 1e6).toFixed(1)} MB`
)
if (failed > 0) {
  console.log(
    '\nSome assets could not be fetched. Provider URLs expire — moments without an image are\n' +
      'skipped by the app, so the demo will still load, just with gaps. Regenerate those\n' +
      'moments while signed in and re-run this script to fill them.'
  )
}
