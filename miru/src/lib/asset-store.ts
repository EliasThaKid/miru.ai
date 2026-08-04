import { randomUUID } from 'node:crypto'
import { ASSET_BUCKET, SIGNED_URL_TTL_SECONDS } from '@/lib/assets'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createClient } from '@/lib/supabase/server'

// Server-side mirroring of paid provider outputs into the user's private Storage folder.
// Only imported by 'use server' actions (it transitively pulls in next/headers), so it can
// never reach client code.
//
// Failure policy: mirroring is BEST-EFFORT and never fails a generation. The user already
// paid for the asset; if Storage is unreachable the action returns the provider URL as
// before (a project that rots later beats a generation lost now). Failures are logged.

export type AssetKind = 'still' | 'clip'

export interface MirroredAsset {
  // Freshly signed display URL. Expiring by design — `path` is the durable reference.
  url: string
  // Object path inside the `assets` bucket, persisted on the moment/transition.
  path: string
}

// Guard against pathological uploads (a provider returning something enormous). Comfortably
// above a 10s Kling clip and matched to the bucket's own limit in 0003_storage.sql.
const MAX_ASSET_BYTES = 100 * 1024 * 1024

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

function extensionFor(contentType: string | null, sourceUrl: string, kind: AssetKind): string {
  const fromType = EXTENSIONS[(contentType ?? '').split(';')[0].trim().toLowerCase()]
  if (fromType) return fromType
  // fal frequently serves assets as application/octet-stream — fall back to the URL's own
  // extension before the per-kind default.
  const fromUrl = sourceUrl.split('?')[0].split('.').pop()?.toLowerCase()
  if (fromUrl && /^[a-z0-9]{2,4}$/.test(fromUrl) && Object.values(EXTENSIONS).includes(fromUrl)) {
    return fromUrl
  }
  return kind === 'clip' ? 'mp4' : 'jpg'
}

// Moment ids and pair keys ("a->b") become part of an object path — keep them tame.
function slug(key: string): string {
  return key.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'asset'
}

// Upload bytes we already hold (the still pipeline decodes the image, so it never needs a
// second download). Returns null when mirroring isn't possible or fails.
export async function mirrorBytes(
  bytes: Buffer,
  contentType: string | null,
  kind: AssetKind,
  key: string,
  sourceUrl = ''
): Promise<MirroredAsset | null> {
  if (!isSupabaseConfigured()) return null
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) {
    console.error(`[assets] refusing to mirror ${kind} (${bytes.byteLength} bytes)`)
    return null
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const extension = extensionFor(contentType, sourceUrl, kind)
    const path = `${user.id}/${kind}/${slug(key)}-${randomUUID().slice(0, 8)}.${extension}`

    const { error: uploadError } = await supabase.storage.from(ASSET_BUCKET).upload(path, bytes, {
      contentType: contentType ?? (kind === 'clip' ? 'video/mp4' : 'image/jpeg'),
      upsert: false,
    })
    if (uploadError) throw uploadError

    const { data, error: signError } = await supabase.storage
      .from(ASSET_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (signError || !data?.signedUrl) throw signError ?? new Error('no signed url returned')

    return { url: data.signedUrl, path }
  } catch (err) {
    console.error('[assets] mirror failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// Download a provider URL and mirror it. Used for clips (and any still we didn't already
// have in memory).
export async function mirrorAsset(
  sourceUrl: string,
  kind: AssetKind,
  key: string
): Promise<MirroredAsset | null> {
  if (!isSupabaseConfigured()) return null
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null

  try {
    const res = await fetch(sourceUrl, { redirect: 'follow' })
    if (!res.ok) throw new Error(`provider host returned HTTP ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    return await mirrorBytes(bytes, res.headers.get('content-type'), kind, key, sourceUrl)
  } catch (err) {
    console.error('[assets] mirror fetch failed:', err instanceof Error ? err.message : err)
    return null
  }
}
