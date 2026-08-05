import { pollRenderJobs, type PollJobResult } from '@/app/actions/render-jobs'

// One poller for every in-flight job, not one per job.
//
// Each Server Action call re-renders the page tree, so N independent pollers meant a
// re-render every second or so and visibly unstable UI. A single ticking loop asks about all
// open jobs at once, so the interface updates in one coherent step per tick.
//
// `watch()` returns a promise per job, which keeps calling code written as a plain await
// while the transport underneath is shared.
//
// Deliberately not abortable: a submitted job is paid work fal is already running, so
// "stop watching" could only lose the result.

const FIRST_DELAY_MS = 4000
const MAX_DELAY_MS = 12000
// The server terminates a stale job at 30 minutes; this is only a backstop so a client can
// never spin forever.
const CLIENT_GIVE_UP_MS = 35 * 60 * 1000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface Watched {
  startedAt: number
  resolve: (result: PollJobResult) => void
}

export class JobWatcher {
  private watched = new Map<string, Watched>()
  private running = false
  // Bumped whenever a job settles, so the UI can re-read `activeIds` without polling state.
  private listeners = new Set<() => void>()

  get activeIds(): string[] {
    return [...this.watched.keys()]
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  watch(jobId: string): Promise<PollJobResult> {
    const existing = this.watched.get(jobId)
    if (existing) {
      // Already watched (a second tab, or a resume racing a live handler) — share the wait.
      return new Promise((resolve) => {
        const previous = existing.resolve
        existing.resolve = (result) => {
          previous(result)
          resolve(result)
        }
      })
    }

    return new Promise((resolve) => {
      this.watched.set(jobId, { startedAt: Date.now(), resolve })
      this.notify()
      if (!this.running) void this.loop()
    })
  }

  private async loop(): Promise<void> {
    this.running = true
    let delay = FIRST_DELAY_MS

    while (this.watched.size > 0) {
      await sleep(delay)
      delay = Math.min(Math.round(delay * 1.25), MAX_DELAY_MS)

      const ids = [...this.watched.keys()]
      let results: Record<string, PollJobResult>
      try {
        results = await pollRenderJobs(ids)
      } catch {
        continue // transient; the next tick asks again rather than failing a live job
      }

      for (const jobId of ids) {
        const result = results[jobId]
        if (!result) continue

        if (!result.ok || result.status === 'done') {
          this.settle(jobId, result)
          continue
        }
        // Backstop only — the server's own stale check is the real timeout.
        const started = this.watched.get(jobId)?.startedAt ?? 0
        if (Date.now() - started > CLIENT_GIVE_UP_MS) {
          this.settle(jobId, {
            ok: false,
            error: 'The render is taking unusually long. Check back shortly — it may still land.',
          })
        }
      }
    }

    this.running = false
  }

  private settle(jobId: string, result: PollJobResult): void {
    const entry = this.watched.get(jobId)
    if (!entry) return
    this.watched.delete(jobId)
    entry.resolve(result)
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
