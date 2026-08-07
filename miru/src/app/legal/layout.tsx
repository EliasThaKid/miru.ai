import Link from 'next/link'

// Shared chrome for the policy pages. Static, server-rendered, no auth — these must be
// readable by anyone, including someone deciding whether to sign up.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-svh w-full max-w-[720px] px-6 py-16">
      <header className="mb-12">
        <Link href="/" className="text-[13px] tracking-[0.2em] text-foreground">
          SCENELAB
        </Link>
      </header>

      <article className="prose-legal flex flex-col gap-5 text-[14px] leading-[1.7] text-[var(--muted-foreground)]">
        {children}
      </article>

      <footer className="mt-16 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-[12px] text-[var(--text-tertiary)]">
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
        <Link href="/" className="ml-auto transition-colors hover:text-foreground">
          Back to app
        </Link>
      </footer>
    </div>
  )
}
