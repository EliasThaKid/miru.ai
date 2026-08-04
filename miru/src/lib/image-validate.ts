// Server-only asset validation. DECODE is the sole authority for "is this a valid image":
// we never reject on the content-type header (fal/CDN assets are frequently served as
// application/octet-stream or with no type) and never on brightness (a dark cinematic frame
// is valid). Hard failures are evidence-based ONLY: missing URL, fetch failure / non-OK
// status, undecodable bytes, or zero dimensions. A suspiciously uniform/near-black frame is
// flagged for manual review, not rejected. Uses `sharp` (already a Next dependency).

export type RenderStage = 'compose' | 'submit' | 'provider' | 'asset-fetch' | 'asset-decode' | 'persist' | 'display'

// Carries the exact pipeline stage a failure occurred at, so the UI/logs can report it.
export class AssetError extends Error {
  readonly stage: RenderStage
  constructor(stage: RenderStage, message: string) {
    super(message)
    this.name = 'AssetError'
    this.stage = stage
  }
}

export interface ImageAssetInfo {
  contentType: string | null
  bytes: number
  // The fetched bytes, kept so a caller that needs to persist the asset (Storage mirroring)
  // doesn't have to download it a second time. Never log or spread this into diagnostics.
  buffer: Buffer
  width: number
  height: number
  format: string | undefined
  // Suspiciously dark / near-constant frame — a soft flag for manual review, NEVER a hard
  // failure. Real dark cinematic frames have grain/variation and are not flagged.
  uniform: boolean
}

// Decode bytes → dimensions + a soft `uniform` flag. Throws ONLY on empty / undecodable /
// zero-dimension data. sharp supports JPEG, PNG and WebP; `failOn: 'none'` tolerates minor
// corruption so a slightly-truncated but decodable frame is not falsely rejected.
export async function decodeImage(
  buffer: Buffer
): Promise<Omit<ImageAssetInfo, 'contentType' | 'bytes' | 'buffer'>> {
  if (!buffer || buffer.byteLength === 0) {
    throw new AssetError('asset-decode', 'asset was empty (zero bytes)')
  }
  const sharp = (await import('sharp')).default
  let width: number | undefined
  let height: number | undefined
  let format: string | undefined
  let maxMean = 255
  let maxStdev = 255
  try {
    const img = sharp(buffer, { failOn: 'none' })
    const meta = await img.metadata()
    const stats = await img.stats()
    width = meta.width
    height = meta.height
    format = meta.format
    const rgb = stats.channels.slice(0, 3)
    maxMean = Math.max(...rgb.map((c) => c.mean))
    maxStdev = Math.max(...rgb.map((c) => c.stdev))
  } catch (err) {
    throw new AssetError('asset-decode', `could not decode image (${err instanceof Error ? err.message : 'unknown'})`)
  }
  if (!width || !height) {
    throw new AssetError('asset-decode', 'decoded image has zero dimensions')
  }
  // Near-constant black frame only. This does NOT reject — it is a review flag.
  const uniform = maxMean < 4 && maxStdev < 2
  return { width, height, format, uniform }
}

// Fetch the provider URL and decode it. content-type is captured for diagnostics but NEVER
// used to accept/reject. Redirects (signed-URL indirection) are followed.
export async function fetchAndDecodeImage(url: string): Promise<ImageAssetInfo> {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new AssetError('asset-fetch', 'missing or invalid image URL')
  }
  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch (err) {
    throw new AssetError('asset-fetch', `fetch failed (${err instanceof Error ? err.message : 'unknown'})`)
  }
  if (!res.ok) {
    throw new AssetError('asset-fetch', `image host returned HTTP ${res.status}`)
  }
  const contentType = res.headers.get('content-type')
  const buffer = Buffer.from(await res.arrayBuffer())
  const decoded = await decodeImage(buffer)
  return { contentType, bytes: buffer.byteLength, buffer, ...decoded }
}
