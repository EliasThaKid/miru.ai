// Background layer for the landing page.
//
// TO TURN IT ON:
//   node scripts/generate-hero.mjs      → public/hero/hero-0N.jpg + .mp4
//   node scripts/stitch-hero.mjs        → public/hero/hero-loop.mp4 (crossfades baked in)
// then set HERO_VIDEO below.
//
// The transitions between concepts are composited by ffmpeg at build time, so playback here
// is one plain <video loop>. An earlier version double-buffered two players and crossfaded
// them with a timeupdate handler; the stitched file does the same job with no JS, no seam,
// and one request. Server component — nothing about this needs to run on the client.
// 1280x720, 13.3s, ~0.5 MB — three concepts crossfaded, dipping to black at both ends so the
// loop point is invisible.
const HERO_VIDEO: string | null = '/hero/hero-loop.mp4'

// Deliberately no poster. The stitched loop opens on black — that fade is what hides the loop
// point — so a poster of the first composition would flash bright, cut to black, then fade
// back up. The graded wash underneath covers the buffering moment instead.
const HERO_POSTER: string | null = null

export function LandingHero() {
  return (
    <>
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        {/* Always rendered, UNDER the video. A clip that is missing, still uploading, or
            blocked by autoplay policy leaves an empty element, so this shows through instead
            of black — the page degrades to a graded wash rather than to a hole. */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_15%_10%,rgba(255,255,255,0.09),transparent_55%),radial-gradient(90%_80%_at_85%_85%,rgba(255,255,255,0.05),transparent_60%)]" />

        {HERO_VIDEO ? (
          <video
            // muted + playsInline are what allow autoplay at all; without them mobile Safari
            // and Chrome both refuse and the hero is a frozen poster.
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster={HERO_POSTER ?? undefined}
            className="absolute inset-0 h-full w-full object-cover"
          >
            <source src={HERO_VIDEO} type="video/mp4" />
          </video>
        ) : null}

        {/* Scrim. Two layers: a global dim, and a stronger left-to-right fade under the copy.
            Without this the headline is at the mercy of whatever frame is playing. */}
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.45)_45%,rgba(0,0,0,0.15)_100%)]" />
      </div>
    </>
  )
}

// Attribution for the generated footage. Lives in the page's footer row rather than pinned to
// the viewport corner: absolutely positioned, it sat on top of the legal links as soon as the
// viewport got short or narrow enough for them to wrap. In the flow it just wraps too.
//
// Rendered only when there IS generated footage — the claim has to be true — which is why it
// ships from this file, next to the flag it depends on.
export function HeroAttribution() {
  if (!HERO_VIDEO) return null
  return <p className="text-[12px] text-[var(--text-tertiary)]">Header generated with SceneLab</p>
}
