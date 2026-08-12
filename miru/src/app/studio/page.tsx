'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { generateMoments } from '@/app/actions/generate-moments'
import { generateMomentImage } from '@/app/actions/generate-image'
import { generateMomentVideo } from '@/app/actions/generate-moment-video'
import { generateAnchoredMomentVideo } from '@/app/actions/generate-anchored-video'
import { generateBridgeVideo } from '@/app/actions/generate-bridge'
import {
  abandonPendingJobs,
  listOpenJobs,
  startAnimateBatch,
  submitAnchoredVideoJob,
  submitBridgeJob,
  submitMomentVideoJob,
  submitPendingClipJob,
  type RenderJobResult,
  type SubmitJobResult,
} from '@/app/actions/render-jobs'
import { extractScriptContext } from '@/app/actions/extract-context'
import { getTokenCosts, type TokenCosts } from '@/app/actions/token-costs'
import { refineCharacterDescription, refineSettingDescription } from '@/app/actions/refine-character'
import { AnimaticPlayer } from '@/components/animatic-player'
import { HeroCanvas } from '@/components/hero-canvas'
import { Inspector } from '@/components/inspector'
import { CollapseHandle, LeftRail } from '@/components/left-rail'
import { MobileBar } from '@/components/mobile-bar'
import { ReviewStrip, type JointStatus, type ReviewSelection, type SlotStatus } from '@/components/review-strip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { extractLastFrame } from '@/lib/extract-frame'
import { JobWatcher } from '@/lib/job-poller'
import { isDescriptionWeak, parseAvoid } from '@/lib/prompts'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { loadActiveProject, saveActiveProject, ANON_CONTEXT, type PersistContext } from '@/lib/project-store'
import { newId } from '@/lib/utils'
import type { Character, ConnectionMode, Moment, Project, Setting, StylePreset, Transition, VisualFocus } from '@/types'

// Server Action timeout for this page. 60s is the Vercel Hobby ceiling; raise it toward 300
// only on Pro, and only if you re-enable a blocking render path.
//
// Phase 5 is what makes 60 enough: signed-in generation now SUBMITS to fal's queue and polls,
// so no action waits on a 2-5 minute Kling render. The longest remaining calls are the Claude
// breakdown, a FLUX still, and a poll tick that mirrors a finished clip into Storage — all
// comfortably inside a minute. The blocking fallback only runs in the unconfigured $0 demo,
// where there is no serverless function involved.
export const maxDuration = 60

const STYLE_PRESETS: { value: StylePreset; label: string }[] = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'anime', label: 'Anime' },
  { value: 'illustrated', label: 'Illustrated' },
  { value: 'hyper-realistic', label: 'Hyper-Realistic' },
]

// Fallback prices, used only until getTokenCosts() answers (and in an unconfigured local
// build, where nothing is charged at all). Kept in step with the server defaults in
// lib/metering.ts — the server remains the authority; these just avoid a blank price on the
// first paint.
const FALLBACK_TOKEN_COSTS: TokenCosts = { still: 1, clip: 8, bridge: 10 }

// How many clips may be in flight at once during a hosted Animate All. See runAnimateAll for
// why this is small rather than "as many as fal will take".
const ANIMATE_CONCURRENCY = 3

// Desktop-only view preference (rail/inspector collapsed). Deliberately separate from the
// project storage key so clearing one never disturbs the other.
const UI_PREFS_KEY = 'scenelab:ui:v1'

const EMPTY_PROJECT: Project = {
  id: '',
  title: '',
  script: '',
  characters: [],
  settings: [],
  stylePreset: 'cinematic',
  moments: [],
  transitions: [],
  createdAt: '',
  updatedAt: '',
}

// COMPOSE → REVIEW state machine. `listing` never leaves compose (failure lands inline);
// `transitioning` exists only long enough to paint the script as layoutId'd spans so
// Motion can pair them with the strip slots; waves 2/3 resolve inside `reviewing`.
type Mode = 'composing' | 'listing' | 'transitioning' | 'reviewing'

function findTransition(transitions: Transition[], fromId: string, toId: string): Transition | null {
  return transitions.find((t) => t.fromMomentId === fromId && t.toMomentId === toId) ?? null
}

// Token quotes are EXACT, not approximate: the server charges tokenCost.X per item, so there
// is no rounding to hedge against. The old USD figures were the owner's provider cost, which
// was never what the user paid — hence "≈". Nothing here should reintroduce that qualifier.
function tokens(n: number): string {
  return `${n} token${n === 1 ? '' : 's'}`
}

export default function Home() {
  const [project, setProject] = useState<Project>(EMPTY_PROJECT)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [mode, setMode] = useState<Mode>('composing')
  const [selection, setSelection] = useState<ReviewSelection>({ kind: 'moment', id: '' })

  const [momentsError, setMomentsError] = useState<string | null>(null)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  // Whether generation is actually charged. In a build without Supabase the app is the
  // original localStorage demo and nothing is metered, so quoting a price would be a lie.
  // Derived from a NEXT_PUBLIC_ var, so server and client agree and hydration is stable.
  const metered = isSupabaseConfigured()

  // Live token prices. Fetched once — they come from server env and don't change mid-session.
  // set inside .then rather than in the effect body, per react-hooks/set-state-in-effect.
  const [tokenCosts, setTokenCosts] = useState<TokenCosts>(FALLBACK_TOKEN_COSTS)
  useEffect(() => {
    let active = true
    getTokenCosts()
      .then((costs) => {
        if (active) setTokenCosts(costs)
      })
      .catch(() => {
        // Keep the fallback prices; a missing quote is worse than a default one.
      })
    return () => {
      active = false
    }
  }, [])

  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set())
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({})
  const [generatingVideoIds, setGeneratingVideoIds] = useState<Set<string>>(new Set())
  const [videoErrors, setVideoErrors] = useState<Record<string, string>>({})
  const [generatingBridgeIds, setGeneratingBridgeIds] = useState<Set<string>>(new Set())
  const [bridgeErrors, setBridgeErrors] = useState<Record<string, string>>({})

  const [queueRunning, setQueueRunning] = useState(false)
  const [animatingAll, setAnimatingAll] = useState(false)
  const [confirmAnimateAll, setConfirmAnimateAll] = useState(false)
  const [showAnimatic, setShowAnimatic] = useState(false)

  // Per-entity refine state (keyed by character/setting id) — one entity refining never
  // touches another. Each refine runs independently; results are keyed so out-of-order
  // resolutions land on the right entity.
  const [refiningIds, setRefiningIds] = useState<Set<string>>(new Set())
  const [refineSuggestions, setRefineSuggestions] = useState<Record<string, { refined: string; notes: string[] }>>({})
  const [refineErrors, setRefineErrors] = useState<Record<string, string>>({})

  // Auto-population: fires once per distinct script when panels are empty.
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const autoDetectedForRef = useRef<string | null>(null)

  const reduceMotion = useReducedMotion() ?? false
  const isDesktop = useIsDesktop()

  // Desktop rail/inspector collapse. Purely a viewing preference, so it lives in its own
  // localStorage key rather than going through project-store — it is not project data and
  // must not follow a scene from one device to another as if it were.
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const uiPrefsLoaded = useRef(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(UI_PREFS_KEY)
      if (raw) {
        const prefs = JSON.parse(raw)
        setRailCollapsed(!!prefs.rail)
        setInspectorCollapsed(!!prefs.inspector)
      }
    } catch {
      // A corrupt pref must never keep the editor from opening.
    }
    uiPrefsLoaded.current = true
  }, [])
  useEffect(() => {
    // Skip the first pass, or the defaults would overwrite the stored prefs before the
    // read above has applied them.
    if (!uiPrefsLoaded.current) return
    try {
      localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ rail: railCollapsed, inspector: inspectorCollapsed }))
    } catch {
      // Private mode / quota — collapsing still works for this session.
    }
  }, [railCollapsed, inspectorCollapsed])

  // Fresh project reads inside long-running async loops (the sequential render queue).
  const projectRef = useRef(project)
  projectRef.current = project
  // Monotonic listing token: each Generate press (and each Cancel) bumps it, and a
  // resolving breakdown only applies if its captured token is still current. A plain
  // cancelled-boolean is not enough — a cancelled request's late resolution would pass
  // the check reset by the next press and race it (two projects, two render queues).
  const listingSeqRef = useRef(0)
  const cancelRendersRef = useRef(false)
  const cancelAnimateAllRef = useRef(false)
  // One shared poller for every in-flight job (see JobWatcher): N independent pollers each
  // fired a Server Action, and every one of those re-renders the tree, which is what made the
  // status indicators churn.
  const watcherRef = useRef<JobWatcher | null>(null)
  if (watcherRef.current === null) watcherRef.current = new JobWatcher()
  // Pending (unsubmitted) jobs of the current batch, so Cancel can abandon exactly those.
  const pendingJobIdsRef = useRef<string[]>([])
  // Where the active project persists (DB row when signed in, else localStorage). Held in a
  // ref so the debounced save always reads the latest context without re-subscribing.
  const persistContextRef = useRef<PersistContext>(ANON_CONTEXT)

  // Demo mode (`/studio?demo=1`): open the pre-generated project from public/demo instead of
  // the visitor's own, and never persist it. Read from window rather than useSearchParams so
  // this page stays statically prerendered and needs no Suspense boundary.
  const demoRef = useRef(false)
  // Mirrored into state because the render needs it: a ref changing does not re-render, and
  // the read-only treatment has to be applied on the first paint, not after an edit.
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    let active = true

    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      demoRef.current = true
      setDemoMode(true)
      fetch('/demo/project.json')
        .then((res) => (res.ok ? res.json() : null))
        .then((demo: Project | null) => {
          if (!active || !demo) {
            // No demo shipped (or it failed to load) — fall through to the normal path rather
            // than leaving the editor stuck on a spinner.
            if (active) setHasLoaded(true)
            return
          }
          setProject(demo)
          if (demo.moments.length > 0) {
            setMode('reviewing')
            setSelection({ kind: 'moment', id: demo.moments[0].id })
          }
          setHasLoaded(true)
        })
      return () => {
        active = false
      }
    }

    loadActiveProject().then(({ project: existing, context }) => {
      if (!active) return
      persistContextRef.current = context
      setProject(
        existing ?? {
          ...EMPTY_PROJECT,
          id: newId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      )
      if (existing && existing.moments.length > 0) {
        setMode('reviewing')
        setSelection({ kind: 'moment', id: existing.moments[0].id })
      }
      setHasLoaded(true)
      // Reattach to anything still rendering. This is the payoff of persisting jobs: a
      // reload (or a laptop closed mid-batch) resumes instead of losing paid clips.
      if (context.userId) void resumeOpenJobs()
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- scene library ----------

  // Open a different saved scene. The debounced save writes to persistContextRef.current, so
  // that ref must be repointed at the new row BEFORE the project state lands — otherwise the
  // first autosave after switching would overwrite the scene you just left.
  async function handleOpenScene(rowId: string) {
    if (rowId === persistContextRef.current.rowId) return
    const { openScene } = await import('@/lib/project-library')
    const opened = await openScene(rowId)
    if (!opened) return

    // Leaving the demo for a real scene must also leave demo mode, or the editor would stay
    // read-only and — worse — silently stop saving their work.
    demoRef.current = false
    setDemoMode(false)
    persistContextRef.current = { ...persistContextRef.current, rowId }
    setProject(opened)
    setImageErrors({})
    setVideoErrors({})
    setBridgeErrors({})
    if (opened.moments.length > 0) {
      setMode('reviewing')
      setSelection({ kind: 'moment', id: opened.moments[0].id })
    } else {
      setMode('composing')
    }
  }

  // Start a fresh scene. rowId goes null so the next save INSERTS instead of overwriting the
  // scene that was open.
  function handleNewScene() {
    demoRef.current = false
    setDemoMode(false)
    persistContextRef.current = { ...persistContextRef.current, rowId: null }
    setProject({
      ...EMPTY_PROJECT,
      id: newId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setImageErrors({})
    setVideoErrors({})
    setBridgeErrors({})
    setMode('composing')
    setSelection({ kind: 'moment', id: '' })
  }

  // Re-drive the poller for every job left running by a previous session. Results land
  // through the same handlers a live render uses, so there is one completion path.
  async function resumeOpenJobs() {
    const open = await listOpenJobs()
    if (open.length === 0) return

    // Never-submitted clips from an interrupted batch: pick the scheduling back up rather
    // than stranding them. Nothing was charged for these yet.
    const unsubmitted = open.filter((job) => !job.submitted && job.kind === 'clip')
    if (unsubmitted.length > 0) {
      void drainPendingJobs(unsubmitted.map((job) => ({ jobId: job.jobId, targetId: job.targetId })))
    }

    for (const job of open.filter((j) => j.submitted)) {
      if (job.kind === 'bridge') {
        const [fromId] = job.targetId.split('->')
        setGeneratingBridgeIds((prev) => new Set(prev).add(fromId))
      } else {
        setGeneratingVideoIds((prev) => new Set(prev).add(job.targetId))
      }

      void watcherRef.current!.watch(job.jobId).then((polled) => {
        if (polled.ok && polled.status === 'done') {
          applyJobResult(job.kind, job.targetId, polled.result)
        } else if (!polled.ok) {
          if (job.kind === 'bridge') {
            const [fromId] = job.targetId.split('->')
            setBridgeErrors((prev) => ({ ...prev, [fromId]: polled.error }))
          } else {
            setVideoErrors((prev) => ({ ...prev, [job.targetId]: polled.error }))
          }
        }
        clearGeneratingFor(job.kind, job.targetId)
      })
    }
  }

  function clearGeneratingFor(kind: 'clip' | 'anchored' | 'bridge', targetId: string) {
    if (kind === 'bridge') {
      const [fromId] = targetId.split('->')
      setGeneratingBridgeIds((prev) => {
        const next = new Set(prev)
        next.delete(fromId)
        return next
      })
      return
    }
    setGeneratingVideoIds((prev) => {
      const next = new Set(prev)
      next.delete(targetId)
      return next
    })
  }

  // Write a resumed job's result into project state. Mirrors what the live handlers do.
  function applyJobResult(
    kind: 'clip' | 'anchored' | 'bridge',
    targetId: string,
    result: RenderJobResult
  ) {
    const now = new Date().toISOString()

    if (kind === 'bridge') {
      const [fromId, toId] = targetId.split('->')
      setProject((prev) => {
        const found = findTransition(prev.transitions, fromId, toId)
        const updated: Transition = found
          ? { ...found, mode: 'generated-bridge', videoUrl: result.videoUrl, videoStoragePath: result.videoStoragePath, transitionPrompt: result.videoPrompt, generatedAt: now }
          : {
              id: newId(),
              fromMomentId: fromId,
              toMomentId: toId,
              mode: 'generated-bridge',
              videoUrl: result.videoUrl,
              videoStoragePath: result.videoStoragePath,
              transitionPrompt: result.videoPrompt,
              bridgeDirection: null,
              generatedAt: now,
            }
        return {
          ...prev,
          transitions: found
            ? prev.transitions.map((t) => (t.id === found.id ? updated : t))
            : [...prev.transitions, updated],
          updatedAt: now,
        }
      })
      return
    }

    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) =>
        m.id === targetId
          ? {
              ...m,
              videoUrl: result.videoUrl,
              videoStoragePath: result.videoStoragePath,
              videoPrompt: result.videoPrompt,
              videoGeneratedAt: now,
              videoModel: kind === 'anchored' ? 'kling-o3-anchored' : 'kling-1.6',
              ...(kind === 'anchored' && result.endImageUrl
                ? { endImageUrl: result.endImageUrl, endImageStoragePath: result.endImageStoragePath ?? null }
                : {}),
            }
          : m
      ),
      updatedAt: now,
    }))
  }

  // Debounced persistence — a cloud save can't fire on every keystroke. localStorage saves
  // are debounced too (harmless). The save updates the context ref when a first insert
  // assigns a rowId, so subsequent saves update in place.
  useEffect(() => {
    if (!hasLoaded) return
    // The demo is a read-only exhibit. Persisting it would overwrite a visitor's own draft in
    // localStorage — or, for a signed-in user, insert the demo as one of their scenes.
    if (demoRef.current) return
    const handle = setTimeout(() => {
      saveActiveProject(project, persistContextRef.current).then((context) => {
        persistContextRef.current = context
      })
    }, 600)
    return () => clearTimeout(handle)
  }, [project, hasLoaded])

  // ---------- status derivations ----------

  const slotStatus = useCallback(
    (moment: Moment): SlotStatus => {
      if (generatingImageIds.has(moment.id)) return 'rendering'
      if (generatingVideoIds.has(moment.id)) return 'animating'
      if (moment.imageUrl) return 'done'
      if (imageErrors[moment.id]) return 'error'
      return 'pending'
    },
    [generatingImageIds, generatingVideoIds, imageErrors]
  )

  const jointStatus = useCallback(
    (from: Moment, to: Moment): JointStatus => {
      if (generatingBridgeIds.has(from.id)) return 'generating'
      if (bridgeErrors[from.id]) return 'error'
      const transition = findTransition(projectRef.current.transitions, from.id, to.id)
      if (transition?.videoUrl && transition.mode === 'generated-bridge') return 'done'
      if (!from.imageUrl || !to.imageUrl) return 'dormant'
      return 'armed'
    },
    [generatingBridgeIds, bridgeErrors]
  )

  const getTransition = useCallback(
    (fromId: string, toId: string) => findTransition(project.transitions, fromId, toId),
    [project.transitions]
  )

  // ---------- wave 1: listing + transition ----------

  async function handleGenerateStoryboard() {
    if (project.moments.some((m) => m.imageUrl) && !confirmRegenerate) {
      setConfirmRegenerate(true)
      return
    }
    setConfirmRegenerate(false)
    setMomentsError(null)
    const seq = ++listingSeqRef.current
    setMode('listing')

    // Generate-time safety net: if the user pastes and hits Generate before/without
    // auto-detection populating the panels, populate from the same extraction now so the
    // breakdown gets a cast + settings. State updates are async, so use the returned
    // values directly for this breakdown.
    let cast = project.characters
    let settings = project.settings
    if (cast.length === 0 && settings.length === 0 && project.script.trim()) {
      const detected = await runDetection(false)
      if (seq !== listingSeqRef.current) return
      if (detected) {
        cast = detected.characters
        settings = detected.settings
      }
    }

    const result = await generateMoments(project.script, cast, settings)

    // Stale resolution: cancelled, or superseded by a newer Generate press.
    if (seq !== listingSeqRef.current) return
    if (!result.ok) {
      setMomentsError(result.error)
      setMode('composing')
      return
    }

    setProject((prev) => ({
      ...prev,
      moments: result.moments,
      transitions: [],
      updatedAt: new Date().toISOString(),
    }))
    setSelection({ kind: 'moment', id: result.moments[0].id })
    setImageErrors({})
    setVideoErrors({})
    setBridgeErrors({})

    // Paint the script as layoutId'd spans for one frame, then flip modes — Motion's
    // shared-layout pairing animates spans → strip slots over the departure duration.
    setMode('transitioning')
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setMode('reviewing')
        void runRenderQueue(result.moments.map((m) => m.id))
      })
    )
  }

  function handleCancelListing() {
    listingSeqRef.current++
    setMode('composing')
  }

  // ---------- wave 2: sequential render queue ----------

  async function runRenderQueue(momentIds: string[]) {
    cancelRendersRef.current = false
    setQueueRunning(true)
    const batchId = newId().slice(0, 8)
    for (const id of momentIds) {
      if (cancelRendersRef.current) break
      const moment = projectRef.current.moments.find((m) => m.id === id)
      if (!moment || moment.imageUrl) continue
      await handleRenderFrame(moment, batchId)
    }
    setQueueRunning(false)
  }

  async function handleRenderFrame(moment: Moment, batchId?: string) {
    setGeneratingImageIds((prev) => new Set(prev).add(moment.id))
    setImageErrors((prev) => ({ ...prev, [moment.id]: '' }))

    const { stylePreset, characters, settings } = projectRef.current
    const { composeCharacterDescription, castForMoment, settingForMoment } = await import('@/lib/prompts')
    // Only the cast assigned to this moment enters the prompt; same for its setting.
    // The override passed here is the intentional user override ONLY — never the stored
    // provenance prompt (moment.imagePrompt), so a regenerate always recomposes from the
    // current cast/setting unless the user has explicitly authored an override.
    const cast = castForMoment(characters, moment.characterNames)
    const result = await generateMomentImage(
      moment,
      stylePreset,
      composeCharacterDescription(cast),
      moment.userPromptOverride,
      settingForMoment(settings, moment.locationName)?.description ?? null,
      cast.map((c) => c.name),
      batchId
    )

    if (result.ok) {
      setProject((prev) => ({
        ...prev,
        moments: prev.moments.map((m) =>
          m.id === moment.id
            ? {
                ...m,
                imageUrl: result.imageUrl,
                imageStoragePath: result.imageStoragePath,
                imagePrompt: result.imagePrompt,
                imageGeneratedAt: new Date().toISOString(),
              }
            : m
        ),
        updatedAt: new Date().toISOString(),
      }))
    } else {
      setImageErrors((prev) => ({ ...prev, [moment.id]: result.error }))
    }

    setGeneratingImageIds((prev) => {
      const next = new Set(prev)
      next.delete(moment.id)
      return next
    })
  }

  // Regenerating clears the moment's animation (it derived from the old image) and
  // bypasses the action's idempotency by nulling imageUrl.
  async function handleRegenerateImage(moment: Moment) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) =>
        m.id === moment.id
          ? { ...m, videoUrl: null, videoStoragePath: null, videoPrompt: null, videoGeneratedAt: null }
          : m
      ),
      updatedAt: new Date().toISOString(),
    }))
    await handleRenderFrame({ ...moment, imageUrl: null, imageStoragePath: null })
  }

  // ---------- animation (Kling 1.6) ----------

  // Signed-in users render through fal's QUEUE: the job is persisted server-side, so closing
  // the tab no longer destroys a paid clip. The anonymous $0 demo has no database to hold a
  // job and keeps the original blocking path.
  function isHosted(): boolean {
    return persistContextRef.current.userId !== null
  }

  // Collapse a submit + poll into the same shape the direct actions return. A 'cached' submit
  // never reached fal and cost nothing.
  async function resolveJob(
    submitted: SubmitJobResult
  ): Promise<{ ok: true; result: RenderJobResult } | { ok: false; error: string }> {
    if (!submitted.ok) return { ok: false, error: submitted.error }
    if (submitted.status === 'cached') return { ok: true, result: submitted.result }

    const polled = await watcherRef.current!.watch(submitted.jobId)
    if (!polled.ok) return { ok: false, error: polled.error }
    if (polled.status !== 'done') {
      return { ok: false, error: 'The render did not finish. Please try again.' }
    }
    return { ok: true, result: polled.result }
  }

  async function handleAnimate(moment: Moment) {
    setGeneratingVideoIds((prev) => new Set(prev).add(moment.id))
    setVideoErrors((prev) => ({ ...prev, [moment.id]: '' }))

    const result = isHosted()
      ? await resolveJob(await submitMomentVideoJob(moment, persistContextRef.current.rowId)).then((r) =>
          r.ok ? ({ ok: true as const, ...r.result }) : r
        )
      : await generateMomentVideo(moment)

    if (result.ok) {
      setProject((prev) => ({
        ...prev,
        moments: prev.moments.map((m) =>
          m.id === moment.id
            ? {
                ...m,
                videoUrl: result.videoUrl,
                videoStoragePath: result.videoStoragePath,
                videoPrompt: result.videoPrompt,
                videoGeneratedAt: new Date().toISOString(),
                videoModel: 'kling-1.6',
              }
            : m
        ),
        updatedAt: new Date().toISOString(),
      }))
    } else {
      setVideoErrors((prev) => ({ ...prev, [moment.id]: result.error }))
    }

    setGeneratingVideoIds((prev) => {
      const next = new Set(prev)
      next.delete(moment.id)
      return next
    })
  }

  async function handleReAnimate(moment: Moment) {
    await handleAnimate({ ...moment, videoUrl: null, videoStoragePath: null, videoPrompt: null })
  }

  // ---------- Animate All (batched) ----------
  //
  // Hosted runs let up to ANIMATE_CONCURRENCY clips be in flight at once. That is not a
  // relaxation of the "never parallel" rule: with the queue, submitting is a cheap HTTP call
  // and fal's scheduler owns execution, so this is N rows in their queue rather than N
  // renders hammering the endpoint. Stills stay strictly sequential (runRenderQueue).
  //
  // The window is small on purpose. Every submitted clip is billed the moment it starts, so
  // a wide window means a user who cancels after seeing the first result has already paid for
  // everything in flight. Three keeps the wall-clock win while capping that exposure.
  // Eligible = a moment that has a still but no clip yet. Completed clips are left intact;
  // a still regenerate clears its clip (handleRegenerateImage), which makes that moment
  // eligible again — so "stale" clips never linger. A failed moment keeps no videoUrl, so
  // it stays eligible and a re-run (labeled "Retry animation") picks it back up.
  function eligibleForAnimation(m: Moment): boolean {
    return !!m.imageUrl && !m.videoUrl
  }

  // Re-reads the latest project state before each item so a clip that landed (or a moment
  // that became ineligible) is skipped, and checks the cancel flag before each SUBMIT.
  //
  // Cancel stops scheduling only. Clips already submitted are paid, running work at fal, so
  // they are left to finish and land — abandoning them would burn the user's tokens for
  // nothing. Nothing here refunds on cancel; the user keeps what they bought.
  async function runAnimateAll() {
    if (animatingAll) return // guard against a duplicate batch run
    const ids = projectRef.current.moments.filter(eligibleForAnimation).map((m) => m.id)
    if (ids.length === 0) return

    if (!isHosted()) {
      // Demo mode: no database to hold the batch, so it stays a plain sequential loop.
      cancelAnimateAllRef.current = false
      setAnimatingAll(true)
      for (const id of ids) {
        if (cancelAnimateAllRef.current) break
        const moment = projectRef.current.moments.find((m) => m.id === id)
        if (!moment || !eligibleForAnimation(moment)) continue
        await handleAnimate(moment)
      }
      setAnimatingAll(false)
      return
    }

    // Record the whole batch as pending jobs BEFORE charging for any of it. This is what
    // survives a closed tab: the intent is in Postgres, not in this loop.
    const batch = await startAnimateBatch(ids, persistContextRef.current.rowId)
    if (!batch.ok) {
      setVideoErrors((prev) => ({ ...prev, [ids[0]]: batch.error }))
      return
    }
    await drainPendingJobs(batch.jobs)
  }

  // Promote pending jobs a few at a time and wait for their clips. Shared cursor: workers
  // pull the next job, so a slow clip never blocks the others. Single-threaded JS makes the
  // increment safe without a lock.
  async function drainPendingJobs(jobs: { jobId: string; targetId: string }[]) {
    cancelAnimateAllRef.current = false
    pendingJobIdsRef.current = jobs.map((j) => j.jobId)
    setAnimatingAll(true)

    let cursor = 0
    const width = Math.min(ANIMATE_CONCURRENCY, jobs.length)

    async function worker() {
      for (;;) {
        if (cancelAnimateAllRef.current) return
        const job = jobs[cursor++]
        if (job === undefined) return

        const moment = projectRef.current.moments.find((m) => m.id === job.targetId)
        if (!moment || !eligibleForAnimation(moment)) {
          // The clip landed (or the moment is gone) while this was queued. Retire the row so
          // it doesn't come back as an open job on every future load.
          void abandonPendingJobs([job.jobId])
          continue
        }

        pendingJobIdsRef.current = pendingJobIdsRef.current.filter((id) => id !== job.jobId)
        setGeneratingVideoIds((prev) => new Set(prev).add(moment.id))
        setVideoErrors((prev) => ({ ...prev, [moment.id]: '' }))

        const submitted = await submitPendingClipJob(job.jobId, moment)
        const result = await resolveJob(submitted)
        if (result.ok) {
          applyJobResult('clip', moment.id, result.result)
        } else {
          setVideoErrors((prev) => ({ ...prev, [moment.id]: result.error }))
        }
        clearGeneratingFor('clip', moment.id)
      }
    }

    await Promise.all(Array.from({ length: width }, () => worker()))
    pendingJobIdsRef.current = []
    setAnimatingAll(false)
  }

  // Cancel stops SCHEDULING. Jobs never submitted are abandoned server-side (nothing was
  // charged, so nothing is refunded); jobs already at fal are paid, running work and are left
  // to finish and land.
  function cancelAnimateAll() {
    cancelAnimateAllRef.current = true
    const unsubmitted = pendingJobIdsRef.current
    pendingJobIdsRef.current = []
    if (unsubmitted.length > 0) void abandonPendingJobs(unsubmitted)
  }

  // Dual-keyframe path: end still (FLUX, cached) + Kling O3 start→end. Same per-moment
  // busy/error state as the standard animate.
  async function handleAnimateAnchored(moment: Moment) {
    setGeneratingVideoIds((prev) => new Set(prev).add(moment.id))
    setVideoErrors((prev) => ({ ...prev, [moment.id]: '' }))

    const { stylePreset, characters, settings } = projectRef.current
    const { composeCharacterDescription, castForMoment, settingForMoment } = await import('@/lib/prompts')
    const cast = castForMoment(characters, moment.characterNames)
    const characterDescription = composeCharacterDescription(cast)
    const settingDescription = settingForMoment(settings, moment.locationName)?.description ?? null
    const castNames = cast.map((c) => c.name)

    const result = isHosted()
      ? await resolveJob(
          await submitAnchoredVideoJob(
            moment,
            stylePreset,
            characterDescription,
            settingDescription,
            castNames,
            persistContextRef.current.rowId
          )
        ).then((r) => (r.ok ? ({ ok: true as const, ...r.result }) : r))
      : await generateAnchoredMomentVideo(
          moment,
          stylePreset,
          characterDescription,
          settingDescription,
          castNames
        )

    if (result.ok) {
      setProject((prev) => ({
        ...prev,
        moments: prev.moments.map((m) =>
          m.id === moment.id
            ? {
                ...m,
                videoUrl: result.videoUrl,
                videoStoragePath: result.videoStoragePath,
                videoPrompt: result.videoPrompt,
                videoGeneratedAt: new Date().toISOString(),
                endImageUrl: result.endImageUrl,
                endImageStoragePath: result.endImageStoragePath,
                videoModel: 'kling-o3-anchored',
              }
            : m
        ),
        updatedAt: new Date().toISOString(),
      }))
    } else {
      setVideoErrors((prev) => ({ ...prev, [moment.id]: result.error }))
    }

    setGeneratingVideoIds((prev) => {
      const next = new Set(prev)
      next.delete(moment.id)
      return next
    })
  }

  // ---------- wave 3: bridges (armed, user-pulled) ----------

  async function handleGenerateBridge(fromMoment: Moment, toMoment: Moment, bridgeDirection: string, regenerate: boolean) {
    setGeneratingBridgeIds((prev) => new Set(prev).add(fromMoment.id))
    setBridgeErrors((prev) => ({ ...prev, [fromMoment.id]: '' }))

    const existing = regenerate ? null : findTransition(projectRef.current.transitions, fromMoment.id, toMoment.id)
    const direction = bridgeDirection.trim() || null

    let startFrame: string | null = null
    if (fromMoment.videoUrl && !existing?.videoUrl) {
      try {
        startFrame = await extractLastFrame(fromMoment.videoUrl)
      } catch (err) {
        setBridgeErrors((prev) => ({
          ...prev,
          [fromMoment.id]: err instanceof Error ? err.message : 'Could not capture the video frame. Please try again.',
        }))
        setGeneratingBridgeIds((prev) => {
          const next = new Set(prev)
          next.delete(fromMoment.id)
          return next
        })
        return
      }
    }

    const result = isHosted()
      ? await resolveJob(
          await submitBridgeJob(
            fromMoment,
            toMoment,
            existing,
            direction,
            startFrame,
            persistContextRef.current.rowId
          )
        ).then((r) => (r.ok ? ({ ok: true as const, ...r.result, transitionPrompt: r.result.videoPrompt }) : r))
      : await generateBridgeVideo(fromMoment, toMoment, existing, direction, startFrame)

    if (result.ok) {
      setProject((prev) => {
        const found = findTransition(prev.transitions, fromMoment.id, toMoment.id)
        const updated: Transition = found
          ? {
              ...found,
              mode: 'generated-bridge',
              videoUrl: result.videoUrl,
              videoStoragePath: result.videoStoragePath,
              transitionPrompt: result.transitionPrompt,
              bridgeDirection: direction ?? found.bridgeDirection,
              generatedAt: new Date().toISOString(),
            }
          : {
              id: newId(),
              fromMomentId: fromMoment.id,
              toMomentId: toMoment.id,
              mode: 'generated-bridge',
              videoUrl: result.videoUrl,
              videoStoragePath: result.videoStoragePath,
              transitionPrompt: result.transitionPrompt,
              bridgeDirection: direction,
              generatedAt: new Date().toISOString(),
            }
        return {
          ...prev,
          transitions: found
            ? prev.transitions.map((t) => (t.id === found.id ? updated : t))
            : [...prev.transitions, updated],
          updatedAt: new Date().toISOString(),
        }
      })
    } else {
      setBridgeErrors((prev) => ({ ...prev, [fromMoment.id]: result.error }))
    }

    setGeneratingBridgeIds((prev) => {
      const next = new Set(prev)
      next.delete(fromMoment.id)
      return next
    })
  }

  function handleSetConnectionMode(fromMoment: Moment, toMoment: Moment, newMode: ConnectionMode) {
    setProject((prev) => {
      const found = findTransition(prev.transitions, fromMoment.id, toMoment.id)
      if (!found && newMode === 'hard-cut') return prev
      const updated: Transition = found
        ? { ...found, mode: newMode }
        : {
            id: newId(),
            fromMomentId: fromMoment.id,
            toMomentId: toMoment.id,
            mode: newMode,
            videoUrl: null,
            transitionPrompt: null,
            bridgeDirection: null,
            generatedAt: null,
          }
      return {
        ...prev,
        transitions: found
          ? prev.transitions.map((t) => (t.id === found.id ? updated : t))
          : [...prev.transitions, updated],
        updatedAt: new Date().toISOString(),
      }
    })
  }

  // ---------- editing ----------

  // The PROMPT field authors an intentional override — distinct from imagePrompt
  // (provenance). Editing it makes the override current again (clears the stale flag).
  // An empty string clears the override entirely, returning to auto-composition.
  function handleEditPrompt(momentId: string, prompt: string) {
    const override = prompt.trim() ? prompt : null
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) =>
        m.id === momentId ? { ...m, userPromptOverride: override, userPromptOverrideStale: false } : m
      ),
      updatedAt: new Date().toISOString(),
    }))
  }

  // Discard the override and return to auto-composition from current canonical state.
  function handleResetPrompt(momentId: string) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) =>
        m.id === momentId ? { ...m, userPromptOverride: null, userPromptOverrideStale: false } : m
      ),
      updatedAt: new Date().toISOString(),
    }))
  }

  // Edits keep existing media (possibly stale) — regeneration is the user's explicit,
  // costed choice. Note: once imagePrompt is set, it (not the description) drives renders.
  function handleEditDescription(momentId: string, description: string) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => {
        if (m.id !== momentId) return m
        // description feeds the still only as the startFrame fallback (legacy moments),
        // so an existing override goes stale only when there is no startFrame.
        const stale = m.userPromptOverride && !m.startFrame ? true : m.userPromptOverrideStale
        return { ...m, description, userPromptOverrideStale: stale }
      }),
      updatedAt: new Date().toISOString(),
    }))
  }

  function handleAddSetting() {
    const setting: Setting = { id: newId(), name: `Location ${project.settings.length + 1}`, description: '' }
    setProject((prev) => ({ ...prev, settings: [...prev.settings, setting], updatedAt: new Date().toISOString() }))
  }

  function handleUpdateSetting(id: string, patch: Partial<Pick<Setting, 'name' | 'description'>>) {
    setProject((prev) => ({
      ...prev,
      settings: prev.settings.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      updatedAt: new Date().toISOString(),
    }))
  }

  function handleRemoveSetting(id: string) {
    setProject((prev) => ({ ...prev, settings: prev.settings.filter((s) => s.id !== id), updatedAt: new Date().toISOString() }))
  }

  function handleSetLocation(momentId: string, locationName: string | null) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) =>
        m.id === momentId
          ? { ...m, locationName, userPromptOverrideStale: m.userPromptOverride ? true : m.userPromptOverrideStale }
          : m
      ),
      updatedAt: new Date().toISOString(),
    }))
  }

  function handleEditMotion(momentId: string, motion: string) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => (m.id === momentId ? { ...m, motion } : m)),
      updatedAt: new Date().toISOString(),
    }))
  }

  // Set a moment's visual focus. An object/environment frame has no visible cast, so we
  // clear characterNames to [] — keeping frame-cast honest (project cast is untouched).
  function handleSetFocus(momentId: string, focus: VisualFocus) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => {
        if (m.id !== momentId) return m
        const clearsCast = focus === 'object' || focus === 'environment'
        return {
          ...m,
          visualFocus: focus,
          characterNames: clearsCast ? [] : m.characterNames,
          userPromptOverrideStale: m.userPromptOverride ? true : m.userPromptOverrideStale,
        }
      }),
      updatedAt: new Date().toISOString(),
    }))
  }

  // Commit a moment's composition "avoid" list (called on blur with the raw draft). Merges
  // onto the existing blocking plan (or creates a minimal one); empty input clears the list.
  // Normalization happens HERE (once, on save) — never on every keystroke.
  function handleEditAvoid(momentId: string, avoidCsv: string) {
    const avoid = parseAvoid(avoidCsv)
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => {
        if (m.id !== momentId) return m
        const blocking = { ...(m.blocking ?? {}), avoid }
        return { ...m, blocking, userPromptOverrideStale: m.userPromptOverride ? true : m.userPromptOverrideStale }
      }),
      updatedAt: new Date().toISOString(),
    }))
  }

  // Toggle a cast member in/out of a moment's frame. Legacy moments (characterNames
  // null/undefined = whole cast) materialize the full name list first, then toggle.
  function handleToggleCharacter(momentId: string, name: string) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => {
        if (m.id !== momentId) return m
        const current = m.characterNames ?? prev.characters.map((c) => c.name)
        const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name]
        return { ...m, characterNames: next, userPromptOverrideStale: m.userPromptOverride ? true : m.userPromptOverrideStale }
      }),
      updatedAt: new Date().toISOString(),
    }))
  }

  // Duration edits keep an existing clip (possibly now mismatched in length) — the user
  // can Re-Animate to get a clip that matches; stills simply hold longer in the animatic.
  function handleEditDuration(momentId: string, durationSeconds: number) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => (m.id === momentId ? { ...m, durationSeconds } : m)),
      updatedAt: new Date().toISOString(),
    }))
  }

  // Swap with neighbor and renumber. Transitions are keyed by moment-id pairs, so records
  // for pairs that stop being adjacent stop matching — and revive if the order is restored.
  function handleMoveMoment(momentId: string, direction: -1 | 1) {
    setProject((prev) => {
      const index = prev.moments.findIndex((m) => m.id === momentId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.moments.length) return prev
      const moments = [...prev.moments]
      ;[moments[index], moments[target]] = [moments[target], moments[index]]
      return {
        ...prev,
        moments: moments.map((m, i) => ({ ...m, number: i + 1 })),
        updatedAt: new Date().toISOString(),
      }
    })
  }

  // ---------- auto-population ----------

  // Runs the extraction call. Returns the detected context (also for the generate
  // fallback's synchronous use), or null on failure. `replace` overwrites existing panels
  // (manual Re-detect); otherwise it only fills when both panels are empty.
  async function runDetection(replace: boolean): Promise<{ characters: Character[]; settings: Setting[] } | null> {
    const script = projectRef.current.script
    if (!script.trim()) return null
    setDetecting(true)
    setDetectError(null)
    const result = await extractScriptContext(script)
    setDetecting(false)
    if (!result.ok) {
      setDetectError(result.error)
      return null
    }
    const characters: Character[] = result.characters.map((c) => ({ id: newId(), ...c }))
    const settings: Setting[] = result.settings.map((s) => ({ id: newId(), ...s }))
    setProject((prev) => {
      const nextCharacters = replace || prev.characters.length === 0 ? characters : prev.characters
      const nextSettings = replace || prev.settings.length === 0 ? settings : prev.settings
      return { ...prev, characters: nextCharacters, settings: nextSettings, updatedAt: new Date().toISOString() }
    })
    return { characters, settings }
  }

  // Auto-detect once per distinct script when panels are empty and there's enough text.
  // The user "arrives at a populated project" without asking.
  useEffect(() => {
    if (!hasLoaded) return
    const script = project.script.trim()
    const bothEmpty = project.characters.length === 0 && project.settings.length === 0
    const substantial = script.length >= 120
    if (
      bothEmpty &&
      substantial &&
      mode === 'composing' &&
      autoDetectedForRef.current !== script &&
      !detecting
    ) {
      autoDetectedForRef.current = script
      void runDetection(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.script, project.characters.length, project.settings.length, hasLoaded, mode])

  // ---------- cast ----------

  // Per-entity refine — character OR setting, keyed by id. Never touches other entities.
  async function handleRefine(kind: 'character' | 'setting', id: string, description: string) {
    setRefiningIds((prev) => new Set(prev).add(id))
    setRefineErrors((prev) => ({ ...prev, [id]: '' }))
    setRefineSuggestions((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    const result =
      kind === 'character'
        ? await refineCharacterDescription(projectRef.current.script, description)
        : await refineSettingDescription(projectRef.current.script, description)
    if (result.ok) {
      setRefineSuggestions((prev) => ({ ...prev, [id]: { refined: result.refined, notes: result.notes } }))
    } else {
      setRefineErrors((prev) => ({ ...prev, [id]: result.error }))
    }
    setRefiningIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function dismissSuggestion(id: string) {
    setRefineSuggestions((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function handleAddCharacter() {
    const character: Character = { id: newId(), name: `Character ${project.characters.length + 1}`, description: '' }
    setProject((prev) => ({ ...prev, characters: [...prev.characters, character], updatedAt: new Date().toISOString() }))
  }

  function handleUpdateCharacter(id: string, patch: Partial<Pick<Character, 'name' | 'description'>>) {
    setProject((prev) => ({
      ...prev,
      characters: prev.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      updatedAt: new Date().toISOString(),
    }))
  }

  function handleRemoveCharacter(id: string) {
    setProject((prev) => ({ ...prev, characters: prev.characters.filter((c) => c.id !== id), updatedAt: new Date().toISOString() }))
    dismissSuggestion(id)
  }

  // ---------- render ----------

  const hasFrames = project.moments.some((m) => m.imageUrl)
  const pendingCount = project.moments.filter((m) => !m.imageUrl).length
  const railMode = mode === 'reviewing' || mode === 'transitioning' ? 'review' : 'compose'
  const anyGenerating =
    generatingImageIds.size > 0 ||
    generatingVideoIds.size > 0 ||
    generatingBridgeIds.size > 0 ||
    queueRunning ||
    animatingAll

  // Animate All bookkeeping.
  const animatableCount = project.moments.filter((m) => m.imageUrl && !m.videoUrl).length
  const animatedCount = project.moments.filter((m) => m.videoUrl).length
  const failedAnimationCount = project.moments.filter((m) => m.imageUrl && !m.videoUrl && videoErrors[m.id]).length
  // Which moments are animating, in storyboard order. Previously this showed only
  // `[...generatingVideoIds][0]`, whose value jumps as Set membership changes — with three
  // clips in flight the number flickered instead of reporting anything.
  const animatingNumbers = project.moments
    .filter((m) => generatingVideoIds.has(m.id))
    .map((m) => m.number)
  const queuedToAnimate = Math.max(animatableCount - animatingNumbers.length, 0)

  // Exactly one Inspector exists at any width. It holds local draft state, so mounting a
  // second (hidden) copy would let a stale draft resurface on resize — hence a node handed
  // to whichever slot is live, rather than two renders gated by CSS.
  const inspectorNode = (
    <Inspector
      selection={selection}
      project={project}
      getTransition={getTransition}
      slotStatus={slotStatus}
      jointStatus={jointStatus}
      onEditPrompt={handleEditPrompt}
      onResetPrompt={handleResetPrompt}
      onEditDescription={handleEditDescription}
      onEditDuration={handleEditDuration}
      onToggleCharacter={handleToggleCharacter}
      onSetFocus={handleSetFocus}
      onEditAvoid={handleEditAvoid}
      onSetLocation={handleSetLocation}
      onEditMotion={handleEditMotion}
      onMove={handleMoveMoment}
      onRender={handleRenderFrame}
      onRegenerateImage={handleRegenerateImage}
      onAnimate={handleAnimate}
      onAnimateAnchored={handleAnimateAnchored}
      onReAnimate={handleReAnimate}
      onSetConnectionMode={handleSetConnectionMode}
      onGenerateBridge={handleGenerateBridge}
      errors={{
        image: selection.kind === 'moment' ? imageErrors[selection.id] || undefined : undefined,
        video: selection.kind === 'moment' ? videoErrors[selection.id] || undefined : undefined,
        bridge: selection.kind === 'joint' ? bridgeErrors[selection.fromId] || undefined : undefined,
      }}
    />
  )
  const inspectorLive = mode === 'reviewing' && !showAnimatic

  return (
    <MotionConfig transition={reduceMotion ? { duration: 0.2 } : { duration: 0.5, ease: [0.4, 0, 0.2, 1] }}>
      {/* Review is a fixed-viewport editor (as it already was on desktop), so it needs a
          DEFINITE height — `min-h-svh` is only a minimum, which lets `main`'s flex-1 grow
          past the viewport and pushes the thumbnail strip out of reach behind
          `overflow-hidden`. Compose keeps min-h-svh so it can grow and scroll normally. */}
      <div
        className={`flex w-full flex-col lg:flex-row ${
          mode === 'reviewing' ? 'h-svh overflow-hidden' : 'min-h-svh'
        }`}
      >
        <LeftRail
          project={project}
          mode={railMode}
          hasFrames={hasFrames}
          onShowAnimatic={() => setShowAnimatic(true)}
          onEnterReview={() => {
            if (project.moments.length > 0) {
              setSelection({ kind: 'moment', id: project.moments[0].id })
              setMode('reviewing')
            }
          }}
          onBackToCompose={() => setMode('composing')}
          activeRowId={persistContextRef.current.rowId}
          onOpenScene={handleOpenScene}
          onNewScene={handleNewScene}
          generating={anyGenerating}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((c) => !c)}
        />

        <MobileBar
          project={project}
          mode={railMode}
          hasFrames={hasFrames}
          onShowAnimatic={() => setShowAnimatic(true)}
          onEnterReview={() => {
            if (project.moments.length > 0) {
              setSelection({ kind: 'moment', id: project.moments[0].id })
              setMode('reviewing')
            }
          }}
          onBackToCompose={() => setMode('composing')}
          activeRowId={persistContextRef.current.rowId}
          onOpenScene={handleOpenScene}
          onNewScene={handleNewScene}
          generating={anyGenerating}
          showDetails={inspectorLive}
          inspector={
            isDesktop ? null : (
              // Same demo-mode lockout the desktop column applies — the sheet is the only
              // way to reach the paid generate buttons on a phone.
              <div inert={demoMode} className={demoMode ? 'opacity-60' : ''}>
                {inspectorNode}
              </div>
            )
          }
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Without this, locked controls just look broken. Lives INSIDE main and in flow at
              every width. It used to be `fixed top-0`, which laid the pill straight over the
              storyboard toolbar and made "Watch sequence ▶" — the demo's whole point —
              unclickable. It must stay inside this column rather than beside it: the outer
              wrapper is lg:flex-row, so a sibling here becomes a full-height row child and the
              rounded pill renders as a giant ellipse next to the rail. */}
          {demoMode ? (
            <div className="pointer-events-none z-50 flex shrink-0 justify-center px-4 py-3">
              <div className="pointer-events-auto flex max-w-full flex-col items-center gap-1 rounded-2xl border border-white/15 bg-black/80 px-4 py-1.5 text-center text-[12px] text-[var(--muted-foreground)] backdrop-blur sm:flex-row sm:gap-3 sm:rounded-full sm:text-left">
                <span>Demo — a finished scene, read-only. Play it, browse the shots, export it.</span>
                <a href="/sign-up" className="text-foreground underline underline-offset-2">
                  Make your own
                </a>
              </div>
            </div>
          ) : null}

          <AnimatePresence initial={false} mode="wait">
            {mode !== 'reviewing' ? (
              <motion.div
                key="compose"
                exit={{ opacity: 0 }}
                // `inert` disables the whole subtree in one place — every input, textarea, and
                // button inside becomes unfocusable, unclickable, and hidden from assistive
                // tech. Cheaper and far harder to get wrong than threading a `readOnly` prop
                // through every control, and it cannot be missed when a new control is added.
                inert={demoMode}
                className={`mx-auto flex w-full max-w-[640px] flex-col gap-10 px-4 py-8 lg:px-6 lg:py-16 ${
                  demoMode ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="script" className="text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]">
                    SCRIPT
                  </Label>
                  {mode === 'transitioning' ? (
                    // The textarea can't fragment — swap in a visually equivalent span
                    // rendering so mapped spans can fly to their strip slots.
                    <div className="min-h-28 rounded-2xl bg-input/50 px-3 py-2 text-sm leading-6 whitespace-pre-wrap">
                      {renderScriptSpans(project, reduceMotion)}
                    </div>
                  ) : (
                    <Textarea
                      id="script"
                      value={project.script}
                      onChange={(e) => setProject((prev) => ({ ...prev, script: e.target.value }))}
                      placeholder="Paste your short-form video script here…"
                      rows={4}
                      disabled={mode === 'listing'}
                      className="field-sizing-content max-h-80 min-h-28 text-sm leading-6 transition-[min-height] duration-200 focus-visible:min-h-40"
                    />
                  )}
                </div>

                <motion.div animate={{ opacity: mode === 'transitioning' ? 0 : 1 }} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <p className="text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]">CAST</p>
                    {detecting && project.characters.length === 0 ? (
                      <p className="text-[12px] text-[var(--text-tertiary)]">Detecting cast & settings…</p>
                    ) : null}
                    {project.script.trim() ? (
                      <button
                        type="button"
                        onClick={() => runDetection(true)}
                        disabled={detecting}
                        title="Re-run detection and replace the current cast & settings"
                        className="ml-auto text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        {detecting ? 'Detecting…' : 'Re-detect ✦'}
                      </button>
                    ) : null}
                  </div>
                  {project.characters.map((c) => (
                    <div key={c.id} className="flex flex-col gap-1.5">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={c.name}
                          onChange={(e) => handleUpdateCharacter(c.id, { name: e.target.value })}
                          placeholder="Name"
                          className="w-full sm:w-36"
                          aria-label="Character name"
                        />
                        <Textarea
                          value={c.description}
                          onChange={(e) => handleUpdateCharacter(c.id, { description: e.target.value })}
                          placeholder="Visual description"
                          rows={1}
                          className="field-sizing-content max-h-32 min-h-8 flex-1 text-sm"
                          aria-label={`Description for ${c.name || 'character'}`}
                        />
                      </div>
                      {isDescriptionWeak(c.description) ? (
                        <p className="pl-1 text-[11px] text-[var(--text-tertiary)]">
                          ⚠ Description is too short and may produce inconsistent generations.
                        </p>
                      ) : null}
                      <div className="flex gap-3 pl-1">
                        <button
                          type="button"
                          onClick={() => handleRefine('character', c.id, c.description)}
                          disabled={refiningIds.has(c.id) || (!project.script.trim() && !c.description.trim())}
                          className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:opacity-40"
                        >
                          {refiningIds.has(c.id) ? 'Refining…' : 'Refine with AI ✦'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveCharacter(c.id)}
                          className="text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-foreground"
                        >
                          Remove
                        </button>
                      </div>
                      {refineErrors[c.id] ? <p className="pl-1 text-xs text-destructive">{refineErrors[c.id]}</p> : null}
                      {refineSuggestions[c.id] ? (
                        <SuggestionCard
                          suggestion={refineSuggestions[c.id]}
                          onUse={() => {
                            handleUpdateCharacter(c.id, { description: refineSuggestions[c.id].refined })
                            dismissSuggestion(c.id)
                          }}
                          onDismiss={() => dismissSuggestion(c.id)}
                        />
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleAddCharacter}
                    className="self-start text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-foreground"
                  >
                    + Add character
                  </button>

                  <div className="mt-2 flex flex-col gap-3">
                    <p className="text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]">SETTINGS</p>
                    {project.settings.map((s) => (
                      <div key={s.id} className="flex flex-col gap-1.5">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            value={s.name}
                            onChange={(e) => handleUpdateSetting(s.id, { name: e.target.value })}
                            placeholder="Location name"
                            className="w-full sm:w-44"
                            aria-label="Setting name"
                          />
                          <Textarea
                            value={s.description}
                            onChange={(e) => handleUpdateSetting(s.id, { description: e.target.value })}
                            placeholder="Visual description of this location"
                            rows={1}
                            className="field-sizing-content max-h-32 min-h-8 flex-1 text-sm"
                            aria-label={`Description for ${s.name || 'setting'}`}
                          />
                        </div>
                        {isDescriptionWeak(s.description) ? (
                          <p className="pl-1 text-[11px] text-[var(--text-tertiary)]">
                            ⚠ Description is too short and may produce inconsistent generations.
                          </p>
                        ) : null}
                        <div className="flex gap-3 pl-1">
                          <button
                            type="button"
                            onClick={() => handleRefine('setting', s.id, s.description)}
                            disabled={refiningIds.has(s.id) || (!project.script.trim() && !s.description.trim())}
                            className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:opacity-40"
                          >
                            {refiningIds.has(s.id) ? 'Refining…' : 'Refine with AI ✦'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveSetting(s.id)}
                            className="text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-foreground"
                          >
                            Remove
                          </button>
                        </div>
                        {refineErrors[s.id] ? <p className="pl-1 text-xs text-destructive">{refineErrors[s.id]}</p> : null}
                        {refineSuggestions[s.id] ? (
                          <SuggestionCard
                            suggestion={refineSuggestions[s.id]}
                            onUse={() => {
                              handleUpdateSetting(s.id, { description: refineSuggestions[s.id].refined })
                              dismissSuggestion(s.id)
                            }}
                            onDismiss={() => dismissSuggestion(s.id)}
                          />
                        ) : null}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddSetting}
                      className="self-start text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-foreground"
                    >
                      + Add setting
                    </button>
                    {detectError ? <p className="text-xs text-destructive">{detectError}</p> : null}
                  </div>

                  <div className="mt-2 flex flex-col gap-1.5">
                    <p className="text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]">STYLE</p>
                    <Select
                      value={project.stylePreset}
                      onValueChange={(value) => setProject((prev) => ({ ...prev, stylePreset: value as StylePreset }))}
                    >
                      <SelectTrigger className="w-48" size="sm">
                        <SelectValue>{STYLE_PRESETS.find((p) => p.value === project.stylePreset)?.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STYLE_PRESETS.map((preset) => (
                          <SelectItem key={preset.value} value={preset.value}>
                            {preset.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    {confirmRegenerate ? (
                      <div className="flex items-center gap-2">
                        <p className="flex-1 text-sm text-[var(--muted-foreground)]">
                          Regenerating replaces all {project.moments.length} moments and discards rendered frames and
                          bridges. Continue?
                        </p>
                        <Button size="sm" onClick={handleGenerateStoryboard}>
                          Replace
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRegenerate(false)}>
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <Button
                            onClick={handleGenerateStoryboard}
                            disabled={!project.script.trim() || mode === 'listing' || anyGenerating}
                          >
                            {mode === 'listing' ? 'Breaking down script…' : 'Generate Storyboard'}
                          </Button>
                          {mode === 'listing' ? (
                            <Button variant="ghost" size="sm" onClick={handleCancelListing}>
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                        <p className="text-[12px] text-[var(--text-tertiary)]">
                          8–12 shots
                          {metered
                            ? ` · then ${8 * tokenCosts.still}–${tokens(12 * tokenCosts.still)} to render all stills`
                            : null}
                        </p>
                      </>
                    )}
                    {momentsError ? <p className="text-sm text-destructive">{momentsError}</p> : null}
                  </div>
                </motion.div>
              </motion.div>
            ) : (
              <motion.div
                key="review"
                initial={{ opacity: reduceMotion ? 0 : 1 }}
                animate={{ opacity: 1 }}
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:h-svh lg:flex-row"
              >
                {/* Center workspace — only the width left after the left rail and the
                    inspector. min-w-0 is what lets the thumbnail rail scroll horizontally
                    inside this column instead of overflowing under the inspector. */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-4 lg:px-8 lg:py-6">
                {/* flex-wrap matters here: this row inlines long confirmation sentences
                    ("Cancel stops the ones that haven't started…") that otherwise force
                    horizontal overflow on a phone instead of wrapping. */}
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]">STORYBOARD</p>
                  {queueRunning ? (
                    <button
                      type="button"
                      onClick={() => {
                        cancelRendersRef.current = true
                      }}
                      className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
                    >
                      Cancel renders ({pendingCount} left)
                    </button>
                  ) : pendingCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => runRenderQueue(project.moments.map((m) => m.id))}
                      disabled={animatingAll}
                      className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:opacity-40"
                    >
                      Render remaining ({pendingCount})
                      {metered ? ` · ${tokens(pendingCount * tokenCosts.still)}` : null}
                    </button>
                  ) : null}

                  {/* Animate All — leads the storyboard toward one continuous video. */}
                  {animatingAll ? (
                    <>
                      <span className="text-[12px] text-[var(--text-tertiary)]">
                        {animatingNumbers.length > 0
                          ? `Rendering moment${animatingNumbers.length > 1 ? 's' : ''} ${animatingNumbers.join(', ')}`
                          : 'Starting…'}
                        {queuedToAnimate > 0 ? ` · ${queuedToAnimate} queued` : ''} · {animatedCount} done
                      </span>
                      <button
                        type="button"
                        onClick={cancelAnimateAll}
                        className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
                      >
                        Cancel
                      </button>
                      {/* Cancel stops scheduling, but clips already sent to the provider are
                          paid and will finish — say so before they click, not after. */}
                      <span className="text-[12px] text-[var(--text-tertiary)]">
                        Cancel stops the ones that haven’t started. Clips already running finish and stay charged —
                        their tokens aren’t refunded.
                      </span>
                    </>
                  ) : animatableCount > 0 ? (
                    confirmAnimateAll ? (
                      <>
                        <span className="text-[12px] text-[var(--text-tertiary)]">
                          Animate {animatableCount}? Up to {ANIMATE_CONCURRENCY} render at once. Cancelling stops
                          only the ones that haven’t started — anything already running is charged and not refunded.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmAnimateAll(false)
                            void runAnimateAll()
                          }}
                          className="text-[12px] text-foreground transition-colors hover:text-foreground"
                        >
                          Animate{metered ? ` · ${tokens(animatableCount * tokenCosts.clip)}` : ''}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmAnimateAll(false)}
                          className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
                        >
                          Keep editing
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmAnimateAll(true)}
                        disabled={queueRunning || generatingVideoIds.size > 0}
                        className="text-[12px] text-foreground/80 transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        {failedAnimationCount > 0
                          ? `Retry animation (${failedAnimationCount} failed)`
                          : `Animate all (${animatableCount})`}
                        {metered ? ` · ${tokens(animatableCount * tokenCosts.clip)}` : null}
                      </button>
                    )
                  ) : animatedCount > 0 ? (
                    <>
                      <span className="text-[12px] text-[var(--text-tertiary)]">All {animatedCount} animated ✓</span>
                      {/* Every eligible moment has a clip — offer to play the whole sequence. */}
                      <button
                        type="button"
                        onClick={() => setShowAnimatic(true)}
                        className="text-[12px] text-foreground/80 transition-colors hover:text-foreground"
                      >
                        Watch sequence ▶
                      </button>
                    </>
                  ) : null}
                </div>

                {showAnimatic ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <AnimaticPlayer key={project.updatedAt} project={project} onClose={() => setShowAnimatic(false)} />
                  </div>
                ) : (
                  <div className="min-h-0 flex-1">
                    <HeroCanvas
                      selection={selection}
                      moments={project.moments}
                      getTransition={getTransition}
                      slotStatus={slotStatus}
                      onRetry={handleRenderFrame}
                      errorFor={(id) => imageErrors[id] || undefined}
                    />
                  </div>
                )}

                  {/* Thumbnail rail — contained in the center column; ReviewStrip's own
                      overflow-x-auto scrolls it when the shots don't fit. shrink-0 keeps its
                      height so it never squeezes the stage. */}
                  <div className="min-w-0 shrink-0">
                    <ReviewStrip
                      moments={project.moments}
                      getTransition={getTransition}
                      slotStatus={slotStatus}
                      jointStatus={jointStatus}
                      selection={selection}
                      onSelect={setSelection}
                      animate={!reduceMotion}
                    />
                  </div>
                </div>

                {/* Inspector — its own full-height column with independent vertical scroll,
                    so a long Description/Motion/Prompt never clips the Generation section and
                    never overlaps the thumbnail rail. Hidden while the animatic is playing. */}
                {/* Rendered only on desktop — deliberately not `hidden lg:block`, which would
                    still mount a second Inspector. Below lg the same node lives in the mobile
                    bar's bottom sheet, which is why the collapse handle is desktop-only. */}
                {inspectorLive && isDesktop ? (
                  inspectorCollapsed ? (
                    <div className="flex h-svh w-10 shrink-0 flex-col items-center border-l border-white/10 py-6">
                      <CollapseHandle
                        side="right"
                        collapsed
                        onToggle={() => setInspectorCollapsed(false)}
                        label="Expand inspector"
                      />
                    </div>
                  ) : (
                    // The handle sits outside the scroll container so it stays put while the
                    // panel scrolls; the extra top padding is what keeps it off the SHOT row's
                    // ◀ ▶ reorder buttons.
                    <div className="relative flex h-svh min-h-0 shrink-0 flex-col border-l border-white/10">
                      <CollapseHandle
                        side="right"
                        collapsed={false}
                        onToggle={() => setInspectorCollapsed(true)}
                        label="Collapse inspector"
                        className="absolute top-4 right-3 z-10"
                      />
                      {/* Inert in demo mode: the inspector is where every edit and every paid
                          generate button lives. Selecting moments in the strip still works, so
                          the panel keeps showing each shot's details — just not changing them. */}
                      <div
                        inert={demoMode}
                        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pt-14 pb-6 ${
                          demoMode ? 'opacity-60' : ''
                        }`}
                      >
                        {inspectorNode}
                      </div>
                    </div>
                  )
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </MotionConfig>
  )
}

// Fragments the script into layoutId'd spans (mapped moments fly to their strip slots)
// and plain text (fades with the compose container). Null spans and gaps render plain.
function renderScriptSpans(project: Project, reduceMotion: boolean) {
  const { script, moments } = project
  const nodes: React.ReactNode[] = []
  let cursor = 0
  const spanned = moments
    .filter((m): m is Moment & { scriptSpan: { start: number; end: number } } => Boolean(m.scriptSpan))
    .sort((a, b) => a.scriptSpan.start - b.scriptSpan.start)

  for (const moment of spanned) {
    const { start, end } = moment.scriptSpan
    if (start > cursor) nodes.push(<span key={`gap-${cursor}`}>{script.slice(cursor, start)}</span>)
    nodes.push(
      <motion.span
        key={`shot-${moment.id}`}
        layoutId={reduceMotion ? undefined : `shot-${moment.id}`}
        className="inline"
      >
        {script.slice(start, end)}
      </motion.span>
    )
    cursor = end
  }
  if (cursor < script.length) nodes.push(<span key="tail">{script.slice(cursor)}</span>)
  return nodes
}

// Shared refine suggestion card (character + setting rows).
function SuggestionCard({
  suggestion,
  onUse,
  onDismiss,
}: {
  suggestion: { refined: string; notes: string[] }
  onUse: () => void
  onDismiss: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 p-3">
      <p className="text-sm">{suggestion.refined}</p>
      {suggestion.notes.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-[var(--muted-foreground)]">
          {suggestion.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={onUse}>
          Use this
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Keep mine
        </Button>
      </div>
    </div>
  )
}
