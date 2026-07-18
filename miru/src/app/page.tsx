'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { generateMoments } from '@/app/actions/generate-moments'
import { generateMomentImage } from '@/app/actions/generate-image'
import { generateMomentVideo } from '@/app/actions/generate-moment-video'
import { generateBridgeVideo } from '@/app/actions/generate-bridge'
import { refineCharacterDescription } from '@/app/actions/refine-character'
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
import { loadProject, saveProject } from '@/lib/storage'
import type { Character, ConnectionMode, Moment, Project, StylePreset, Transition } from '@/types'

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

const EMPTY_PROJECT: Project = {
  id: '',
  title: '',
  script: '',
  characters: [],
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
  const [showAnimatic, setShowAnimatic] = useState(false)

  const [isRefining, setIsRefining] = useState(false)
  const [refineSuggestion, setRefineSuggestion] = useState<{
    characterId: string
    refined: string
    notes: string[]
  } | null>(null)
  const [refineError, setRefineError] = useState<string | null>(null)

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

  useEffect(() => {
    const existing = loadProject()
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

    const result = await generateMoments(project.script, project.characters)

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
    for (const id of momentIds) {
      if (cancelRendersRef.current) break
      const moment = projectRef.current.moments.find((m) => m.id === id)
      if (!moment || moment.imageUrl) continue
      await handleRenderFrame(moment)
    }
    setQueueRunning(false)
  }

  async function handleRenderFrame(moment: Moment) {
    setGeneratingImageIds((prev) => new Set(prev).add(moment.id))
    setImageErrors((prev) => ({ ...prev, [moment.id]: '' }))

    const { stylePreset, characters } = projectRef.current
    const { composeCharacterDescription, castForMoment } = await import('@/lib/prompts')
    // Only the cast assigned to this moment enters the prompt.
    const result = await generateMomentImage(
      moment,
      stylePreset,
      composeCharacterDescription(castForMoment(characters, moment.characterNames)),
      moment.imagePrompt
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
            ? { ...m, videoUrl: result.videoUrl, videoPrompt: result.videoPrompt, videoGeneratedAt: new Date().toISOString() }
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

  function handleEditPrompt(momentId: string, prompt: string) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => (m.id === momentId ? { ...m, imagePrompt: prompt } : m)),
      updatedAt: new Date().toISOString(),
    }))
  }

  // Edits keep existing media (possibly stale) — regeneration is the user's explicit,
  // costed choice. Note: once imagePrompt is set, it (not the description) drives renders.
  function handleEditDescription(momentId: string, description: string) {
    setProject((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => (m.id === momentId ? { ...m, description } : m)),
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
        return { ...m, characterNames: next }
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

  // ---------- cast ----------

  async function handleRefineCharacter(character: Character) {
    setIsRefining(true)
    setRefineError(null)
    setRefineSuggestion(null)
    const result = await refineCharacterDescription(project.script, character.description)
    if (result.ok) setRefineSuggestion({ characterId: character.id, refined: result.refined, notes: result.notes })
    else setRefineError(result.error)
    setIsRefining(false)
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
    if (refineSuggestion?.characterId === id) setRefineSuggestion(null)
  }

  // ---------- render ----------

  const hasFrames = project.moments.some((m) => m.imageUrl)
  const pendingCount = project.moments.filter((m) => !m.imageUrl).length
  const railMode = mode === 'reviewing' || mode === 'transitioning' ? 'review' : 'compose'
  const anyGenerating =
    generatingImageIds.size > 0 || generatingVideoIds.size > 0 || generatingBridgeIds.size > 0 || queueRunning

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
                  <p className="text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]">CAST</p>
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
                      <div className="flex gap-3 pl-1">
                        <button
                          type="button"
                          onClick={() => handleRefineCharacter(c)}
                          disabled={isRefining || (!project.script.trim() && !c.description.trim())}
                          className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:opacity-40"
                        >
                          {isRefining ? 'Refining…' : 'Refine with AI ✦'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveCharacter(c.id)}
                          className="text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-foreground"
                        >
                          Remove
                        </button>
                      </div>
                      {refineSuggestion && refineSuggestion.characterId === c.id ? (
                        <div className="flex flex-col gap-2 rounded-2xl border border-white/10 p-3">
                          <p className="text-sm">{refineSuggestion.refined}</p>
                          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-[var(--muted-foreground)]">
                            {refineSuggestion.notes.map((note, i) => (
                              <li key={i}>{note}</li>
                            ))}
                          </ul>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => {
                                handleUpdateCharacter(c.id, { description: refineSuggestion.refined })
                                setRefineSuggestion(null)
                              }}
                            >
                              Use this
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRefineSuggestion(null)}>
                              Keep mine
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {refineError ? <p className="text-xs text-destructive">{refineError}</p> : null}
                  <button
                    type="button"
                    onClick={handleAddCharacter}
                    className="self-start text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-foreground"
                  >
                    + Add character
                  </button>

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
                className="flex h-svh min-w-0 flex-col gap-4 px-8 py-6"
              >
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
                      className="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
                    >
                      Render remaining ({pendingCount}) ≈ ${(pendingCount * ESTIMATED_COST_PER_IMAGE_USD).toFixed(2)}
                    </button>
                  ) : null}
                </div>

                {showAnimatic ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <AnimaticPlayer key={project.updatedAt} project={project} onClose={() => setShowAnimatic(false)} />
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 justify-center gap-8">
                    <div className="min-h-0 flex-1">
                      <HeroCanvas
                        selection={selection}
                        moments={project.moments}
                        getTransition={getTransition}
                        slotStatus={slotStatus}
                        onRetry={handleRenderFrame}
                      />
                    </div>
                    <Inspector
                      selection={selection}
                      project={project}
                      getTransition={getTransition}
                      slotStatus={slotStatus}
                      jointStatus={jointStatus}
                      onEditPrompt={handleEditPrompt}
                      onEditDescription={handleEditDescription}
                      onEditDuration={handleEditDuration}
                      onToggleCharacter={handleToggleCharacter}
                      onMove={handleMoveMoment}
                      onRender={handleRenderFrame}
                      onRegenerateImage={handleRegenerateImage}
                      onAnimate={handleAnimate}
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
                )}

                <ReviewStrip
                  moments={project.moments}
                  getTransition={getTransition}
                  slotStatus={slotStatus}
                  jointStatus={jointStatus}
                  selection={selection}
                  onSelect={setSelection}
                  animate={!reduceMotion}
                />
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
