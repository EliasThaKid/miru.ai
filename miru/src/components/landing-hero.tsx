// Background layer for the landing page.
//
// THE VIDEO GOES HERE. Drop the file at `public/hero.mp4` (plus an optional first-frame
// `public/hero-poster.jpg`) and set HERO_VIDEO_SRC below — nothing else needs to change.
// Until then this renders a graded placeholder rather than a <video> pointing at a 404.
//
// Design notes for whatever video lands here: it sits BEHIND text, so it wants low contrast
// and slow motion. Anything with hard cuts or bright passages will fight the headline. The
// scrim below is what keeps the copy legible over an unknown clip — keep it.

const HERO_VIDEO_SRC: string | null = null // e.g. '/hero.mp4'
const HERO_POSTER_SRC: string | null = null // e.g. '/hero-poster.jpg'

export function LandingHero() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      {HERO_VIDEO_SRC ? (
        <video
          // muted + playsInline are what allow autoplay at all; loop keeps it ambient.
          autoPlay
          muted
          loop
          playsInline
          poster={HERO_POSTER_SRC ?? undefined}
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={HERO_VIDEO_SRC} type="video/mp4" />
        </video>
      ) : (
        // Placeholder: a slow diagonal wash in the app's own neutral palette, so the page
        // reads as finished rather than broken while the video is still being made.
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_15%_10%,rgba(255,255,255,0.09),transparent_55%),radial-gradient(90%_80%_at_85%_85%,rgba(255,255,255,0.05),transparent_60%)]" />
      )}

      {/* Scrim. Two layers: a global dim, and a stronger left-to-right fade under the copy.
          Without this the headline is at the mercy of whatever frame is playing. */}
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.45)_45%,rgba(0,0,0,0.15)_100%)]" />
    </div>
  )
}
