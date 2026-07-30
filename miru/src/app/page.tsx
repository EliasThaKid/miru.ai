'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { generateMoments } from '@/app/actions/generate-moments'
import { generateMomentImage } from '@/app/actions/generate-image'
import { generateMomentVideo } from '@/app/actions/generate-moment-video'
import { generateAnchoredMomentVideo } from '@/app/actions/generate-anchored-video'
import { generateBridgeVideo } from '@/app/actions/generate-bridge'
import { extractScriptContext } from '@/app/actions/extract-context'
import { refineCharacterDescription, refineSettingDescription } from '@/app/actions/refine-character'
import { AnimaticPlayer } from '@/components/animatic-player'
import { HeroCanvas } from '@/components/hero-canvas'
import { Inspector } from '@/components/inspector'
import { LeftRail } from '@/components/left-rail'
import { ReviewStrip, type JointStatus, type ReviewSelection, type SlotStatus } from '@/components/review-strip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { extractLastFrame } from '@/lib/extract-frame'
import { isDescriptionWeak, parseAvoid } from '@/lib/prompts'
import { loadProject, saveProject } from '@/lib/storage'
import type { Character, ConnectionMode, Moment, Project, Setting, StylePreset, Transition, VisualFocus } from '@/types'

// Extends the Server Action timeout for this page — Kling 1.6 (generateMomentVideo)
// typically takes 2-5 minutes and Kling O3 bridges ~1-2; the other actions finish in seconds.
export const maxDuration = 300

const STYLE_PRESETS: { value: StylePreset; label: string }[] = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'anime', label: 'Anime' },
  { value: 'illustrated', label: 'Illustrated' },
  { value: 'hyper-realistic', label: 'Hyper-Realistic' },
]

// Ballpark FLUX cost per image — labeled "≈" in the UI.
const ESTIMATED_COST_PER_IMAGE_USD = 0.04
// Ballpark Kling 1.6 cost per 5s clip — labeled "≈" in the UI.
const ESTIMATED_COST_PER_VIDEO_USD = 0.4

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

export default function Home() {
  const [project, setProject] = useState<Project>(EMPTY_PROJECT)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [mode, setMode] = useState<Mode>('composing')
  const [selection, setSelection] = useState<ReviewSelection>({ kind: 'moment', id: '' })

  const [momentsError, setMomentsError] = useState<string | null>(null)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set())
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({})
  const [generatingVideoIds, setGeneratingVideoIds] = useState<Set<string>>(new Set())
  const [videoErrors, setVideoErrors] = useState<Record<string, string>>({})
  const [generatingBridgeIds, setGeneratingBridgeIds] = useState<Set<string>>(new Set())
  const [bridgeErrors, setBridgeErrors] = useState<Record<string, string>>({})

  const [queueRunning, setQueueRunning] = useState(false)
  const [animatingAll, setAnimatingAll] = useState(false)
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

  useEffect(() => {
    const existing = loadProject()
    // settings arrived after storage v3 shipped — normalize older v3 saves.
    if (existing && !Array.isArray(existing.settings)) existing.settings = []
    setProject(
      existing ?? {
        ...EMPTY_PROJECT,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    )
    if (existing && existing.moments.length > 0) {
      setMode('reviewing')
      setSelection({ kind: 'moment', id: existing.moments[0].id })
    }
    setHasLoaded(true)
  }, [])

  useEffect(() => {
    if (hasLoaded) saveProject(project)
  }, [project, hasLoaded])

  // ---------- status derivations ----------

  const slotStatus = useCallback(
    (moment: Moment): SlotStatus => {
      if (generatingImageIds.has(moment.id)) return 'rendering'
      if (moment.imageUrl) return 'done'
      if (imageErrors[moment.id]) return 'error'
      return 'pending'
    },
    [generatingImageIds, imageErrors]
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
    const batchId = crypto.randomUUID().slice(0, 8)
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
            ? { ...m, imageUrl: result.imageUrl, imagePrompt: result.imagePrompt, imageGeneratedAt: new Date().toISOString() }
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
        m.id === moment.id ? { ...m, videoUrl: null, videoPrompt: null, videoGeneratedAt: null } : m
      ),
      updatedAt: new Date().toISOString(),
    }))
    await handleRenderFrame({ ...moment, imageUrl: null })
  }

  // ---------- animation (Kling 1.6) ----------

  async function handleAnimate(moment: Moment) {
    setGeneratingVideoIds((prev) => new Set(prev).add(moment.id))
    setVideoErrors((prev) => ({ ...prev, [moment.id]: '' }))

    const result = await generateMomentVideo(moment)

    if (result.ok) {
      setProject((prev) => ({
        ...prev,
        moments: prev.moments.map((m) =>
          m.id === moment.id
            ? {
                ...m,
                videoUrl: result.videoUrl,
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
    await handleAnimate({ ...moment, videoUrl: null, videoPrompt: null })
  }

  // ---------- Animate All (sequential batch) ----------
  // Eligible = a moment that has a still but no clip yet. Completed clips are left intact;
  // a still regenerate clears its clip (handleRegenerateImage), which makes that moment
  // eligible again — so "stale" clips never linger. A failed moment keeps no videoUrl, so
  // it stays eligible and a re-run (labeled "Retry animation") picks it back up.
  function eligibleForAnimation(m: Moment): boolean {
    return !!m.imageUrl && !m.videoUrl
  }

  // Sequential per the Kling rate rule (never parallel). Re-reads the latest project state
  // each step so a clip that landed (or a moment that became ineligible) is skipped, and
  // honors the cancel flag between items (in-flight clip still completes and is kept).
  async function runAnimateAll() {
    if (animatingAll) return // guard against a duplicate batch run
    const ids = projectRef.current.moments.filter(eligibleForAnimation).map((m) => m.id)
    if (ids.length === 0) return
    cancelAnimateAllRef.current = false
    setAnimatingAll(true)
    for (const id of ids) {
      if (cancelAnimateAllRef.current) break
      const moment = projectRef.current.moments.find((m) => m.id === id)
      if (!moment || !eligibleForAnimation(moment)) continue
      await handleAnimate(moment)
    }
    setAnimatingAll(false)
  }

  // Dual-keyframe path: end still (FLUX, cached) + Kling O3 start→end. Same per-moment
  // busy/error state as the standard animate.
  async function handleAnimateAnchored(moment: Moment) {
    setGeneratingVideoIds((prev) => new Set(prev).add(moment.id))
    setVideoErrors((prev) => ({ ...prev, [moment.id]: '' }))

    const { stylePreset, characters, settings } = projectRef.current
    const { composeCharacterDescription, castForMoment, settingForMoment } = await import('@/lib/prompts')
    const cast = castForMoment(characters, moment.characterNames)
    const result = await generateAnchoredMomentVideo(
      moment,
      stylePreset,
      composeCharacterDescription(cast),
      settingForMoment(settings, moment.locationName)?.description ?? null,
      cast.map((c) => c.name)
    )

    if (result.ok) {
      setProject((prev) => ({
        ...prev,
        moments: prev.moments.map((m) =>
          m.id === moment.id
            ? {
                ...m,
                videoUrl: result.videoUrl,
                videoPrompt: result.videoPrompt,
                videoGeneratedAt: new Date().toISOString(),
                endImageUrl: result.endImageUrl,
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

    const result = await generateBridgeVideo(fromMoment, toMoment, existing, direction, startFrame)

    if (result.ok) {
      setProject((prev) => {
        const found = findTransition(prev.transitions, fromMoment.id, toMoment.id)
        const updated: Transition = found
          ? {
              ...found,
              mode: 'generated-bridge',
              videoUrl: result.videoUrl,
              transitionPrompt: result.transitionPrompt,
              bridgeDirection: direction ?? found.bridgeDirection,
              generatedAt: new Date().toISOString(),
            }
          : {
              id: crypto.randomUUID(),
              fromMomentId: fromMoment.id,
              toMomentId: toMoment.id,
              mode: 'generated-bridge',
              videoUrl: result.videoUrl,
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
            id: crypto.randomUUID(),
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
    const setting: Setting = { id: crypto.randomUUID(), name: `Location ${project.settings.length + 1}`, description: '' }
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
    const characters: Character[] = result.characters.map((c) => ({ id: crypto.randomUUID(), ...c }))
    const settings: Setting[] = result.settings.map((s) => ({ id: crypto.randomUUID(), ...s }))
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
    const character: Character = { id: crypto.randomUUID(), name: `Character ${project.characters.length + 1}`, description: '' }
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
  const animatingId = [...generatingVideoIds][0]
  const animatingNumber = animatingId ? project.moments.find((m) => m.id === animatingId)?.number : undefined

  return (
    <MotionConfig transition={reduceMotion ? { duration: 0.2 } : { duration: 0.5, ease: [0.4, 0, 0.2, 1] }}>
      <div className="flex min-h-svh w-full">
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
        />

        <main className="min-w-0 flex-1">
          <AnimatePresence initial={false} mode="wait">
            {mode !== 'reviewing' ? (
              <motion.div
                key="compose"
                exit={{ opacity: 0 }}
                className="mx-auto flex w-full max-w-[640px] flex-col gap-10 px-6 py-16"
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
                      <div className="flex gap-2">
                        <Input
                          value={c.name}
                          onChange={(e) => handleUpdateCharacter(c.id, { name: e.target.value })}
                          placeholder="Name"
                          className="w-36"
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
                        <div className="flex gap-2">
                          <Input
                            value={s.name}
                            onChange={(e) => handleUpdateSetting(s.id, { name: e.target.value })}
                            placeholder="Location name"
                            className="w-44"
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
                          8–12 shots · then ≈ ${(8 * ESTIMATED_COST_PER_IMAGE_USD).toFixed(2)}–
                          {(12 * ESTIMATED_COST_PER_IMAGE_USD).toFixed(2)} to render all stills
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
                className="flex h-svh min-w-0 overflow-hidden"
              >
                {/* Center workspace — only the width left after the left rail and the
                    inspector. min-w-0 is what lets the thumbnail rail scroll horizontally
                    inside this column instead of overflowing under the inspector. */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden px-8 py-6">
                <div className="flex items-center gap-3">
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
                      Render remaining ({pendingCount}) ≈ ${(pendingCount * ESTIMATED_COST_PER_IMAGE_USD).toFixed(2)}
                    </button>
                  ) : null}

                  {/* Animate All — leads the storyboard toward one continuous video. */}
                  {animatingAll ? (
                    <>
                      <span className="text-[12px] text-[var(--text-tertiary)]">
                        Animating{animatingNumber ? ` moment ${animatingNumber}` : ''}… ({animatableCount} left)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          cancelAnimateAllRef.current = true
                        }}
                        className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </>
                  ) : animatableCount > 0 ? (
                    <button
                      type="button"
                      onClick={runAnimateAll}
                      disabled={queueRunning || generatingVideoIds.size > 0}
                      className="text-[12px] text-foreground/80 transition-colors hover:text-foreground disabled:opacity-40"
                    >
                      {failedAnimationCount > 0
                        ? `Retry animation (${failedAnimationCount} failed)`
                        : `Animate all (${animatableCount})`}{' '}
                      ≈ ${(animatableCount * ESTIMATED_COST_PER_VIDEO_USD).toFixed(2)}
                    </button>
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
                {!showAnimatic ? (
                  <div className="h-svh min-h-0 shrink-0 overflow-y-auto overflow-x-hidden border-l border-white/10 px-5 py-6">
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
                  </div>
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
