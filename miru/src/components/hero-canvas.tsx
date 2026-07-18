'use client'

/* eslint-disable @next/next/no-img-element */
import type { Moment, Transition } from '@/types'
import type { ReviewSelection, SlotStatus } from '@/components/review-strip'

interface HeroCanvasProps {
  selection: ReviewSelection
  moments: Moment[]
  getTransition: (fromId: string, toId: string) => Transition | null
  slotStatus: (moment: Moment) => SlotStatus
  onRetry: (moment: Moment) => void
}

export function HeroCanvas({ selection, moments, getTransition, slotStatus, onRetry }: HeroCanvasProps) {
  const frame = 'relative mx-auto aspect-9/16 h-full max-h-[68svh] overflow-hidden rounded-2xl bg-[#141414]'

  if (selection.kind === 'joint') {
    const from = moments.find((m) => m.id === selection.fromId)
    const fromIndex = from ? moments.indexOf(from) : -1
    const to = fromIndex >= 0 ? (moments[fromIndex + 1] ?? null) : null
    const transition = from && to ? getTransition(from.id, to.id) : null

    return (
      <div className={frame}>
        {transition?.videoUrl ? (
          <video src={transition.videoUrl} controls className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">
              Connection {from?.number} → {to?.number}
            </p>
            <p className="text-[12px] text-[var(--text-tertiary)]">
              No bridge yet — this pair plays as an editorial cut.
            </p>
          </div>
        )}
      </div>
    )
  }

  const moment = moments.find((m) => m.id === selection.id)
  if (!moment) return null
  const status = slotStatus(moment)

  return (
    <div className={frame}>
      {moment.videoUrl ? (
        <video
          src={moment.videoUrl}
          poster={moment.imageUrl ?? undefined}
          controls
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : status === 'done' && moment.imageUrl ? (
        <img src={moment.imageUrl} alt={moment.description} className="absolute inset-0 h-full w-full object-cover" />
      ) : status === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <p className="text-[12px] text-destructive">Render failed</p>
          <button
            type="button"
            onClick={() => onRetry(moment)}
            className="text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
          >
            Retry ↻
          </button>
        </div>
      ) : (
        <div className={`absolute inset-0 bg-white/5 ${status === 'rendering' ? 'animate-pulse' : ''}`} />
      )}
    </div>
  )
}
