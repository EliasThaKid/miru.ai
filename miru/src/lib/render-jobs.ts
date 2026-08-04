import { createAdminClient, isServiceRoleConfigured } from '@/lib/supabase/admin'

// Server-side persistence for async render jobs. Every write runs with the SERVICE ROLE:
// a user who could mark their own job failed would collect a refund for work that
// succeeded, so job state is never client-writable (see 0005_render_jobs.sql).
//
// Only imported by 'use server' actions.

export type RenderJobKind = 'clip' | 'anchored' | 'bridge'
export type RenderJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface RenderJob {
  id: string
  user_id: string
  project_id: string | null
  kind: RenderJobKind
  target_id: string
  endpoint: string
  request_id: string
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
  requestId: string
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
      request_id: job.requestId,
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

// All of this user's still-running jobs, for reattaching after a reload.
export async function listOpenRenderJobs(userId: string): Promise<RenderJob[]> {
  if (!isServiceRoleConfigured()) return []
  const { data, error } = await createAdminClient()
    .from('render_jobs')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })

  if (error || !data) return []
  return data as RenderJob[]
}

// Move a job to a terminal state, but ONLY from a non-terminal one. The conditional update
// is what makes concurrent polls safe: exactly one caller sees a row come back, so a failure
// can never be refunded twice and a result can never be recorded twice.
// Returns true if THIS call performed the transition.
export async function finishRenderJob(
  jobId: string,
  patch: {
    status: 'succeeded' | 'failed'
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
    .in('status', ['queued', 'running'])
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
