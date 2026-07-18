'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { exportImagesZip, exportStoryboardPdf } from '@/lib/export'
import type { Project } from '@/types'

interface LeftRailProps {
  project: Project
  // Simplified view of the machine: composing/listing → 'compose'; transitioning/reviewing → 'review'.
  mode: 'compose' | 'review'
  hasFrames: boolean
  onShowAnimatic: () => void
  onEnterReview: () => void
  onBackToCompose: () => void
}

const ENTRY = 'flex w-full items-center gap-2 py-1.5 text-left text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
const SECTION_LABEL = 'text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]'

export function LeftRail({ project, mode, hasFrames, onShowAnimatic, onEnterReview, onBackToCompose }: LeftRailProps) {
  const [busy, setBusy] = useState<'pdf' | 'zip' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runExport(kind: 'pdf' | 'zip') {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'pdf') await exportStoryboardPdf(project)
      else await exportImagesZip(project)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Please try again.')
    }
    setBusy(null)
  }

  return (
    <aside className="sticky top-0 hidden h-svh w-[248px] shrink-0 flex-col gap-8 border-r border-white/10 px-5 py-6 md:flex">
      <p className="text-[13px] font-medium tracking-[0.24em] text-foreground">SCENELAB</p>

      <div className="flex flex-col gap-2">
        <p className={SECTION_LABEL}>PROJECT</p>
        <button
          type="button"
          className={ENTRY}
          onClick={mode === 'review' ? onBackToCompose : undefined}
          data-active={mode === 'compose'}
          style={mode === 'compose' ? { color: 'var(--foreground)' } : undefined}
        >
          Compose
        </button>
        <button
          type="button"
          className={ENTRY}
          onClick={mode === 'compose' ? onEnterReview : undefined}
          disabled={!hasFrames && mode === 'compose'}
          style={mode === 'review' ? { color: 'var(--foreground)' } : undefined}
        >
          Storyboard
        </button>
        <button type="button" className={ENTRY} disabled>
          Cast
          <span className="ml-auto rounded-full bg-white/5 px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)]">
            {project.characters.length}
          </span>
        </button>
        {hasFrames ? (
          <button type="button" className={ENTRY} onClick={onShowAnimatic}>
            Animatic
          </button>
        ) : null}
      </div>

      <AnimatePresence>
        {mode === 'review' ? (
          // The rail morphs PROJECT-only → PROJECT + EXPORTS on arrival in review;
          // the verbs disable (rather than hide) until any frame exists.
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-2"
          >
            <p className={SECTION_LABEL}>EXPORTS</p>
            <button type="button" className={ENTRY} onClick={() => runExport('pdf')} disabled={busy !== null || !hasFrames}>
              {busy === 'pdf' ? 'Exporting…' : 'PDF Storyboard'}
            </button>
            <button type="button" className={ENTRY} onClick={() => runExport('zip')} disabled={busy !== null || !hasFrames}>
              {busy === 'zip' ? 'Zipping…' : 'Images ZIP'}
            </button>
            {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  )
}
