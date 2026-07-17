'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Project } from '@/types'

// How the next timeline entry enters the stage. 'cut' swaps instantly; 'dissolve'
// crossfades over the previous entry; 'fade' passes through black between entries.
type EnterEffect = 'cut' | 'dissolve' | 'fade'

interface TimelineEntry {
  key: string
  src: string
  // 'video' plays its natural clip length; 'image' holds (with Ken Burns) for durationMs.
  kind: 'video' | 'image'
  durationMs: number
  enter: EnterEffect
  label: string
}

const DISSOLVE_MS = 600
const FADE_MS = 450

// Flattens moments + connections into a play sequence. Moments without images are skipped
// (nothing to show). Generated bridges play between their pair; dissolve/fade become the
// next entry's enter effect; hard cut (including absent records) is an instant swap.
function buildTimeline(project: Project): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const visible = project.moments.filter((m) => m.imageUrl)

  visible.forEach((moment, i) => {
    const prev = visible[i - 1]
    let enter: EnterEffect = 'cut'

    if (prev) {
      const connection = project.transitions.find(
        (t) => t.fromMomentId === prev.id && t.toMomentId === moment.id
      )
      const mode = connection?.mode ?? 'hard-cut'

      if (mode === 'generated-bridge' && connection?.videoUrl) {
        entries.push({
          key: `bridge-${connection.id}`,
          src: connection.videoUrl,
          kind: 'video',
          durationMs: 5000,
          enter: 'cut',
          label: `Bridge → Moment ${moment.number}`,
        })
      } else if (mode === 'dissolve') {
        enter = 'dissolve'
      } else if (mode === 'fade-to-black') {
        enter = 'fade'
      }
    }

    entries.push(
      moment.videoUrl
        ? {
            key: `moment-${moment.id}`,
            src: moment.videoUrl,
            kind: 'video',
            durationMs: 5000,
            enter,
            label: `Moment ${moment.number}`,
          }
        : {
            key: `moment-${moment.id}`,
            src: moment.imageUrl as string,
            kind: 'image',
            durationMs: moment.durationSeconds * 1000,
            enter,
            label: `Moment ${moment.number}`,
          }
    )
  })

  return entries
}

interface AnimaticPlayerProps {
  project: Project
  onClose: () => void
}

export function AnimaticPlayer({ project, onClose }: AnimaticPlayerProps) {
  const [timeline] = useState(() => buildTimeline(project))
  const [index, setIndex] = useState(0)
  const [prevIndex, setPrevIndex] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(true)
  const [blackOverlay, setBlackOverlay] = useState(false)
  const [finished, setFinished] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const indexRef = useRef(0)
  // Remaining hold time for image entries so pause/resume doesn't restart the hold.
  const remainingRef = useRef(0)
  const startedAtRef = useRef(0)

  // Entering an entry applies its enter effect; state updaters stay pure (StrictMode-safe).
  const goTo = useCallback(
    (next: number) => {
      const entry = timeline[next]
      if (!entry) return
      if (entry.enter === 'dissolve' && next > 0) {
        setPrevIndex(indexRef.current)
        window.setTimeout(() => setPrevIndex(null), DISSOLVE_MS)
      } else if (entry.enter === 'fade') {
        setBlackOverlay(true)
        window.setTimeout(() => setBlackOverlay(false), FADE_MS * 2)
      }
      indexRef.current = next
      setIndex(next)
    },
    [timeline]
  )

  const advance = useCallback(() => {
    if (indexRef.current >= timeline.length - 1) {
      setIsPlaying(false)
      setFinished(true)
    } else {
      goTo(indexRef.current + 1)
    }
  }, [timeline, goTo])

  // Reset the hold budget whenever the entry changes. Declared before the timer effect so
  // it runs first on index change.
  useEffect(() => {
    remainingRef.current = timeline[index]?.durationMs ?? 0
  }, [index, timeline])

  // Single owner of the image-hold timer; its cleanup banks the elapsed time, which makes
  // pause/resume — and StrictMode's dev-only double effect run — behave correctly.
  // Video entries advance on their own 'ended' event instead.
  useEffect(() => {
    const entry = timeline[index]
    if (!entry || finished || entry.kind !== 'image' || !isPlaying) return

    startedAtRef.current = Date.now()
    const timer = setTimeout(advance, remainingRef.current)
    return () => {
      clearTimeout(timer)
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
    }
  }, [index, isPlaying, finished, timeline, advance])

  // Video pause/resume.
  useEffect(() => {
    const entry = timeline[index]
    if (!entry || entry.kind !== 'video') return
    if (isPlaying) videoRef.current?.play().catch(() => {})
    else videoRef.current?.pause()
  }, [index, isPlaying, timeline])

  function restart() {
    setPrevIndex(null)
    setBlackOverlay(false)
    setFinished(false)
    indexRef.current = 0
    setIndex(0)
    setIsPlaying(true)
  }

  if (timeline.length === 0) return null
  const entry = timeline[index]
  const prevEntry = prevIndex !== null ? timeline[prevIndex] : null

  const renderEntry = (e: TimelineEntry, opts: { active: boolean }) =>
    e.kind === 'video' ? (
      <video
        key={e.key}
        ref={opts.active ? videoRef : undefined}
        src={e.src}
        autoPlay={opts.active && isPlaying}
        muted
        playsInline
        onEnded={opts.active ? advance : undefined}
        className="absolute inset-0 h-full w-full object-cover"
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={e.key}
        src={e.src}
        alt={e.label}
        className="animatic-kenburns absolute inset-0 h-full w-full object-cover"
        style={{
          animationDuration: `${e.durationMs}ms`,
          animationPlayState: opts.active && isPlaying ? 'running' : 'paused',
        }}
      />
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto aspect-9/16 w-full max-w-sm overflow-hidden rounded-2xl bg-black">
        {prevEntry ? renderEntry(prevEntry, { active: false }) : null}
        <div
          key={entry.key}
          className="absolute inset-0"
          style={
            entry.enter === 'dissolve' && prevEntry
              ? { animation: `animatic-fade-in ${DISSOLVE_MS}ms ease-in-out both` }
              : undefined
          }
        >
          {renderEntry(entry, { active: true })}
        </div>
        <div
          className="pointer-events-none absolute inset-0 bg-black transition-opacity"
          style={{ opacity: blackOverlay ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
        />
      </div>

      <div className="mx-auto flex w-full max-w-sm items-center gap-2">
        <Button size="sm" onClick={() => (finished ? restart() : setIsPlaying((p) => !p))}>
          {finished ? 'Replay' : isPlaying ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="outline" onClick={restart}>
          Restart
        </Button>
        <p className="flex-1 text-center text-xs text-muted-foreground">
          {entry.label} · {index + 1}/{timeline.length}
        </p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
