'use server'

import { mirrorAsset } from '@/lib/asset-store'
import {
  FAL_ENDPOINTS,
  generateImage,
  pollVideoJob,
  submitAnimateMoment,
  submitDualKeyframe,
  uploadFrame,
} from '@/lib/fal'
import { beginGeneration, refundSpend, tokenCost } from '@/lib/metering'
import { buildImagePrompt, buildTransitionPrompt, buildVideoPrompt } from '@/lib/prompts'
import {
  attachRequest,
  cancelPendingJobs,
  claimPendingJob,
  createRenderJob,
  finishRenderJob,
  isJobStale,
  listOpenRenderJobs,
  loadRenderJob,
  markRenderJobRunning,
  type RenderJob,
  type RenderJobKind,
} from '@/lib/render-jobs'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createClient } from '@/lib/supabase/server'
import type { Moment, StylePreset, Transition } from '@/types'

// Async generation. A submit action reserves tokens, hands the work to fal's queue, and
// persists the request id; the browser then polls until a terminal state. Because the job
// row outlives the request that created it, closing the tab no longer destroys a paid
// generation — which is what the blocking `fal.subscribe` path could not survive.
//
// The synchronous actions (generate-moment-video, generate-anchored-video, generate-bridge)
// remain the fallback for the unconfigured $0 demo, where there is no database to hold a job.

export interface RenderJobResult {
  videoUrl: string
  videoPrompt: string
  videoStoragePath: string | null
  // Anchored jobs only: the end-pose still is a separate paid asset the caller must persist.
  endImageUrl?: string
  endImageStoragePath?: string | null
}

export type SubmitJobResult =
  | { ok: true; status: 'queued'; jobId: string }
  // The asset already existed — nothing was submitted and no tokens were spent.
  | { ok: true; status: 'cached'; result: RenderJobResult }
  | { ok: false; error: string }

export type PollJobResult =
  | { ok: true; status: 'pending'; queuePosition: number | null }
  | { ok: true; status: 'done'; kind: RenderJobKind; targetId: string; result: RenderJobResult }
  | { ok: false; error: string }

const NEEDS_HOSTING =
  'Background rendering needs the hosted setup (Supabase). The local demo uses the direct render path.'

// Every submit needs a signed-in user: the job row, the token spend, and the Storage mirror
// are all scoped to one.
async function requireUser(): Promise<{ id: string } | null> {
  if (!isSupabaseConfigured()) return null
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? { id: user.id } : null
}

// ---------------------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------------------

export async function submitMomentVideoJob(
  moment: Moment,
  projectId: string | null
): Promise<SubmitJobResult> {
  if (moment.videoUrl) {
    return {
      ok: true,
      status: 'cached',
      result: {
        videoUrl: moment.videoUrl,
        videoPrompt: moment.videoPrompt ?? '',
        videoStoragePath: moment.videoStoragePath ?? null,
      },
    }
  }
  if (!moment.imageUrl) {
    return { ok: false, error: 'Render the frame first — animation starts from it.' }
  }

  const user = await requireUser()
  if (!user) return { ok: false, error: NEEDS_HOSTING }

  const amount = tokenCost.clip()
  const meter = await beginGeneration(amount, 'spend:clip', moment.id)
  if (!meter.ok) return { ok: false, error: meter.error }

  try {
    const clipSeconds = moment.durationSeconds >= 8 ? 10 : 5
    const videoPrompt = buildVideoPrompt(
      moment.shotType,
      moment.motion ?? moment.description,
      clipSeconds
    )
    const requestId = await submitAnimateMoment(
      moment.imageUrl,
      videoPrompt,
      clipSeconds === 10 ? '10' : '5'
    )
    return await persistJob(meter.refund, {
      userId: user.id,
      projectId,
      kind: 'clip',
      targetId: moment.id,
      endpoint: FAL_ENDPOINTS.klingImageToVideo,
      requestId,
      tokensSpent: amount,
      spendRef: moment.id,
      prompt: videoPrompt,
      extra: { videoModel: 'kling-1.6' },
    })
  } catch (err) {
    await meter.refund()
    return { ok: false, error: errorText(err, 'Could not queue the animation. Please try again.') }
  }
}

export async function submitAnchoredVideoJob(
  moment: Moment,
  stylePreset: StylePreset,
  characterDescription: string,
  settingDescription: string | null,
  characterNames: string[],
  projectId: string | null
): Promise<SubmitJobResult> {
  if (!moment.imageUrl) {
    return { ok: false, error: 'Render the frame first — anchored animation starts from it.' }
  }
  if (moment.durationSeconds >= 8) {
    return {
      ok: false,
      error: 'Anchored animation supports 5-second clips only (Kling O3 is not validated at 10s).',
    }
  }

  const user = await requireUser()
  if (!user) return { ok: false, error: NEEDS_HOSTING }

  // One O3 clip, plus a still only when a fresh end pose must be rendered.
  const amount = tokenCost.clip() + (moment.endImageUrl ? 0 : tokenCost.still())
  const meter = await beginGeneration(amount, 'spend:anchored', moment.id)
  if (!meter.ok) return { ok: false, error: meter.error }

  try {
    // The end still is a short synchronous FLUX call — only the multi-minute Kling half needs
    // the queue. Mirroring it before submit means the paid still survives a clip failure.
    let endImageUrl = moment.endImageUrl ?? null
    let endImageStoragePath = moment.endImageStoragePath ?? null
    if (!endImageUrl) {
      endImageUrl = await generateImage(
        buildImagePrompt(
          stylePreset,
          characterDescription,
          moment.shotType,
          moment.endFrame ?? moment.description,
          settingDescription,
          characterNames,
          moment.visualFocus,
          moment.blocking
        )
      )
      const mirroredStill = await mirrorAsset(endImageUrl, 'still', `${moment.id}-end`)
      if (mirroredStill) {
        endImageUrl = mirroredStill.url
        endImageStoragePath = mirroredStill.path
      }
    }

    const videoPrompt = buildVideoPrompt(moment.shotType, moment.motion ?? moment.description, 5)
    const requestId = await submitDualKeyframe(moment.imageUrl, endImageUrl, videoPrompt)
    return await persistJob(meter.refund, {
      userId: user.id,
      projectId,
      kind: 'anchored',
      targetId: moment.id,
      endpoint: FAL_ENDPOINTS.klingDualKeyframe,
      requestId,
      tokensSpent: amount,
      spendRef: moment.id,
      prompt: videoPrompt,
      extra: { videoModel: 'kling-o3-anchored', endImageUrl, endImageStoragePath },
    })
  } catch (err) {
    await meter.refund()
    return {
      ok: false,
      error: errorText(err, 'Could not queue the anchored animation. Please try again.'),
    }
  }
}

export async function submitBridgeJob(
  fromMoment: Moment,
  toMoment: Moment,
  existing: Transition | null,
  bridgeDirection: string | null,
  startFrameDataUrl: string | null,
  projectId: string | null
): Promise<SubmitJobResult> {
  if (existing?.videoUrl) {
    return {
      ok: true,
      status: 'cached',
      result: {
        videoUrl: existing.videoUrl,
        videoPrompt: existing.transitionPrompt ?? '',
        videoStoragePath: existing.videoStoragePath ?? null,
      },
    }
  }
  if (!fromMoment.imageUrl || !toMoment.imageUrl) {
    return { ok: false, error: 'Both moments need images before a bridge can be generated.' }
  }

  const user = await requireUser()
  if (!user) return { ok: false, error: NEEDS_HOSTING }

  const pairKey = `${fromMoment.id}->${toMoment.id}`
  const amount = tokenCost.bridge()
  const meter = await beginGeneration(amount, 'spend:bridge', pairKey)
  if (!meter.ok) return { ok: false, error: meter.error }

  try {
    const startImageUrl = startFrameDataUrl
      ? await uploadFrame(startFrameDataUrl)
      : fromMoment.imageUrl
    const transitionPrompt = buildTransitionPrompt(
      fromMoment.description,
      toMoment.description,
      bridgeDirection
    )
    const requestId = await submitDualKeyframe(startImageUrl, toMoment.imageUrl, transitionPrompt)
    return await persistJob(meter.refund, {
      userId: user.id,
      projectId,
      kind: 'bridge',
      targetId: pairKey,
      endpoint: FAL_ENDPOINTS.klingDualKeyframe,
      requestId,
      tokensSpent: amount,
      spendRef: pairKey,
      prompt: transitionPrompt,
    })
  } catch (err) {
    await meter.refund()
    return { ok: false, error: errorText(err, 'Could not queue the bridge. Please try again.') }
  }
}

// Record the submitted job. If the row can't be written we have a fal request nobody can
// collect, so the user is refunded rather than charged for an untrackable render. fal will
// still run (and bill the owner) — hence the loud log.
async function persistJob(
  refund: () => Promise<void>,
  job: Parameters<typeof createRenderJob>[0]
): Promise<SubmitJobResult> {
  const created = await createRenderJob(job)
  if (!created) {
    console.error(
      `[jobs] ORPHANED fal request ${job.requestId} (${job.endpoint}) — job row could not be written; user refunded.`
    )
    await refund()
    return { ok: false, error: 'Could not start the render. Please try again.' }
  }
  return { ok: true, status: 'queued', jobId: created.id }
}

// ---------------------------------------------------------------------------------------
// Batches — durable intent
//
// An Animate All records a 'pending' row per moment BEFORE anything is charged, so the list
// of work survives a closed tab. The scheduler then promotes them a few at a time; tokens
// are spent only at promotion. Without this the queue lived in the browser and a reload lost
// every clip that hadn't been submitted yet.
// ---------------------------------------------------------------------------------------

export interface PendingJobRef {
  jobId: string
  targetId: string
}

export async function startAnimateBatch(
  momentIds: string[],
  projectId: string | null
): Promise<{ ok: true; jobs: PendingJobRef[] } | { ok: false; error: string }> {
  const user = await requireUser()
  if (!user) return { ok: false, error: NEEDS_HOSTING }

  const jobs: PendingJobRef[] = []
  for (const momentId of momentIds) {
    const created = await createRenderJob({
      userId: user.id,
      projectId,
      kind: 'clip',
      targetId: momentId,
      endpoint: FAL_ENDPOINTS.klingImageToVideo,
      status: 'pending',
      tokensSpent: 0,
      spendRef: momentId,
      prompt: null,
    })
    if (created) jobs.push({ jobId: created.id, targetId: momentId })
  }

  if (jobs.length === 0) return { ok: false, error: 'Could not start the batch. Please try again.' }
  return { ok: true, jobs }
}

// Promote one pending job: claim it, spend, submit. The claim is what stops two tabs from
// paying for the same clip twice.
export async function submitPendingClipJob(
  jobId: string,
  moment: Moment
): Promise<SubmitJobResult> {
  const user = await requireUser()
  if (!user) return { ok: false, error: NEEDS_HOSTING }

  const job = await loadRenderJob(jobId, user.id)
  if (!job) return { ok: false, error: 'That render job could not be found.' }
  // The client supplies the moment, so the server must confirm it is the one this job is for.
  if (job.target_id !== moment.id) return { ok: false, error: 'That render job does not match this moment.' }
  if (job.status !== 'pending') return { ok: false, error: 'That render job has already started.' }
  if (!moment.imageUrl) return { ok: false, error: 'Render the frame first — animation starts from it.' }

  if (!(await claimPendingJob(jobId))) {
    return { ok: false, error: 'That render job has already started.' }
  }

  const amount = tokenCost.clip()
  const meter = await beginGeneration(amount, 'spend:clip', moment.id)
  if (!meter.ok) {
    // Put it back so a top-up can resume the batch rather than losing the intent.
    await finishRenderJob(jobId, { status: 'cancelled', error: meter.error })
    return { ok: false, error: meter.error }
  }

  try {
    const clipSeconds = moment.durationSeconds >= 8 ? 10 : 5
    const videoPrompt = buildVideoPrompt(
      moment.shotType,
      moment.motion ?? moment.description,
      clipSeconds
    )
    const requestId = await submitAnimateMoment(
      moment.imageUrl,
      videoPrompt,
      clipSeconds === 10 ? '10' : '5'
    )
    await attachRequest(jobId, requestId, amount, videoPrompt, { videoModel: 'kling-1.6' })
    return { ok: true, status: 'queued', jobId }
  } catch (err) {
    await meter.refund()
    await finishRenderJob(jobId, { status: 'failed', error: 'Could not queue the animation.' })
    return { ok: false, error: errorText(err, 'Could not queue the animation. Please try again.') }
  }
}

// Cancel = drop unsubmitted intent. Submitted jobs are untouched on purpose: they are paid,
// running work, so they finish and land rather than being thrown away.
export async function abandonPendingJobs(jobIds: string[]): Promise<void> {
  const user = await requireUser()
  if (!user) return
  await cancelPendingJobs(user.id, jobIds)
}

// ---------------------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------------------

export async function pollRenderJobStatus(jobId: string): Promise<PollJobResult> {
  const user = await requireUser()
  if (!user) return { ok: false, error: NEEDS_HOSTING }

  const job = await loadRenderJob(jobId, user.id)
  if (!job) return { ok: false, error: 'That render job could not be found.' }

  if (job.status === 'succeeded') return doneResult(job)
  if (job.status === 'failed' || job.status === 'cancelled') {
    return { ok: false, error: job.error ?? 'The render did not complete.' }
  }
  // Claimed but not yet submitted (or still pending): nothing to ask fal about.
  if (!job.request_id) return { ok: true, status: 'pending', queuePosition: null }

  const state = await pollVideoJob(job.endpoint, job.request_id)

  if (state.state === 'pending') {
    // A job that never terminates would hold the user's tokens forever.
    if (isJobStale(job)) return await failJob(job, 'The render timed out. Your tokens were returned.')
    await markRenderJobRunning(job.id)
    return { ok: true, status: 'pending', queuePosition: state.queuePosition }
  }

  if (state.state === 'failed') return await failJob(job, state.error)

  // Succeeded — mirror into Storage before recording, so the stored URL is already durable.
  const mirrored = await mirrorAsset(state.videoUrl, 'clip', `${job.kind}-${job.target_id}`)
  const resultUrl = mirrored?.url ?? state.videoUrl

  const claimed = await finishRenderJob(job.id, {
    status: 'succeeded',
    result_url: resultUrl,
    storage_path: mirrored?.path ?? null,
  })
  // A concurrent poll won the transition; re-read so both callers return the same result.
  if (!claimed) {
    const fresh = await loadRenderJob(jobId, user.id)
    if (fresh?.status === 'succeeded') return doneResult(fresh)
  }

  return {
    ok: true,
    status: 'done',
    kind: job.kind,
    targetId: job.target_id,
    result: buildResult(job, resultUrl, mirrored?.path ?? null),
  }
}

// Terminal failure: refund only if THIS caller performed the transition, so concurrent polls
// can never refund the same job twice.
async function failJob(job: RenderJob, message: string): Promise<PollJobResult> {
  const claimed = await finishRenderJob(job.id, { status: 'failed', error: message })
  if (claimed && job.tokens_spent > 0) {
    await refundSpend(job.user_id, job.tokens_spent, `refund:${job.kind}`, job.spend_ref)
  }
  return { ok: false, error: message }
}

function doneResult(job: RenderJob): PollJobResult {
  return {
    ok: true,
    status: 'done',
    kind: job.kind,
    targetId: job.target_id,
    result: buildResult(job, job.result_url ?? '', job.storage_path),
  }
}

function buildResult(job: RenderJob, videoUrl: string, storagePath: string | null): RenderJobResult {
  const extra = job.extra ?? {}
  const result: RenderJobResult = {
    videoUrl,
    videoPrompt: job.prompt ?? '',
    videoStoragePath: storagePath,
  }
  if (job.kind === 'anchored') {
    result.endImageUrl = typeof extra.endImageUrl === 'string' ? extra.endImageUrl : undefined
    result.endImageStoragePath =
      typeof extra.endImageStoragePath === 'string' ? extra.endImageStoragePath : null
  }
  return result
}

// ---------------------------------------------------------------------------------------
// Reattach — the client calls this on load to resume anything still running.
// ---------------------------------------------------------------------------------------

export interface OpenJobSummary {
  jobId: string
  kind: RenderJobKind
  targetId: string
  createdAt: string
  // 'pending' means never submitted — the client must promote it, not poll it.
  submitted: boolean
}

export async function listOpenJobs(): Promise<OpenJobSummary[]> {
  const user = await requireUser()
  if (!user) return []
  const jobs = await listOpenRenderJobs(user.id)
  return jobs.map((job) => ({
    jobId: job.id,
    kind: job.kind,
    targetId: job.target_id,
    createdAt: job.created_at,
    submitted: job.status !== 'pending',
  }))
}

// Multiplexed poll: one round trip for every in-flight job instead of one per job. Each
// Server Action call re-renders the page tree, so N independent pollers made the UI churn
// several times a second; this ticks once and lands all updates together.
export async function pollRenderJobs(
  jobIds: string[]
): Promise<Record<string, PollJobResult>> {
  const out: Record<string, PollJobResult> = {}
  for (const jobId of jobIds) {
    out[jobId] = await pollRenderJobStatus(jobId)
  }
  return out
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}
