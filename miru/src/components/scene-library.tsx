'use client'

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react'
import { listScenes, deleteScene, type SceneSummary } from '@/lib/project-library'

interface SceneLibraryProps {
  // Row id of the scene currently open, so it can be marked and not offered for deletion.
  activeRowId: string | null
  onOpen: (rowId: string) => void
  onNew: () => void
  // True while a generation is running — switching scenes mid-render would strand in-flight
  // work against a project that is no longer on screen.
  busy: boolean
}

function when(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function SceneLibrary({ activeRowId, onOpen, onNew, busy }: SceneLibraryProps) {
  const [scenes, setScenes] = useState<SceneSummary[] | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // Bumped after a delete to re-run the load. Cheaper than threading a refresh callback, and
  // keeps every state write inside an async resolution or an event handler.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    listScenes().then((rows) => {
      if (active) setScenes(rows)
    })
    return () => {
      active = false
    }
  }, [activeRowId, reloadToken])

  // Nothing to show for anonymous users — the demo has a single localStorage project.
  if (scenes === null || scenes.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] tracking-[0.14em] text-[var(--text-tertiary)]">SCENES</span>
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          className="text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-foreground disabled:opacity-40"
        >
          + New
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {scenes.map((scene) => {
          const active = scene.id === activeRowId
          return (
            <li key={scene.id} className="group flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpen(scene.id)}
                disabled={busy || active}
                title={busy ? 'Finish or cancel the current render first' : scene.title}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded p-1 text-left transition-colors disabled:cursor-default ${
                  active ? 'bg-white/5' : 'hover:bg-white/5 disabled:opacity-40'
                }`}
              >
                <span className="h-8 w-[18px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">
                  {scene.thumbnailUrl ? (
                    <img src={scene.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[12px] ${active ? 'text-foreground' : 'text-[var(--muted-foreground)]'}`}
                  >
                    {scene.title}
                  </span>
                  <span className="block text-[10px] text-[var(--text-tertiary)]">
                    {scene.momentCount} moment{scene.momentCount === 1 ? '' : 's'} · {when(scene.updatedAt)}
                  </span>
                </span>
              </button>

              {/* Deleting the open scene is not offered — it would leave the editor showing a
                  project with no row to save back to. */}
              {!active ? (
                confirmingId === scene.id ? (
                  <span className="flex shrink-0 gap-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={async () => {
                        setConfirmingId(null)
                        if (await deleteScene(scene.id)) setReloadToken((t) => t + 1)
                      }}
                      className="text-destructive transition-opacity hover:opacity-80"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="text-[var(--muted-foreground)] transition-colors hover:text-foreground"
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(scene.id)}
                    aria-label={`Delete ${scene.title}`}
                    className="shrink-0 px-1 text-[11px] text-transparent transition-colors group-hover:text-[var(--text-tertiary)] hover:!text-destructive"
                  >
                    ×
                  </button>
                )
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
