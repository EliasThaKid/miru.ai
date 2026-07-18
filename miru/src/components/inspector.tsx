'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { buildImagePrompt, composeCharacterDescription } from '@/lib/prompts'
import type { ConnectionMode, Moment, Project, Transition } from '@/types'
import type { JointStatus, ReviewSelection, SlotStatus } from '@/components/review-strip'

const CONNECTION_MODES: { value: ConnectionMode; label: string }[] = [
  { value: 'hard-cut', label: 'Hard Cut' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'fade-to-black', label: 'Fade to Black' },
  { value: 'generated-bridge', label: 'Generated Bridge ✦' },
]

const LABEL = 'text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]'
const PROVENANCE = 'text-[12px] text-[var(--text-tertiary)]'
const ACTION = 'text-left text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

interface InspectorProps {
  selection: ReviewSelection
  project: Project
  getTransition: (fromId: string, toId: string) => Transition | null
  slotStatus: (moment: Moment) => SlotStatus
  jointStatus: (from: Moment, to: Moment) => JointStatus
  onEditPrompt: (momentId: string, prompt: string) => void
  onRender: (moment: Moment) => void
  onRegenerateImage: (moment: Moment) => void
  onAnimate: (moment: Moment) => void
  onReAnimate: (moment: Moment) => void
  onSetConnectionMode: (from: Moment, to: Moment, mode: ConnectionMode) => void
  onGenerateBridge: (from: Moment, to: Moment, direction: string, regenerate: boolean) => void
  errors: { image?: string; video?: string; bridge?: string }
}

export function Inspector(props: InspectorProps) {
  const { selection, project } = props
  if (selection.kind === 'moment') {
    const moment = project.moments.find((m) => m.id === selection.id)
    if (!moment) return null
    return <FrameInspector {...props} moment={moment} />
  }
  const from = project.moments.find((m) => m.id === selection.fromId)
  const fromIndex = from ? project.moments.indexOf(from) : -1
  const to = fromIndex >= 0 ? (project.moments[fromIndex + 1] ?? null) : null
  if (!from || !to) return null
  return <ConnectionInspector {...props} from={from} to={to} />
}

function FrameInspector({
  moment,
  project,
  slotStatus,
  onEditPrompt,
  onRender,
  onRegenerateImage,
  onAnimate,
  onReAnimate,
  errors,
}: InspectorProps & { moment: Moment }) {
  const status = slotStatus(moment)
  const effectivePrompt =
    moment.imagePrompt ??
    buildImagePrompt(project.stylePreset, composeCharacterDescription(project.characters), moment.shotType, moment.description)

  return (
    <div className="flex w-72 shrink-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className={LABEL}>SHOT</p>
        <p className="text-sm text-foreground">
          {moment.shotType} · {moment.durationSeconds}s
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className={LABEL}>PROMPT</p>
        <Textarea
          value={effectivePrompt}
          onChange={(e) => onEditPrompt(moment.id, e.target.value)}
          rows={6}
          className="field-sizing-content max-h-60 min-h-24 text-[12px]"
          aria-label="Frame prompt"
        />
      </div>

      <div className="flex flex-col gap-1">
        <p className={LABEL}>GENERATION</p>
        {moment.videoUrl ? (
          <>
            <p className={PROVENANCE}>Kling 1.6 · animated {formatWhen(moment.videoGeneratedAt)}</p>
            <p className={PROVENANCE}>FLUX 1.1 Pro · still {formatWhen(moment.imageGeneratedAt)}</p>
          </>
        ) : moment.imageUrl ? (
          <p className={PROVENANCE}>FLUX 1.1 Pro · rendered {formatWhen(moment.imageGeneratedAt)}</p>
        ) : (
          <p className={PROVENANCE}>Not rendered yet · FLUX 1.1 Pro</p>
        )}

        <div className="mt-1 flex flex-col gap-1.5">
          {!moment.imageUrl ? (
            <button type="button" className={ACTION} onClick={() => onRender(moment)} disabled={status === 'rendering'}>
              {status === 'rendering' ? 'Rendering…' : status === 'error' ? 'Retry render ↻' : 'Render frame'}
            </button>
          ) : (
            <>
              <button type="button" className={ACTION} onClick={() => onRegenerateImage(moment)} disabled={status === 'rendering'}>
                {status === 'rendering' ? 'Rendering…' : 'Regenerate frame'}
              </button>
              {!moment.videoUrl ? (
                <button type="button" className={ACTION} onClick={() => onAnimate(moment)}>
                  Animate ✦ Kling 1.6 (~2-5 min)
                </button>
              ) : (
                <button type="button" className={ACTION} onClick={() => onReAnimate(moment)}>
                  Re-Animate ✦
                </button>
              )}
            </>
          )}
        </div>
        {errors.image ? <p className="text-[12px] text-destructive">{errors.image}</p> : null}
        {errors.video ? <p className="text-[12px] text-destructive">{errors.video}</p> : null}
      </div>
    </div>
  )
}

function ConnectionInspector({
  from,
  to,
  getTransition,
  jointStatus,
  onSetConnectionMode,
  onGenerateBridge,
  errors,
}: InspectorProps & { from: Moment; to: Moment }) {
  const transition = getTransition(from.id, to.id)
  const mode: ConnectionMode = transition?.mode ?? 'hard-cut'
  const status = jointStatus(from, to)
  const [direction, setDirection] = useState('')

  return (
    <div className="flex w-72 shrink-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className={LABEL}>CONNECTION</p>
        <p className="text-sm text-foreground">
          Moment {from.number} → {to.number}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className={LABEL}>TYPE</p>
        <Select value={mode} onValueChange={(value) => onSetConnectionMode(from, to, value as ConnectionMode)}>
          <SelectTrigger className="w-full" size="sm">
            <SelectValue>{CONNECTION_MODES.find((m) => m.value === mode)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CONNECTION_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === 'generated-bridge' ? (
        <div className="flex flex-col gap-1.5">
          <p className={LABEL}>BRIDGE</p>
          <p className={PROVENANCE}>
            Kling O3 Standard{transition?.videoUrl ? ` · generated ${formatWhen(transition.generatedAt)}` : ''}
          </p>
          <Input
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="Bridge direction (optional)"
            disabled={status === 'generating'}
            className="text-[12px]"
          />
          {transition?.videoUrl ? (
            <button
              type="button"
              className={ACTION}
              onClick={() => onGenerateBridge(from, to, direction, true)}
              disabled={status === 'generating' || status === 'dormant'}
            >
              {status === 'generating' ? 'Generating… (~1-2 min)' : 'Regenerate bridge ✦'}
            </button>
          ) : (
            <button
              type="button"
              className={ACTION}
              onClick={() => onGenerateBridge(from, to, direction, false)}
              disabled={status === 'generating' || status === 'dormant'}
            >
              {status === 'generating'
                ? 'Generating… (~1-2 min)'
                : status === 'dormant'
                  ? 'Render both frames first'
                  : 'Generate bridge ✦'}
            </button>
          )}
        </div>
      ) : (
        <p className={PROVENANCE}>
          {mode === 'hard-cut' ? 'Instant editorial cut — free, no generation.' : 'Deterministic playback effect — free.'}
          {transition?.videoUrl ? ' A generated bridge is saved for this pair.' : ''}
        </p>
      )}

      {errors.bridge ? <p className="text-[12px] text-destructive">{errors.bridge}</p> : null}
    </div>
  )
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return isNaN(date.getTime()) ? '' : date.toLocaleString()
}
