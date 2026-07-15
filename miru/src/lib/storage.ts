import type { Project } from '@/types'

// Single active project — the app has no auth or multi-project dashboard (locked MVP scope),
// so one fixed key is enough.
const STORAGE_KEY = 'scenelab:project'

export function loadProject(): Project | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as Project
  } catch {
    return null
  }
}

export function saveProject(project: Project): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
}
