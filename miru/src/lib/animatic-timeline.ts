import type { Project } from '@/types'

// How the next timeline entry enters the stage. 'cut' swaps instantly; 'dissolve'
// crossfades over the previous entry; 'fade' passes through black between entries.
export type EnterEffect = 'cut' | 'dissolve' | 'fade'

export interface TimelineEntry {
  key: string
  src: string
  // 'video' plays its natural clip length; 'image' holds (with Ken Burns) for durationMs.
  kind: 'video' | 'image'
  durationMs: number
  enter: EnterEffect
  label: string
}

export const DISSOLVE_MS = 600
export const FADE_MS = 450

// Flattens moments + connections into a play sequence. Moments without images are skipped
// (nothing to show). Generated bridges play between their pair; dissolve/fade become the
// next entry's enter effect; hard cut (including absent records) is an instant swap.
// Shared by the on-screen AnimaticPlayer and the WebM export recorder so both play the
// identical sequence.
export function buildTimeline(project: Project): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const visible = project.moments.filter((m) => m.imageUrl)

  visible.forEach((moment, i) => {
    const prev = visible[i - 1]
    let enter: EnterEffect = 'cut'

    if (prev) {
      const connection = project.transitions.find(
        (t) => t.fromMomentId === prev.id && t.toMomentId === moment.id
      )
      const mode = connection?.mode ?? 'hard-cut'

      if (mode === 'generated-bridge' && connection?.videoUrl) {
        entries.push({
          key: `bridge-${connection.id}`,
          src: connection.videoUrl,
          kind: 'video',
          durationMs: 5000,
          enter: 'cut',
          label: `Bridge → Moment ${moment.number}`,
        })
      } else if (mode === 'dissolve') {
        enter = 'dissolve'
      } else if (mode === 'fade-to-black') {
        enter = 'fade'
      }
    }

    entries.push(
      moment.videoUrl
        ? {
            key: `moment-${moment.id}`,
            src: moment.videoUrl,
            kind: 'video',
            durationMs: 5000,
            enter,
            label: `Moment ${moment.number}`,
          }
        : {
            key: `moment-${moment.id}`,
            src: moment.imageUrl as string,
            kind: 'image',
            durationMs: moment.durationSeconds * 1000,
            enter,
            label: `Moment ${moment.number}`,
          }
    )
  })

  return entries
}
