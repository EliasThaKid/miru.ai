import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetError, decodeImage, fetchAndDecodeImage } from '@/lib/image-validate'

async function varied(format: 'png' | 'jpeg' | 'webp' = 'png'): Promise<Buffer> {
  const w = 128
  const h = 128
  const raw = Buffer.alloc(w * h * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })[format]().toBuffer()
}
async function black(): Promise<Buffer> {
  return sharp({ create: { width: 128, height: 128, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
}
function mockFetch(status: number, contentType: string | null, body: Buffer) {
  vi.stubGlobal('fetch', async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('decodeImage — decode is the sole authority', () => {
  it('throws (asset-decode) on empty bytes', async () => {
    await expect(decodeImage(Buffer.alloc(0))).rejects.toBeInstanceOf(AssetError)
    await expect(decodeImage(Buffer.alloc(0))).rejects.toThrow(/empty/i)
  })
  it('throws (asset-decode) on undecodable bytes', async () => {
    await expect(decodeImage(Buffer.from('this is an HTML error page, not an image'))).rejects.toThrow(/decode/i)
  })
  it('decodes PNG, JPEG and WebP', async () => {
    for (const fmt of ['png', 'jpeg', 'webp'] as const) {
      const info = await decodeImage(await varied(fmt))
      expect(info.width).toBe(128)
      expect(info.height).toBe(128)
      expect(info.format).toBe(fmt)
      expect(info.uniform).toBe(false)
    }
  })
  it('does NOT reject a black/near-uniform frame — flags it instead', async () => {
    const info = await decodeImage(await black())
    expect(info.width).toBe(128)
    expect(info.uniform).toBe(true) // soft flag, no throw
  })
})

describe('fetchAndDecodeImage — content-type is diagnostic only', () => {
  it('accepts a valid image served as application/octet-stream (CDN behavior)', async () => {
    mockFetch(200, 'application/octet-stream', await varied('jpeg'))
    const info = await fetchAndDecodeImage('https://cdn.fal.media/x.jpg')
    expect(info.width).toBe(128)
    expect(info.contentType).toBe('application/octet-stream')
    expect(info.bytes).toBeGreaterThan(0)
  })
  it('accepts a valid image served with NO content-type header', async () => {
    mockFetch(200, null, await varied('png'))
    const info = await fetchAndDecodeImage('https://cdn.fal.media/y')
    expect(info.width).toBe(128)
  })
  it('rejects an HTML error page (fails at decode, not the header)', async () => {
    mockFetch(200, 'text/html', Buffer.from('<html>403 Forbidden</html>'))
    await expect(fetchAndDecodeImage('https://cdn.fal.media/err')).rejects.toThrow(/decode/i)
  })
  it('fails at asset-fetch on a non-OK status, preserving the status', async () => {
    mockFetch(403, 'text/plain', Buffer.from('nope'))
    const err = await fetchAndDecodeImage('https://cdn.fal.media/z').catch((e) => e)
    expect(err).toBeInstanceOf(AssetError)
    expect(err.stage).toBe('asset-fetch')
    expect(err.message).toMatch(/403/)
  })
  it('fails at asset-fetch on a missing/invalid URL', async () => {
    const err = await fetchAndDecodeImage('').catch((e) => e)
    expect(err).toBeInstanceOf(AssetError)
    expect(err.stage).toBe('asset-fetch')
  })
})
