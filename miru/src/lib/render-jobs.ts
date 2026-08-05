import { createAdminClient, isServiceRoleConfigured } from '@/lib/supabase/admin'

// Server-side persistence for async render jobs. Every write runs with the SERVICE ROLE:
// a user who could mark their own job failed would collect a refund for work that
// succeeded, so job state is never client-writable (see 0005_render_jobs.sql).
//
// Only imported by 'use server' actions.

export type RenderJobKind = 'clip' | 'anchored' | 'bridge'
// 'pending' = intended but not yet sent to fal (nothing charged); 'cancelled' = abandoned
// before submission, so there is nothing to refund.
export type RenderJobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface RenderJob {
  id: string
  user_id: string
  project_id: string | null
  kind: RenderJobKind
  target_id: string
  endpoint: string
  // Null until the job is actually submitted to fal.
  request_id: string | null
  status: RenderJobStatus
  tokens_spent: number
  spend_ref: string
  prompt: string | null
  result_url: string | null
  storage_path: string | null
  extra: Record<string, unknown>
  error: string | null
  created_at: string
  updated_at: string
}

// A job that never reaches a terminal state would otherwise hold the user's tokens forever.
// Kling 1.6 at 10s measured ~4.7 min live; 30 minutes is far past any healthy run.
export const JOB_STALE_AFTER_MS = 30 * 60 * 1000

export function isJobStale(job: RenderJob): boolean {
  return Date.now() - new Date(job.created_at).getTime() > JOB_STALE_AFTER_MS
}

export interface NewRenderJob {
  userId: string
  projectId: string | null
  kind: RenderJobKind
  targetId: string
  endpoint: string
  // Omitted for a 'pending' row — nothing has been sent to fal yet.
  requestId?: string | null
  status?: RenderJobStatus
  tokensSpent: number
  spendRef: string
  prompt: string | null
  extra?: Record<string, unknown>
}

export async function createRenderJob(job: NewRenderJob): Promise<RenderJob | null> {
  if (!isServiceRoleConfigured()) {
    console.error('[jobs] cannot persist a render job: SUPABASE_SERVICE_ROLE_KEY is not set.')
    return null
  }
  const { data, error } = await createAdminClient()
    .from('render_jobs')
    .insert({
      user_id: job.userId,
      project_id: job.projectId,
      kind: job.kind,
      target_id: job.targetId,
      endpoint: job.endpoint,
      request_id: job.requestId ?? null,
      status: job.status ?? 'pending',
      tokens_spent: job.tokensSpent,
      spend_ref: job.spendRef,
      prompt: job.prompt,
      extra: job.extra ?? {},
    })
    .select('*')
    .single()

  if (error) {
    console.error('[jobs] insert failed:', error.message)
    return null
  }
  return data as RenderJob
}

// Load a job and prove it belongs to the caller. The service role bypasses RLS, so this
// ownership check is the only thing standing between a guessed job id and someone else's
// result — it is not optional.
export async function loadRenderJob(jobId: string, userId: string): Promise<RenderJob | null> {
  if (!isServiceRoleConfigured()) return null
  const { data, error } = await createAdminClient()
    .from('render_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (error || !data) return null
  if (data.user_id !== userId) return null
  return data as RenderJob
}

// Everything this user has outstanding: submitted work still running, AND intended work that
// was never submitted. Both are needed to resume a batch — 'pending' rows are the ones a
// closed tab used to lose. Oldest first so a resumed batch keeps its original order.
export async function listOpenRenderJobs(userId: string): Promise<RenderJob[]> {
  if (!isServiceRoleConfigured()) return []
  const { data, error } = await createAdminClient()
    .from('render_jobs')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['pending', 'queued', 'running'])
    .order('created_at', { ascending: true })

  if (error || !data) return []
  return data as RenderJob[]
}

// Claim a pending job for submission. The conditional update is the lock: if two tabs resume
// the same batch, exactly one wins the row and only one fal request (and one charge) happens.
export async function claimPendingJob(jobId: string): Promise<boolean> {
  if (!isServiceRoleConfigured()) return false
  const { data, error } = await createAdminClient()
    .from('render_jobs')
    .update({ status: 'queued' })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    console.error('[jobs] claim failed:', error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

// Record the fal request id and the tokens actually spent, once a claimed job is submitted.
export async function attachRequest(
  jobId: string,
  requestId: string,
  tokensSpent: number,
  prompt: string | null,
  extra: Record<string, unknown> | null
): Promise<void> {
  if (!isServiceRoleConfigured()) return
  const patch: Record<string, unknown> = { request_id: requestId, tokens_spent: tokensSpent, prompt }
  if (extra) patch.extra = extra
  await createAdminClient().from('render_jobs').update(patch).eq('id', jobId)
}

// Abandon jobs that were never submitted. Nothing was charged, so there is nothing to
// refund — which is why cancelling is only ever free for work that hasn't started.
export async function cancelPendingJobs(userId: string, jobIds: string[]): Promise<void> {
  if (!isServiceRoleConfigured() || jobIds.length === 0) return
  await createAdminClient()
    .from('render_jobs')
    .update({ status: 'cancelled' })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .in('id', jobIds)
}

// Move a job to a terminal state, but ONLY from a non-terminal one. The conditional update
// is what makes concurrent polls safe: exactly one caller sees a row come back, so a failure
// can never be refunded twice and a result can never be recorded twice.
// Returns true if THIS call performed the transition.
export async function finishRenderJob(
  jobId: string,
  patch: {
    // 'cancelled' is terminal too, and only ever used for work that was never charged.
    status: 'succeeded' | 'failed' | 'cancelled'
    result_url?: string | null
    storage_path?: string | null
    extra?: Record<string, unknown>
    error?: string | null
  }
): Promise<boolean> {
  if (!isServiceRoleConfigured()) return false
  const { data, error } = await createAdminClient()
    .from('render_jobs')
    .update(patch)
    .eq('id', jobId)
    .in('status', ['pending', 'queued', 'running'])
    .select('id')

  if (error) {
    console.error('[jobs] finish failed:', error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

// Note progress without touching terminal state. Best-effort: a failed status bump is
// cosmetic and must never fail a poll.
export async function markRenderJobRunning(jobId: string): Promise<void> {
  if (!isServiceRoleConfigured()) return
  await createAdminClient()
    .from('render_jobs')
    .update({ status: 'running' })
    .eq('id', jobId)
    .eq('status', 'queued')
}
