'use client'

import { useEffect, useRef, useState } from 'react'

// Background layer for the landing page.
//
// TO TURN IT ON: run `node scripts/generate-hero.mjs`, compress the output
// (`node scripts/compress-demo.mjs --dir=public/hero`), then list the clips you kept here.
// An empty array renders the graded placeholder instead — never a <video> pointing at a 404.
const HERO_VIDEOS: string[] = [
  // '/hero/hero-01.mp4',
  // '/hero/hero-02.mp4',
  // '/hero/hero-03.mp4',
]

// Shown before the first clip has buffered, so the page never flashes empty. Set this to the
// still that matches HERO_VIDEOS[0] (generate-hero.mjs writes hero-0N.jpg beside each clip).
const HERO_POSTER: string | null = null // e.g. '/hero/hero-01.jpg'

const FADE_MS = 1200

export function LandingHero() {
  // Two stacked players: one visible, one preloading the next clip. Crossfading between them
  // is what hides the seam — a single <video> swapping its src shows a black frame at every
  // changeover, which is exactly the thing that makes a hero loop look cheap.
  const [front, setFront] = useState(0)
  const [showBack, setShowBack] = useState(false)
  const frontRef = useRef<HTMLVideoElement>(null)
  const backRef = useRef<HTMLVideoElement>(null)

  const multiple = HERO_VIDEOS.length > 1
  const backIndex = (front + 1) % Math.max(HERO_VIDEOS.length, 1)

  useEffect(() => {
    if (!multiple) return
    const visible = showBack ? backRef.current : frontRef.current
    const hidden = showBack ? frontRef.current : backRef.current
    if (!visible || !hidden) return

    // Start the crossfade slightly before the visible clip ends, so the incoming one is
    // already moving when it becomes visible.
    function onTimeUpdate() {
      if (!visible) return
      const remaining = visible.duration - visible.currentTime
      if (Number.isFinite(remaining) && remaining <= FADE_MS / 1000) {
        void hidden?.play().catch(() => {})
        setShowBack((s) => !s)
        setFront((f) => (f + 1) % HERO_VIDEOS.length)
      }
    }

    visible.addEventListener('timeupdate', onTimeUpdate)
    return () => visible.removeEventListener('timeupdate', onTimeUpdate)
  }, [front, showBack, multiple])

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      {HERO_VIDEOS.length === 0 ? (
        // Placeholder: a slow diagonal wash in the app's own neutral palette, so the page
        // reads as finished rather than broken while the clips are still being made.
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_15%_10%,rgba(255,255,255,0.09),transparent_55%),radial-gradient(90%_80%_at_85%_85%,rgba(255,255,255,0.05),transparent_60%)]" />
      ) : (
        <>
          <Player
            ref={frontRef}
            src={HERO_VIDEOS[front]}
            poster={HERO_POSTER}
            visible={!showBack}
            loop={!multiple}
          />
          {multiple ? (
            <Player ref={backRef} src={HERO_VIDEOS[backIndex]} poster={null} visible={showBack} loop={false} />
          ) : null}
        </>
      )}

      {/* Scrim. Two layers: a global dim, and a stronger left-to-right fade under the copy.
          Without this the headline is at the mercy of whatever frame is playing. */}
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.45)_45%,rgba(0,0,0,0.15)_100%)]" />
    </div>
  )
}

function Player({
  ref,
  src,
  poster,
  visible,
  loop,
}: {
  ref: React.RefObject<HTMLVideoElement | null>
  src: string
  poster: string | null
  visible: boolean
  loop: boolean
}) {
  return (
    <video
      ref={ref}
      // muted + playsInline are what allow autoplay at all; without them mobile Safari and
      // Chrome both refuse and the hero is a frozen poster.
      autoPlay
      muted
      loop={loop}
      playsInline
      preload="auto"
      poster={poster ?? undefined}
      className="absolute inset-0 h-full w-full object-cover transition-opacity ease-linear"
      style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
    >
      <source src={src} type="video/mp4" />
    </video>
  )
}
