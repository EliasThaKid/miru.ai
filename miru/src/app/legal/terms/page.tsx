export const metadata = { title: 'Terms of Service — SceneLab' }

const EFFECTIVE = '5 August 2026'

export default function TermsPage() {
  return (
    <>
      <h1 className="text-[22px] text-foreground">Terms of Service</h1>
      <p className="text-[12px] text-[var(--text-tertiary)]">Effective {EFFECTIVE}</p>

      <h2 className="pt-4 text-[15px] text-foreground">1. What SceneLab is</h2>
      <p>
        SceneLab turns a written script into a storyboard and an animatic. It sends your text to
        third-party AI providers, which return generated images and video clips. It is a
        creative tool, not a guarantee of any particular result.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">2. Your account</h2>
      <p>
        You need an account to generate. You must provide an email address you control, keep
        your credentials secure, and be at least 13 years old (or the minimum age of digital
        consent where you live, if that is higher). You are responsible for everything done
        through your account.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">3. Tokens</h2>
      <p>
        Generation is paid for with tokens. Tokens are a prepaid credit for using this service:
        they are not currency, they have no cash value, they cannot be transferred between
        accounts, and they cannot be redeemed for money except as described in the{' '}
        <a href="/legal/refunds" className="text-foreground underline">Refund Policy</a>.
      </p>
      <p>
        Tokens are deducted when a generation starts, not when it finishes. If a generation
        fails on our side or the provider&apos;s, the tokens are returned automatically. If you
        cancel a batch, work that has already been sent to the provider has been paid for on
        your behalf and is not refunded — you still receive the results. This is stated in the
        interface before you start a batch.
      </p>
      <p>
        Daily generation limits apply per account and across the service. We may change token
        prices and per-generation costs; changes apply to future purchases, never retroactively
        to tokens you already hold.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">4. Your content</h2>
      <p>
        You keep ownership of the scripts you write. As between you and us, you own the images
        and clips generated from your prompts, to the extent they are capable of being owned —
        AI output may not be copyrightable in some jurisdictions, and we make no representation
        that it is.
      </p>
      <p>
        You grant us only the licence needed to run the service: to store your projects, to
        transmit your prompts to the AI providers we use, and to hold generated assets so you
        can retrieve them. We do not use your content to train models.
      </p>
      <p>
        You are responsible for having the rights to what you submit, and for how you use what
        comes out.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">5. Acceptable use</h2>
      <p>
        Generation happens on our accounts with third-party providers, and we are accountable to
        them for it. The{' '}
        <a href="/legal/acceptable-use" className="text-foreground underline">Acceptable Use Policy</a>{' '}
        is part of these Terms. We may suspend an account that violates it, without refund of
        tokens already spent.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">6. Availability</h2>
      <p>
        SceneLab is provided as-is, with no uptime guarantee. It depends on third-party AI
        providers that may be slow, unavailable, or may change or withdraw models. We may modify
        or discontinue features. If we discontinue the service entirely, we will give notice and
        refund unspent tokens.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">7. Liability</h2>
      <p>
        To the maximum extent the law allows, we are not liable for indirect or consequential
        loss, lost profits, or lost data. Our total liability for any claim is limited to the
        amount you paid us in the three months before the claim arose. Nothing here excludes
        liability that cannot lawfully be excluded.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">8. Ending your account</h2>
      <p>
        You may stop using SceneLab and request deletion at any time (see the{' '}
        <a href="/legal/privacy" className="text-foreground underline">Privacy Policy</a>). We may
        suspend or close an account that violates these Terms or the Acceptable Use Policy, or
        where required by law.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">9. Changes</h2>
      <p>
        We may update these Terms. Material changes will be announced in the app before they
        take effect. Continuing to use SceneLab after that means you accept the updated Terms.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">10. Contact</h2>
      <p>
        Questions about these Terms: <ContactEmail />
      </p>
    </>
  )
}

// Local, not exported: a Next page module may only export the default, `metadata`, and route
// segment config.
function ContactEmail() {
  return (
    <a href="mailto:support@urbnchld.com" className="text-foreground underline">
      support@urbnchld.com
    </a>
  )
}
