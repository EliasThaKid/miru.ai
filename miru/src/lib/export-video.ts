// Client-only: records the animatic sequence into a single WebM file entirely in the browser
// (no FFmpeg, no server — per the repo's video-architecture rule). It draws each timeline
// entry onto a canvas in real time and captures canvas.captureStream() with MediaRecorder.
// fal.media serves cross-origin-readable assets, so drawing its clips/images to canvas does
// not taint it (same basis as lib/extract-frame.ts).

import { buildTimeline, DISSOLVE_MS, FADE_MS, type TimelineEntry } from '@/lib/animatic-timeline'
import type { Project } from '@/types'

const WIDTH = 720
const HEIGHT = 1280
const FPS = 30
const VIDEO_CAP_MS = 12000 // safety cap so a clip that never fires 'ended' can't hang the export

type Ctx = CanvasRenderingContext2D

function supported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof document.createElement('canvas').captureStream === 'function'
  )
}

// MP4 first, WebM as the fallback.
//
// MP4/H.264 is what editing software, phones, and social platforms actually accept, so it is
// preferred wherever the browser can record it (Safari, and Chrome from v130). Support is
// genuinely browser-dependent and cannot be polyfilled here — CLAUDE.md rules out FFmpeg and
// server-side video — so this feature-detects rather than promising a format it can't deliver.
// The file extension follows the real recording type; a .mp4 container holding WebM would be
// worse than an honest .webm.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=h264',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const

function pickMimeType(): string {
  for (const t of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

// Container type and extension derived from whatever the recorder actually accepted.
function containerFor(mimeType: string): { type: string; extension: string } {
  return mimeType.startsWith('video/mp4')
    ? { type: 'video/mp4', extension: 'mp4' }
    : { type: 'video/webm', extension: 'webm' }
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.onloadeddata = () => resolve(v)
    v.onerror = () => reject(new Error('Could not load a clip for export (the host may block cross-origin reads).'))
    v.src = src
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load a frame for export.'))
    img.src = src
  })
}

// Cover-fit draw (fills 9:16, centre-cropped) with optional Ken Burns zoom and alpha.
function drawCover(
  ctx: Ctx,
  media: CanvasImageSource,
  mw: number,
  mh: number,
  opts: { alpha?: number; zoom?: number } = {}
) {
  const scale = Math.max(WIDTH / mw, HEIGHT / mh) * (opts.zoom ?? 1)
  const dw = mw * scale
  const dh = mh * scale
  ctx.globalAlpha = opts.alpha ?? 1
  ctx.drawImage(media, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh)
  ctx.globalAlpha = 1
}

function snapshot(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = canvas.width
  c.height = canvas.height
  c.getContext('2d')!.drawImage(canvas, 0, 0)
  return c
}

// Drive one entry's playback (video → until 'ended'/cap; image → hold with Ken Burns),
// drawing every animation frame to the canvas. Applies a dissolve crossfade over the
// previous frame at the entry's start when requested.
function playEntry(
  ctx: Ctx,
  entry: TimelineEntry,
  media: HTMLVideoElement | HTMLImageElement,
  mw: number,
  mh: number,
  prevFrame: HTMLCanvasElement | null,
  onLocal: (ms: number) => void
): Promise<void> {
  const isVideo = entry.kind === 'video'
  if (isVideo) (media as HTMLVideoElement).play().catch(() => {})
  const start = performance.now()

  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    if (isVideo) (media as HTMLVideoElement).onended = finish

    const loop = () => {
      if (done) return
      const t = performance.now() - start
      const dissolving = entry.enter === 'dissolve' && prevFrame && t < DISSOLVE_MS
      if (dissolving) ctx.drawImage(prevFrame as HTMLCanvasElement, 0, 0)
      const zoom = isVideo ? 1 : 1.04 + 0.08 * Math.min(1, t / entry.durationMs)
      drawCover(ctx, media, mw, mh, { zoom, alpha: dissolving ? t / DISSOLVE_MS : 1 })
      onLocal(t)

      if (isVideo) {
        if (t >= VIDEO_CAP_MS) return finish()
      } else if (t >= entry.durationMs) {
        return finish()
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
}

// Fade the current canvas out to black over FADE_MS (the 'fade-to-black' connection).
function fadeToBlack(ctx: Ctx, canvas: HTMLCanvasElement): Promise<void> {
  const prev = snapshot(canvas)
  const start = performance.now()
  return new Promise<void>((resolve) => {
    const loop = () => {
      const t = Math.min(FADE_MS, performance.now() - start)
      ctx.drawImage(prev, 0, 0)
      ctx.globalAlpha = t / FADE_MS
      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
      ctx.globalAlpha = 1
      if (t >= FADE_MS) {
        ctx.fillStyle = 'black'
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        return resolve()
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
}

function baseName(project: Project): string {
  return (project.title?.trim() || 'scenelab').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'scenelab'
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Records the whole sequence to a single .webm and triggers its download. `onProgress`
// receives 0..1. Runs in real time (playback speed) — the trade-off of a pure-browser export.
export async function exportSequenceVideo(project: Project, onProgress?: (fraction: number) => void): Promise<void> {
  const timeline = buildTimeline(project)
  if (timeline.length === 0) {
    throw new Error('Render or animate at least one moment before exporting a video.')
  }
  if (!supported()) {
    throw new Error('Your browser can’t record video in-page. Try the latest Chrome or Firefox.')
  }
  const mimeType = pickMimeType()
  if (!mimeType) {
    throw new Error('Your browser can’t record WebM video. Try the latest Chrome or Firefox.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const stream = canvas.captureStream(FPS)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const stopped = new Promise<void>((res) => {
    recorder.onstop = () => res()
  })
  recorder.start()

  const totalMs = timeline.reduce((sum, e) => sum + e.durationMs, 0)
  let elapsedBase = 0
  let prevFrame: HTMLCanvasElement | null = null

  try {
    for (const entry of timeline) {
      if (entry.enter === 'fade' && elapsedBase > 0) {
        await fadeToBlack(ctx, canvas)
      }
      let media: HTMLVideoElement | HTMLImageElement
      let mw: number
      let mh: number
      if (entry.kind === 'video') {
        const v = await loadVideo(entry.src)
        media = v
        mw = v.videoWidth || WIDTH
        mh = v.videoHeight || HEIGHT
      } else {
        const img = await loadImage(entry.src)
        media = img
        mw = img.naturalWidth || WIDTH
        mh = img.naturalHeight || HEIGHT
      }

      await playEntry(ctx, entry, media, mw, mh, prevFrame, (localMs) => {
        onProgress?.(Math.min(0.99, (elapsedBase + localMs) / totalMs))
      })

      if (media instanceof HTMLVideoElement) {
        media.pause()
        media.removeAttribute('src')
        media.load()
      }
      elapsedBase += entry.durationMs
      prevFrame = snapshot(canvas)
    }
  } finally {
    recorder.stop()
  }

  await stopped
  onProgress?.(1)
  const container = containerFor(mimeType)
  triggerDownload(
    new Blob(chunks, { type: container.type }),
    `${baseName(project)}-animatic.${container.extension}`
  )
}
