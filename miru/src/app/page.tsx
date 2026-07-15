'use client'

import { useEffect, useState } from 'react'
import { generateScenes } from '@/app/actions/generate-scenes'
import { generateSceneImage } from '@/app/actions/generate-image'
import { SceneCard } from '@/components/scene-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { loadProject, saveProject } from '@/lib/storage'
import type { Project, Scene, StylePreset } from '@/types'

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
  scenes: [],
  transitions: [],
  createdAt: '',
  updatedAt: '',
}

export default function Home() {
  // Starts as EMPTY_PROJECT so server and client render the same markup on hydration;
  // the load-or-create effect below only runs client-side, after hydration.
  const [project, setProject] = useState<Project>(EMPTY_PROJECT)
  const [hasLoaded, setHasLoaded] = useState(false)

  const [isGeneratingScenes, setIsGeneratingScenes] = useState(false)
  const [scenesError, setScenesError] = useState<string | null>(null)

  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set())
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({})

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
    setIsGeneratingScenes(true)
    setScenesError(null)

    const result = await generateScenes(project.script)

    if (result.ok) {
      setProject((prev) => ({ ...prev, scenes: result.scenes, updatedAt: new Date().toISOString() }))
    } else {
      setScenesError(result.error)
    }

    setIsGeneratingScenes(false)
  }

  async function handleGenerateImage(scene: Scene) {
    setGeneratingImageIds((prev) => new Set(prev).add(scene.id))
    setImageErrors((prev) => ({ ...prev, [scene.id]: '' }))

    const result = await generateSceneImage(scene, project.stylePreset, project.characterDescription)

    if (result.ok) {
      setProject((prev) => ({
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.id === scene.id
            ? { ...s, imageUrl: result.imageUrl, imagePrompt: result.imagePrompt, imageGeneratedAt: new Date().toISOString() }
            : s
        ),
        updatedAt: new Date().toISOString(),
      }))
    } else {
      setImageErrors((prev) => ({ ...prev, [scene.id]: result.error }))
    }

    setGeneratingImageIds((prev) => {
      const next = new Set(prev)
      next.delete(scene.id)
      return next
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

        <Button onClick={handleGenerateStoryboard} disabled={!project.script.trim() || isGeneratingScenes}>
          {isGeneratingScenes ? 'Generating…' : 'Generate Storyboard'}
        </Button>

        {scenesError ? <p className="text-sm text-destructive">{scenesError}</p> : null}
      </div>

      {project.scenes.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {project.scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              isGenerating={generatingImageIds.has(scene.id)}
              error={imageErrors[scene.id] || null}
              onGenerateImage={() => handleGenerateImage(scene)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
