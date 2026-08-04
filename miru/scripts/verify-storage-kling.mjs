// Does Kling accept a SIGNED SUPABASE STORAGE URL as its image input?
//
// Phase 4 mirrors every paid still into a private Storage bucket and hands the app a signed
// URL. That signed URL is then what `generateMomentVideo` passes to Kling as `image_url`.
// Everything about that path is verified except the last hop: fal fetching a URL whose auth
// lives in a query string, on a host it has never seen. This script isolates that hop.
//
// I (the assistant) cannot run this — repo policy forbids me from reading FAL_KEY. You run
// it with your own key.
//
// Usage (PowerShell):
//   $env:FAL_KEY=(Get-Content .env.local | Select-String '^FAL_KEY=').ToString().Split('=',2)[1].Trim()
//   node scripts/verify-storage-kling.mjs "<signed-supabase-url>"
//
// Usage (bash):
//   export $(grep -E '^FAL_KEY=' .env.local | xargs)
//   node scripts/verify-storage-kling.mjs "<signed-supabase-url>"
//
// Get the URL: sign in, reload the project (so URLs are re-minted from storage paths), then
// copy a moment thumbnail's `src` from devtools. It must contain `/storage/v1/object/sign/`
// — a `cdn.fal.media` URL tests nothing.
//
// COST: step 1 is free. Step 2 is ONE Kling 1.6 standard 5s call against your fal account
// (app tokens are not involved — this bypasses the metering wrapper entirely).
//
// Never prints the key or the signed URL (the URL's `token` query param is a credential).

import { fal } from '@fal-ai/client'

const signedUrl = process.argv[2]

if (!signedUrl) {
  console.error('Usage: node scripts/verify-storage-kling.mjs "<signed-supabase-url>"')
  process.exit(1)
}
if (!process.env.FAL_KEY) {
  console.error('Set FAL_KEY in your environment first (never commit it).')
  process.exit(1)
}

// Redact the signature before anything is printed.
function safe(url) {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}?<token redacted>`
  } catch {
    return '<unparseable url>'
  }
}

const isSigned = signedUrl.includes('/storage/v1/object/sign/')
console.log('target:', safe(signedUrl))
if (!isSigned) {
  console.warn(
    'WARNING: this does not look like a signed Storage URL (no /storage/v1/object/sign/).\n' +
      '         A fal.media URL will pass trivially and prove nothing about Phase 4.'
  )
}

// ---------------------------------------------------------------------------------------
// Step 1 (free) — can an anonymous third party fetch it at all?
// This is the whole risk of the private-bucket design. fal is just another anonymous
// fetcher, so if this fails there is no point spending money on step 2.
// ---------------------------------------------------------------------------------------
console.log('\n[1/2] anonymous fetch (no cookies, no auth header) ...')
let res
try {
  res = await fetch(signedUrl, { redirect: 'follow' })
} catch (err) {
  console.error('FAIL — fetch threw:', err instanceof Error ? err.message : err)
  process.exit(1)
}

const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0
console.log(
  JSON.stringify({
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type'),
    bytes,
    // Browser <video>/<img> and the client-side frame extractor need this to be permissive.
    accessControlAllowOrigin: res.headers.get('access-control-allow-origin'),
  })
)

if (!res.ok || bytes === 0) {
  console.error(
    '\nFAIL at step 1 — the object is not anonymously fetchable, so Kling cannot read it either.\n' +
      'Likely causes: the signed URL expired, 0003_storage.sql was not applied, or the\n' +
      'SELECT policy is rejecting the signer.'
  )
  process.exit(1)
}
console.log('PASS — anonymously fetchable.')

// ---------------------------------------------------------------------------------------
// Step 2 (paid) — the real question. Same endpoint and params as lib/fal.ts animateMoment().
// ---------------------------------------------------------------------------------------
console.log('\n[2/2] Kling 1.6 image-to-video with the signed URL (paid, 2-5 min) ...')
fal.config({ credentials: process.env.FAL_KEY })

const t0 = Date.now()
try {
  const result = await fal.subscribe('fal-ai/kling-video/v1.6/standard/image-to-video', {
    input: {
      prompt: 'Subtle continuous motion. Begin exactly from the supplied first frame and move forward only.',
      image_url: signedUrl,
      duration: '5',
    },
    logs: false,
  })

  const url = result.data?.video?.url
  console.log(
    JSON.stringify({
      requestId: result.requestId,
      seconds: Math.round((Date.now() - t0) / 1000),
      videoPresent: !!url,
      videoHost: url ? new URL(url).host : null,
    })
  )
  if (!url) {
    console.error('\nFAIL — fal returned no video URL. Inspect the response above.')
    process.exit(1)
  }
  console.log('\nPASS — Kling fetched the signed Supabase URL and produced a clip.')
  console.log('Phase 4 is safe: mirrored stills can drive animation without re-uploading to fal.')
} catch (err) {
  console.error(`\nFAIL after ${Math.round((Date.now() - t0) / 1000)}s`)
  // The distinction that matters: a fetch/validation complaint about image_url means fal
  // could not read the signed URL (Phase 4 problem). Anything else is an unrelated failure.
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
  if (err?.body) console.error('body:', JSON.stringify(err.body, null, 2))
  if (err?.status) console.error('status:', err.status)
  process.exit(1)
}
