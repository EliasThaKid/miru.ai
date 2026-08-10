// Build the app icons from public/sticker_1.png.
//
// Build-time asset prep, like build-demo/compress-demo/stitch-hero. Committed so the icons
// can be regenerated from the source drawing rather than hand-edited in an image editor.
//
// Usage:  node scripts/make-icon.mjs [--src=public/sticker_1.png] [--threshold=225]
//
// Writes src/app/icon.png (512) and src/app/apple-icon.png (180). Next's App Router picks
// both up by filename — no <link> tags to maintain.

import sharp from 'sharp'
import { join } from 'node:path'

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const SRC = arg('src', join('public', 'sticker_1.png'))
// A pixel counts as background only if every channel is above this. The drawing's eye whites
// and tear highlights are also near-white, which is why the fill below is edge-connected
// rather than a global colour key — a key would punch holes straight through the eyes.
const THRESHOLD = Number(arg('threshold', 225))
const PAD = 0.04 // breathing room as a fraction of the square, so the art doesn't touch the edge

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: w, height: h, channels } = info
console.log(`${SRC} — ${w}x${h}`)

// Flood fill inward from every border pixel. Anything near-white that the border can reach is
// background; anything enclosed by ink survives.
const seen = new Uint8Array(w * h)
const stack = []
const isBackground = (i) => {
  const p = i * channels
  return data[p] > THRESHOLD && data[p + 1] > THRESHOLD && data[p + 2] > THRESHOLD
}
for (let x = 0; x < w; x++) {
  stack.push(x, (h - 1) * w + x)
}
for (let y = 0; y < h; y++) {
  stack.push(y * w, y * w + w - 1)
}

let cleared = 0
while (stack.length > 0) {
  const i = stack.pop()
  if (seen[i] || !isBackground(i)) continue
  seen[i] = 1
  data[i * channels + 3] = 0
  cleared++
  const x = i % w
  const y = (i / w) | 0
  if (x > 0) stack.push(i - 1)
  if (x < w - 1) stack.push(i + 1)
  if (y > 0) stack.push(i - w)
  if (y < h - 1) stack.push(i + w)
}
console.log(`cleared ${((cleared / (w * h)) * 100).toFixed(1)}% to transparent`)

// Tight bounding box of what is left, so the art fills the tab instead of floating in margin.
let minX = w
let minY = h
let maxX = -1
let maxY = -1
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * channels + 3] > 8) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}
if (maxX < 0) throw new Error('Everything was cleared — lower --threshold.')
const cropW = maxX - minX + 1
const cropH = maxY - minY + 1
console.log(`content ${cropW}x${cropH} at ${minX},${minY}`)

const trimmed = await sharp(data, { raw: { width: w, height: h, channels } })
  .extract({ left: minX, top: minY, width: cropW, height: cropH })
  .png()
  .toBuffer()

// Letterbox onto a square so a non-square crop isn't stretched.
const side = Math.round(Math.max(cropW, cropH) * (1 + PAD * 2))
const square = await sharp({
  create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    {
      input: trimmed,
      left: Math.round((side - cropW) / 2),
      top: Math.round((side - cropH) / 2),
    },
  ])
  .png()
  .toBuffer()

for (const [name, size] of [
  ['icon.png', 512],
  ['apple-icon.png', 180],
]) {
  const out = join('src', 'app', name)
  await sharp(square).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(out)
  console.log(`wrote ${out} (${size}x${size})`)
}
