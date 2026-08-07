export const metadata = { title: 'Refund Policy — SceneLab' }

const EFFECTIVE = '5 August 2026'

export default function RefundsPage() {
  return (
    <>
      <h1 className="text-[22px] text-foreground">Refund Policy</h1>
      <p className="text-[12px] text-[var(--text-tertiary)]">Effective {EFFECTIVE}</p>

      <p>
        Tokens pay for generation that costs us money the moment it runs, so the rules below are
        specific rather than general. The short version: you are never charged for work that
        failed, and you can always get unspent tokens back within 14 days.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Automatic — you do nothing</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        <li>A generation that fails is refunded in full, automatically.</li>
        <li>A generation that never completes is refunded once it times out.</li>
        <li>Reusing an existing image or clip costs nothing — you are only charged for new work.</li>
        <li>A batch you cancel does not charge for anything that had not started yet.</li>
      </ul>

      <h2 className="pt-4 text-[15px] text-foreground">Unspent tokens</h2>
      <p>
        Within <strong className="text-foreground">14 days</strong> of a purchase you may request
        a refund of the tokens from it that you have not spent. We refund the unspent portion
        pro rata to your original payment method. Email <ContactEmail /> from your account
        address.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">What we do not refund</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        <li>
          <strong className="text-foreground">Generations that succeeded but that you did not
          like.</strong> These models are non-deterministic; an image you would not have chosen
          is still an image we paid to produce. Start small before committing to a batch.
        </li>
        <li>
          <strong className="text-foreground">Clips already sent to the provider when you
          cancelled.</strong> They finish and appear in your project — you receive the work you
          paid for. The interface warns about this before a batch starts and while it runs.
        </li>
        <li>Tokens spent before an account was suspended for violating the Acceptable Use Policy.</li>
        <li>Tokens from a purchase more than 14 days old.</li>
      </ul>

      <h2 className="pt-4 text-[15px] text-foreground">If something goes wrong</h2>
      <p>
        If tokens were deducted and you got nothing usable, that is a bug, not a purchase — tell
        us and we will restore them. Every token movement is recorded in a ledger, so we can
        check exactly what happened rather than guessing. Email <ContactEmail /> with roughly
        when it occurred.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Statutory rights</h2>
      <p>
        Nothing here limits rights you have under consumer law. If you are in the UK or EU you
        have a statutory right to cancel a digital purchase within 14 days; where you have
        already spent tokens, that consumption is treated as digital content supplied with your
        consent, and the unspent balance is what remains refundable.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Timing</h2>
      <p>
        Approved refunds are issued to the original payment method, usually within five business
        days. How quickly it appears is up to your bank.
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
