export const metadata = { title: 'Acceptable Use Policy — SceneLab' }

const EFFECTIVE = '5 August 2026'

export default function AcceptableUsePage() {
  return (
    <>
      <h1 className="text-[22px] text-foreground">Acceptable Use Policy</h1>
      <p className="text-[12px] text-[var(--text-tertiary)]">Effective {EFFECTIVE}</p>

      <p>
        Every generation runs on our accounts with Anthropic and fal.ai, under their usage
        policies. When you generate here, we are answerable for it — which is why this policy
        exists and why we enforce it.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Do not use SceneLab to create</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        <li>Sexual content involving minors, or any sexualised depiction of a minor. This is reported, not just removed.</li>
        <li>Sexually explicit material, or content whose purpose is sexual gratification.</li>
        <li>Realistic depictions of a real, identifiable person without their consent — including public figures — and in particular anything presenting them as saying or doing something they did not.</li>
        <li>Content intended to deceive: fabricated news events, fake evidence, or impersonation of a real organisation.</li>
        <li>Graphic violence or gore made to shock, or content that glorifies or incites violence.</li>
        <li>Harassment of a specific person, hate content targeting protected characteristics, or content promoting self-harm.</li>
        <li>Instructions or depictions that meaningfully assist serious physical harm.</li>
        <li>Content that infringes someone else&apos;s copyright or trademark.</li>
      </ul>

      <h2 className="pt-4 text-[15px] text-foreground">Do not abuse the service</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        <li>No automated or scripted access, scraping, or load testing.</li>
        <li>No attempts to bypass token costs, daily limits, or the account system, and no sharing of accounts to do so.</li>
        <li>No reselling generation capacity or reselling access to your account.</li>
        <li>No probing for vulnerabilities. If you find one, report it to <ContactEmail /> — we will not pursue good-faith reports.</li>
      </ul>

      <h2 className="pt-4 text-[15px] text-foreground">A note on filters</h2>
      <p>
        The image provider runs its own safety filter, which sometimes blocks ordinary
        storyboard prompts by mistake. A blocked generation is not an accusation. Rephrase and
        try again — and if it keeps happening on plainly benign material, tell us, because that
        is a bug worth knowing about.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Enforcement</h2>
      <p>
        We may review content when investigating a report, a provider notice, or suspected
        abuse. We do not routinely browse projects.
      </p>
      <p>
        Depending on severity we may warn you, remove content, suspend your account&apos;s
        ability to generate, or close it. Suspension does not refund tokens already spent.
        Serious violations — above all anything involving minors — are actioned immediately and
        reported to the relevant authorities.
      </p>
      <p>
        If you believe enforcement was a mistake, reply to the notice or email <ContactEmail />.
        We will look again.
      </p>

      <h2 className="pt-4 text-[15px] text-foreground">Reporting</h2>
      <p>
        To report content or behaviour that breaks this policy, email <ContactEmail /> with
        enough detail to identify it. Reports are read.
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
