'use client'

import { useEffect, useState } from 'react'
import { generateMoments } from '@/app/actions/generate-moments'
import { generateMomentImage } from '@/app/actions/generate-image'
import { generateMomentVideo } from '@/app/actions/generate-moment-video'
import { generateBridgeVideo } from '@/app/actions/generate-bridge'
import { MomentCard } from '@/components/moment-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { loadProject, saveProject } from '@/lib/storage'
import type { ConnectionMode, Moment, Project, StylePreset, Transition } from '@/types'

// Extends the Server Action timeout for this page — Kling 1.6 (generateMomentVideo)
// typically takes 2-5 minutes and Kling O3 bridges ~1-2; the other actions finish in seconds.
export const maxDuration = 300

const STYLE_PRESETS: { value: StylePreset; label: string }[] = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'anime', label: 'Anime' },
  { value: 'illustrated', label: 'Illustrated' },
  { value: 'hyper-realistic', label: 'Hyper-Realistic' },
]

const EMPTY_PROJECT: Project = {
  id: '',
  title: '',
  script: '',
  characterDescription: '',
  stylePreset: 'cinematic',
  moments: [],
  transitions: [],
  createdAt: '',
  updatedAt: '',
}

function findTransition(transitions: Transition[], fromId: string, toId: string): Transition | null {
  return transitions.find((t) => t.fromMomentId === fromId && t.toMomentId === toId) ?? null
}

export default function Home() {
  // Starts as EMPTY_PROJECT so server and client render the same markup on hydration;
  // the load-or-create effect below only runs client-side, after hydration.
  const [project, setProject] = useState<Project>(EMPTY_PROJECT)
  const [hasLoaded, setHasLoaded] = useState(false)

  const [isGeneratingMoments, setIsGeneratingMoments] = useState(false)
  const [momentsError, setMomentsError] = useState<string | null>(null)

  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set())
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({})

  const [generatingVideoIds, setGeneratingVideoIds] = useState<Set<string>>(new Set())
  const [videoErrors, setVideoErrors] = useState<Record<string, string>>({})

  // Keyed by the "from" moment's id — one bridge can be in flight per adjacent pair.
  const [generatingBridgeIds, setGeneratingBridgeIds] = useState<Set<string>>(new Set())
  const [bridgeErrors, setBridgeErrors] = useState<Record<string, string>>({})

  // localStorage isn't available during SSR, so this can't be a lazy useState initializer
  // without causing a hydration mismatch — it has to run post-mount, client-only.
  useEffect(() => {
    const existing = loadProject()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProject(
      existing ?? {
        ...EMPTY_PROJECT,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    )
    setHasLoaded(true)
  }, [])

  useEffect(() => {
    if (hasLoaded) saveProject(project)
  }, [project, hasLoaded])

  async function handleGenerateStoryboard() {
    setIsGeneratingMoments(true)
    setMomentsError(null)

    const result = await generateMoments(project.script)

    if (result.ok) {
      // A fresh breakdown replaces all moments, so existing transitions reference dead ids.
      setProject((prev) => ({
        ...prev,
        moments: result.moments,
        transitions: [],
        updatedAt: new Date().toISOString(),
      }))
    } else {
      setMomentsError(result.error)
    }

    setIsGeneratingMoments(false)
  }

  async function handleGenerateImage(moment: Moment) {
    setGeneratingImageIds((prev) => new Set(prev).add(moment.id))
    setImageErrors((prev) => ({ ...prev, [moment.id]: '' }))

    const result = await generateMomentImage(moment, project.stylePreset, project.characterDescription)

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

  async function handleAnimateMoment(moment: Moment) {
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

  async function handleGenerateBridge(fromMoment: Moment, toMoment: Moment, bridgeDirection: string) {
    setGeneratingBridgeIds((prev) => new Set(prev).add(fromMoment.id))
    setBridgeErrors((prev) => ({ ...prev, [fromMoment.id]: '' }))

    const existing = findTransition(project.transitions, fromMoment.id, toMoment.id)
    const direction = bridgeDirection.trim() || null
    const result = await generateBridgeVideo(fromMoment, toMoment, existing, direction)

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
              generatedAt: found.generatedAt ?? new Date().toISOString(),
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

  // Hard Cut is the default (no record needed); switching modes on an existing record only
  // flips `mode` — a previously generated bridge's videoUrl is always kept.
  function handleSetConnectionMode(fromMoment: Moment, toMoment: Moment, mode: ConnectionMode) {
    setProject((prev) => {
      const found = findTransition(prev.transitions, fromMoment.id, toMoment.id)
      if (!found) return prev
      return {
        ...prev,
        transitions: prev.transitions.map((t) => (t.id === found.id ? { ...t, mode } : t)),
        updatedAt: new Date().toISOString(),
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="script">Script</Label>
          <Textarea
            id="script"
            value={project.script}
            onChange={(e) => setProject((prev) => ({ ...prev, script: e.target.value }))}
            placeholder="Paste your short-form video script here…"
            rows={8}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="character">Character description</Label>
          <Input
            id="character"
            value={project.characterDescription}
            onChange={(e) => setProject((prev) => ({ ...prev, characterDescription: e.target.value }))}
            placeholder="e.g. a young woman in her late 20s, dark bob haircut, oversized cream sweater"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="style">Style preset</Label>
          <Select
            value={project.stylePreset}
            onValueChange={(value) => setProject((prev) => ({ ...prev, stylePreset: value as StylePreset }))}
          >
            <SelectTrigger id="style" className="w-full">
              <SelectValue placeholder="Choose a style" />
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

        <Button onClick={handleGenerateStoryboard} disabled={!project.script.trim() || isGeneratingMoments}>
          {isGeneratingMoments ? 'Generating…' : 'Generate Storyboard'}
        </Button>

        {momentsError ? <p className="text-sm text-destructive">{momentsError}</p> : null}
      </div>

      {project.moments.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {project.moments.map((moment, i) => {
            const nextMoment = project.moments[i + 1] ?? null
            const transition = nextMoment ? findTransition(project.transitions, moment.id, nextMoment.id) : null
            return (
              <MomentCard
                key={moment.id}
                moment={moment}
                nextMoment={nextMoment}
                transition={transition}
                isGeneratingImage={generatingImageIds.has(moment.id)}
                imageError={imageErrors[moment.id] || null}
                onGenerateImage={() => handleGenerateImage(moment)}
                isGeneratingVideo={generatingVideoIds.has(moment.id)}
                videoError={videoErrors[moment.id] || null}
                onAnimateMoment={() => handleAnimateMoment(moment)}
                isGeneratingBridge={generatingBridgeIds.has(moment.id)}
                bridgeError={bridgeErrors[moment.id] || null}
                onGenerateBridge={(direction) => {
                  if (nextMoment) handleGenerateBridge(moment, nextMoment, direction)
                }}
                onSetConnectionMode={(mode) => {
                  if (nextMoment) handleSetConnectionMode(moment, nextMoment, mode)
                }}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
