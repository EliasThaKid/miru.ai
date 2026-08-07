export const metadata = { title: 'Privacy Policy — SceneLab' }

const EFFECTIVE = '5 August 2026'

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-[22px] text-foreground">Privacy Policy</h1>
      <p className="text-[12px] text-[var(--text-tertiary)]">Effective {EFFECTIVE}</p>

      <p>
        This describes what SceneLab actually stores and sends, not a generic template. If the
        product changes, this page changes with it.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">What we collect</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        <li>
          <strong className="text-foreground">Account:</strong> your email address, and — if you
          sign in with GitHub — the account identifier GitHub returns. Passwords are handled by
          our authentication provider and are never visible to us.
        </li>
        <li>
          <strong className="text-foreground">Project content:</strong> your script, cast and
          setting descriptions, prompts, and the generated images and clips.
        </li>
        <li>
          <strong className="text-foreground">Token records:</strong> your balance and a ledger
          of every movement — what was spent, refunded, granted, or purchased, and when.
        </li>
        <li>
          <strong className="text-foreground">Render jobs:</strong> which generations you
          started, their status, and any error, so work survives a closed tab.
        </li>
        <li>
          <strong className="text-foreground">Server logs:</strong> operational diagnostics.
          These deliberately exclude prompt text, image URLs, and credentials.
        </li>
      </ul>
      <p>
        We do not use analytics or advertising trackers. The only cookies are the ones that keep
        you signed in.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Who we send it to</h2>
      <p>Running SceneLab means passing some of your data to these processors:</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        <li>
          <strong className="text-foreground">Supabase</strong> — authentication, database, and
          file storage. Your account, projects, and generated assets live here.
        </li>
        <li>
          <strong className="text-foreground">Anthropic</strong> — receives your script and
          cast/setting text to produce the shot breakdown and refinements.
        </li>
        <li>
          <strong className="text-foreground">fal.ai</strong> — receives image and video prompts,
          and image URLs, to run the FLUX and Kling models.
        </li>
        <li>
          <strong className="text-foreground">Stripe</strong> — payments. Stripe collects your
          card details directly; they never pass through our servers. We store only the
          checkout session id, the token amount, and the amount paid.
        </li>
        <li>
          <strong className="text-foreground">Vercel</strong> — hosting.
        </li>
      </ul>
      <p>
        We do not sell your data or share it for advertising. These providers process data under
        their own terms; if that matters to you, review theirs as well.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">How it is protected</h2>
      <p>
        Projects and token records are isolated per account by database row-level security.
        Generated assets are stored in a private bucket scoped to your account and served only
        through short-lived signed links — there is no public URL to guess. Nothing that credits
        tokens can be triggered from a browser.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">How long we keep it</h2>
      <p>
        Projects and assets are kept until you delete them or your account. The token ledger and
        purchase records are kept for as long as we need them for accounting and tax purposes,
        even after an account closes — they are financial records.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Your choices</h2>
      <p>
        You can ask for a copy of your data, correction of it, or deletion of your account and
        content. Email <ContactEmail />. Depending on where you live you may have further rights
        under the GDPR, UK GDPR, or CCPA — including objecting to processing or lodging a
        complaint with your data protection authority. We do not sell personal information.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Children</h2>
      <p>
        SceneLab is not intended for children under 13, and we do not knowingly collect their
        data. If you believe a child has created an account, contact us and we will remove it.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Contact</h2>
      <p>
        Privacy questions or requests: <ContactEmail />
      </p>
    </>
  )
}

function ContactEmail() {
  return (
    <a href="mailto:support@urbnchld.com" className="text-foreground underline">
      support@urbnchld.com
    </a>
  )
}
