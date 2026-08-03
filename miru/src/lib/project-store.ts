import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { loadProject as loadLocal, saveProject as saveLocal } from '@/lib/storage'
import type { Project } from '@/types'

// Where the active project is persisted for THIS session. Signed-in → a row in the
// `projects` table (RLS scopes it to the user); anonymous → localStorage (the $0 demo).
// `rowId` is the DB primary key once a row exists; null means "not yet inserted".
export interface PersistContext {
  userId: string | null
  rowId: string | null
}

export const ANON_CONTEXT: PersistContext = { userId: null, rowId: null }

// `settings` arrived after storage v3 shipped — normalize older saves (and any DB blob that
// predates it) so the rest of the app can assume the array exists.
function normalize(project: Project): Project {
  if (!Array.isArray(project.settings)) project.settings = []
  return project
}

// Load the active project for the current session. Signed-in users read their most-recent
// DB row; if they have none but a local draft exists (their first sign-in), that draft is
// carried up and will be written to the DB on the next save. Anonymous users read
// localStorage. Returns the persistence context so saves know where to write.
export async function loadActiveProject(): Promise<{
  project: Project | null
  context: PersistContext
}> {
  // Supabase not configured yet → pure localStorage demo, unchanged from before hosting.
  if (!isSupabaseConfigured()) {
    const local = loadLocal()
    return { project: local ? normalize(local) : null, context: ANON_CONTEXT }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const local = loadLocal()
    return { project: local ? normalize(local) : null, context: ANON_CONTEXT }
  }

  const { data } = await supabase
    .from('projects')
    .select('id, data')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (data) {
    return {
      project: normalize(data.data as Project),
      context: { userId: user.id, rowId: data.id },
    }
  }

  // No DB project yet — migrate a local draft up on first sign-in (rowId stays null until
  // the first save inserts it).
  const local = loadLocal()
  return { project: local ? normalize(local) : null, context: { userId: user.id, rowId: null } }
}

// Persist the active project. Anonymous → localStorage. Signed-in → update the existing row,
// or insert one (returning the new context with its rowId). Never throws into the caller's
// render loop; a failed cloud save falls back to a local copy so work isn't lost.
export async function saveActiveProject(
  project: Project,
  context: PersistContext
): Promise<PersistContext> {
  if (!context.userId || !isSupabaseConfigured()) {
    saveLocal(project)
    return context
  }

  const supabase = createClient()
  const title = project.title?.trim() || 'Untitled scene'

  try {
    if (context.rowId) {
      const { error } = await supabase
        .from('projects')
        .update({ title, data: project })
        .eq('id', context.rowId)
      if (error) throw error
      return context
    }

    const { data, error } = await supabase
      .from('projects')
      .insert({ user_id: context.userId, title, data: project })
      .select('id')
      .single()
    if (error) throw error
    return { ...context, rowId: data.id }
  } catch {
    // Cloud save failed (offline, RLS, transient) — keep a local safety copy and retry on
    // the next change with the same context.
    saveLocal(project)
    return context
  }
}
