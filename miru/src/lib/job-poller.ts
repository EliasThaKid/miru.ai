import { pollRenderJobStatus, type PollJobResult } from '@/app/actions/render-jobs'

// Client-side driver for an async render job. Kling runs for minutes, so this polls slowly
// and backs off: the point is to notice completion within a few seconds, not to watch.
//
// Deliberately NOT abortable. A submitted job is paid work that fal is already running, so
// "stop watching" would only lose the result — cancelling a batch stops SCHEDULING new jobs
// and lets in-flight ones land (see runAnimateAll).

const FIRST_DELAY_MS = 4000
const MAX_DELAY_MS = 10000
// The server terminates a stale job at 30 minutes (JOB_STALE_AFTER_MS). This is only a
// backstop so a client can never spin forever if that check is somehow not reached.
const CLIENT_GIVE_UP_MS = 35 * 60 * 1000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function awaitRenderJob(
  jobId: string,
  onPending?: (queuePosition: number | null) => void
): Promise<PollJobResult> {
  const startedAt = Date.now()
  let delay = FIRST_DELAY_MS

  for (;;) {
    await sleep(delay)
    delay = Math.min(Math.round(delay * 1.3), MAX_DELAY_MS)

    const result = await pollRenderJobStatus(jobId)
    if (!result.ok || result.status === 'done') return result

    onPending?.(result.queuePosition)

    if (Date.now() - startedAt > CLIENT_GIVE_UP_MS) {
      return { ok: false, error: 'The render is taking unusually long. Check back shortly — it may still land.' }
    }
  }
}
