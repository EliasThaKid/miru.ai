import Link from 'next/link'
import { HeroAttribution, LandingHero } from '@/components/landing-hero'

// Front door. Static and server-rendered — no Supabase, no client work — so it stays fast and
// renders identically for a signed-out visitor and a search crawler. The app itself lives at
// /studio; the $0 demo is one click away, deliberately, so an interviewer can try SceneLab
// without creating an account.
export const metadata = {
  title: 'SceneLab — script to storyboard to animatic',
  description:
    'Paste a script. Get a shot-by-shot storyboard, then an animatic you can watch and export.',
}

export default function LandingPage() {
  return (
    <main className="relative flex min-h-svh w-full flex-col">
      <LandingHero />

      <div className="relative z-10 flex min-h-svh flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between">
          <span className="text-[13px] tracking-[0.2em] text-foreground">SCENELAB</span>
          <Link
            href="/sign-in"
            className="text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
          >
            Log in
          </Link>
        </header>

        <div className="flex flex-1 flex-col justify-center gap-7 py-16 sm:max-w-[560px]">
          <h1 className="text-[clamp(2rem,6vw,3.25rem)] leading-[1.05] tracking-[-0.02em] text-foreground">
            Your script,
            <br />
            shot by shot.
          </h1>

          <p className="max-w-[46ch] text-[15px] leading-[1.65] text-[var(--muted-foreground)]">
            Paste a scene. SceneLab breaks it into its visual beats, renders each one as a frame,
            and animates the ones you choose — then plays the whole thing back as an animatic you
            can export.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/sign-up"
              className="rounded-md bg-foreground px-5 py-2.5 text-[14px] text-background transition-opacity hover:opacity-90"
            >
              Begin
            </Link>
            <Link
              href="/studio?demo=1"
              className="rounded-md border border-white/15 px-5 py-2.5 text-[14px] text-foreground transition-colors hover:border-white/30"
            >
              See a finished scene
            </Link>
          </div>

          <p className="text-[12px] text-[var(--text-tertiary)]">
            The demo is a real generated scene, pre-rendered — no account, no cost. Making your
            own needs an account; new ones start with free tokens.
          </p>
        </div>

        {/* Legal links and the hero attribution share one row and separate onto their own
            lines when there isn't width for both. The attribution used to be pinned to the
            viewport corner, which put it straight through these links on short screens. */}
        <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[12px] text-[var(--text-tertiary)]">
          <nav className="flex flex-wrap gap-4">
            <Link href="/legal/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/legal/acceptable-use" className="transition-colors hover:text-foreground">
              Acceptable Use
            </Link>
            <Link href="/legal/refunds" className="transition-colors hover:text-foreground">
              Refunds
            </Link>
          </nav>
          <HeroAttribution />
        </footer>
      </div>
    </main>
  )
}
