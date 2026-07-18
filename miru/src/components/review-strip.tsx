'use client'

/* eslint-disable @next/next/no-img-element */
import { motion } from 'motion/react'
import type { ConnectionMode, Moment, Transition } from '@/types'

export type SlotStatus = 'pending' | 'rendering' | 'done' | 'error'
export type JointStatus = 'dormant' | 'armed' | 'generating' | 'done' | 'error'
export type ReviewSelection = { kind: 'moment'; id: string } | { kind: 'joint'; fromId: string }

const JOINT_GLYPH: Record<ConnectionMode, string> = {
  'hard-cut': '│',
  dissolve: '◑',
  'fade-to-black': '■',
  'generated-bridge': '✦',
}

interface ReviewStripProps {
  moments: Moment[]
  getTransition: (fromId: string, toId: string) => Transition | null
  slotStatus: (moment: Moment) => SlotStatus
  jointStatus: (from: Moment, to: Moment) => JointStatus
  selection: ReviewSelection
  onSelect: (selection: ReviewSelection) => void
  // false under prefers-reduced-motion: no layoutId pairing, modes cross-fade instead.
  animate: boolean
}

export function ReviewStrip({
  moments,
  getTransition,
  slotStatus,
  jointStatus,
  selection,
  onSelect,
  animate,
}: ReviewStripProps) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto px-8 pb-2">
      {moments.map((moment, i) => {
        const next = moments[i + 1] ?? null
        const status = slotStatus(moment)
        const selected = selection.kind === 'moment' && selection.id === moment.id
        return (
          <div key={moment.id} className="flex items-center">
            <motion.button
              layoutId={animate ? `shot-${moment.id}` : undefined}
              type="button"
              onClick={() => onSelect({ kind: 'moment', id: moment.id })}
              aria-label={`Select moment ${moment.number}`}
              className={`relative aspect-9/16 w-[72px] shrink-0 overflow-hidden rounded-lg bg-white/5 transition-shadow ${
                selected ? 'ring-1 ring-foreground' : 'ring-0'
              }`}
            >
              {status === 'done' && moment.imageUrl ? (
                <img src={moment.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : status === 'error' ? (
                <span className="absolute inset-0 flex items-center justify-center text-sm text-destructive">↻</span>
              ) : (
                <span
                  className={`absolute inset-0 bg-white/5 ${status === 'rendering' ? 'animate-pulse' : ''}`}
                />
              )}
              <span className="absolute top-1 left-1 rounded-full bg-black/60 px-1.5 text-[10px] leading-4 text-white">
                {moment.number}
              </span>
            </motion.button>

            {next ? (
              <JointButton
                from={moment}
                to={next}
                mode={(getTransition(moment.id, next.id)?.mode ?? 'hard-cut') as ConnectionMode}
                status={jointStatus(moment, next)}
                selected={selection.kind === 'joint' && selection.fromId === moment.id}
                onClick={() => onSelect({ kind: 'joint', fromId: moment.id })}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function JointButton({
  from,
  to,
  mode,
  status,
  selected,
  onClick,
}: {
  from: Moment
  to: Moment
  mode: ConnectionMode
  status: JointStatus
  selected: boolean
  onClick: () => void
}) {
  const color =
    status === 'error'
      ? 'text-destructive'
      : selected
        ? 'text-foreground'
        : status === 'dormant'
          ? 'text-[var(--text-tertiary)] opacity-40'
          : 'text-[var(--muted-foreground)]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Connection from moment ${from.number} to moment ${to.number}`}
      className={`flex h-24 w-7 shrink-0 items-center justify-center text-[13px] transition-colors hover:text-foreground ${color} ${
        status === 'generating' ? 'animate-pulse' : ''
      }`}
    >
      {status === 'error' ? '↻' : JOINT_GLYPH[mode]}
    </button>
  )
}
