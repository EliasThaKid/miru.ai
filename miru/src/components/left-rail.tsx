'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { exportImagesZip, exportStoryboardPdf } from '@/lib/export'
import { exportSequenceVideo } from '@/lib/export-video'
import { AuthButton } from '@/components/auth-button'
import { SceneLibrary } from '@/components/scene-library'
import type { Project } from '@/types'

export interface LeftRailProps {
  project: Project
  // Simplified view of the machine: composing/listing → 'compose'; transitioning/reviewing → 'review'.
  mode: 'compose' | 'review'
  hasFrames: boolean
  onShowAnimatic: () => void
  onEnterReview: () => void
  onBackToCompose: () => void
  // Scene library (signed-in only; the rail renders nothing for the anonymous demo).
  activeRowId: string | null
  onOpenScene: (rowId: string) => void
  onNewScene: () => void
  generating: boolean
}

// py-2.5 gives a ~40px touch row inside the mobile drawer; lg: restores the tighter
// desktop rhythm.
const ENTRY = 'flex w-full items-center gap-2 py-2.5 text-left text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40 lg:py-1.5'
const SECTION_LABEL = 'text-[11px] tracking-[0.18em] text-[var(--text-tertiary)]'

// The rail's contents, with no layout of its own, so the desktop <aside> and the mobile
// drawer render the same thing. This is deliberate: the rail is the only mount point for
// auth, the token balance, Buy Tokens, the scene library, navigation, and exports, and
// duplicating that list is how mobile lost all of it in the first place.
//
// onNavigate lets the drawer close itself when an entry actually navigates. Export buttons
// deliberately do NOT call it — export progress ("Recording… 42%") and any error render
// inside this component, and closing the drawer would hide them mid-run.
export function RailContent({
  project,
  mode,
  hasFrames,
  onShowAnimatic,
  onEnterReview,
  onBackToCompose,
  activeRowId,
  onOpenScene,
  onNewScene,
  generating,
  onNavigate,
}: LeftRailProps & { onNavigate?: () => void }) {
  const [busy, setBusy] = useState<'pdf' | 'zip' | 'video' | null>(null)
  const [videoPct, setVideoPct] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Only offer the video export once at least one clip exists (otherwise it's just a slideshow).
  const hasClips = project.moments.some((m) => m.videoUrl)

  async function runExport(kind: 'pdf' | 'zip' | 'video') {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'pdf') await exportStoryboardPdf(project)
      else if (kind === 'zip') await exportImagesZip(project)
      else await exportSequenceVideo(project, (f) => setVideoPct(Math.round(f * 100)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Please try again.')
    }
    setBusy(null)
    setVideoPct(0)
  }

  return (
    <>
      <p className="text-[13px] font-medium tracking-[0.24em] text-foreground">SCENELAB</p>

      <AuthButton />

      <SceneLibrary
        activeRowId={activeRowId}
        onOpen={(rowId) => {
          onOpenScene(rowId)
          onNavigate?.()
        }}
        onNew={() => {
          onNewScene()
          onNavigate?.()
        }}
        busy={generating}
      />

      <div className="flex flex-col gap-2">
        <p className={SECTION_LABEL}>PROJECT</p>
        <button
          type="button"
          className={ENTRY}
          // onNavigate fires even when this entry is already active: on desktop that is
          // invisible, but in the mobile drawer a tap that neither navigates nor closes
          // reads as a dead button.
          onClick={() => {
            if (mode === 'review') onBackToCompose()
            onNavigate?.()
          }}
          data-active={mode === 'compose'}
          style={mode === 'compose' ? { color: 'var(--foreground)' } : undefined}
        >
          Compose
        </button>
        <button
          type="button"
          className={ENTRY}
          onClick={() => {
            if (mode === 'compose') onEnterReview()
            onNavigate?.()
          }}
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
          <button
            type="button"
            className={ENTRY}
            onClick={() => {
              onShowAnimatic()
              onNavigate?.()
            }}
          >
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
            <button
              type="button"
              className={ENTRY}
              onClick={() => runExport('video')}
              disabled={busy !== null || !hasClips}
              title={hasClips ? 'Records the animatic as a WebM video (plays in real time)' : 'Animate at least one moment first'}
            >
              {busy === 'video' ? `Recording… ${videoPct}%` : 'Export Video (WebM)'}
            </button>
            {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

// Shared by both collapse handles. Small, quiet, and out of the way — this is chrome, not
// an action.
const HANDLE =
  'flex h-7 w-7 items-center justify-center rounded text-[13px] text-[var(--text-tertiary)] transition-colors hover:bg-white/5 hover:text-foreground'

export function CollapseHandle({
  side,
  collapsed,
  onToggle,
  label,
  className = '',
}: {
  side: 'left' | 'right'
  collapsed: boolean
  onToggle: () => void
  label: string
  className?: string
}) {
  // Point the chevron at the motion it causes, not at the panel it belongs to.
  const glyph = (side === 'left') === collapsed ? '›' : '‹'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className={`${HANDLE} ${className}`}
    >
      {glyph}
    </button>
  )
}

// Desktop shell. Gated at lg (1024px), not md: review's fixed chrome is 640px wide, so at
// md the canvas would still only get 128px. Below lg the same RailContent renders in
// MobileBar's drawer, which has its own dismissal — so the collapse handle is lg-only too.
export function LeftRail({
  collapsed,
  onToggleCollapsed,
  ...props
}: LeftRailProps & { collapsed: boolean; onToggleCollapsed: () => void }) {
  if (collapsed) {
    return (
      <aside className="sticky top-0 hidden h-svh w-10 shrink-0 flex-col items-center border-r border-white/10 py-6 lg:flex">
        <CollapseHandle side="left" collapsed onToggle={onToggleCollapsed} label="Expand sidebar" />
      </aside>
    )
  }
  return (
    // `sticky` is a positioned value, so it anchors the absolutely positioned handle. The
    // rail's top-right is empty next to the SCENELAB mark, so nothing needs to move for it.
    <aside className="sticky top-0 hidden h-svh w-[248px] shrink-0 flex-col gap-8 overflow-y-auto border-r border-white/10 px-5 py-6 lg:flex">
      <CollapseHandle
        side="left"
        collapsed={false}
        onToggle={onToggleCollapsed}
        label="Collapse sidebar"
        className="absolute top-5 right-3"
      />
      <RailContent {...props} />
    </aside>
  )
}
