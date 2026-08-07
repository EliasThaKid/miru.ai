import { applySignedUrls, ASSET_BUCKET, collectAssetPaths, SIGNED_URL_TTL_SECONDS } from '@/lib/assets'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import type { Project } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'

// Browser-side listing and switching between saved scenes. The `projects` table has always
// been one row per scene and RLS already scopes it to the owner — the app simply only ever
// opened the most recent one. This exposes the rest.
//
// Runs with the user's own client (not the service role): RLS is the access control, so a
// listing can only ever return rows the signed-in user owns.

export interface SceneSummary {
  id: string
  title: string
  updatedAt: string
  momentCount: number
  // First rendered frame, for a thumbnail. Signed at list time; expiring like every asset URL.
  thumbnailUrl: string | null
}

export async function listScenes(): Promise<SceneSummary[]> {
  if (!isSupabaseConfigured()) return []
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('projects')
    .select('id, title, updated_at, data')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
  if (error || !data) return []

  // One signing round trip for every thumbnail rather than one per scene.
  const rows = data.map((row) => {
    const project = row.data as Project
    const moments = project?.moments ?? []
    const first = moments.find((m) => m.imageUrl || m.imageStoragePath)
    return {
      id: row.id as string,
      title: (row.title as string) || 'Untitled scene',
      updatedAt: row.updated_at as string,
      momentCount: moments.length,
      thumbPath: first?.imageStoragePath ?? null,
      thumbUrl: first?.imageUrl ?? null,
    }
  })

  const paths = rows.map((r) => r.thumbPath).filter((p): p is string => Boolean(p))
  const signed = await signPaths(supabase, paths)

  return rows.map(({ thumbPath, thumbUrl, ...rest }) => ({
    ...rest,
    thumbnailUrl: (thumbPath ? signed.get(thumbPath) : undefined) ?? thumbUrl,
  }))
}

async function signPaths(
  supabase: SupabaseClient,
  paths: string[]
): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  if (paths.length === 0) return signed
  const { data, error } = await supabase.storage
    .from(ASSET_BUCKET)
    .createSignedUrls([...new Set(paths)], SIGNED_URL_TTL_SECONDS)
  if (error || !data) return signed
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) signed.set(entry.path, entry.signedUrl)
  }
  return signed
}

// Open a specific scene. Asset URLs are re-minted the same way loadActiveProject does — a
// stored URL is always expiring, so a scene opened from the library must be re-signed too.
export async function openScene(rowId: string): Promise<Project | null> {
  if (!isSupabaseConfigured()) return null
  const supabase = createClient()

  const { data, error } = await supabase
    .from('projects')
    .select('data')
    .eq('id', rowId)
    .maybeSingle()
  if (error || !data) return null

  const project = data.data as Project
  if (!Array.isArray(project.settings)) project.settings = []

  const paths = collectAssetPaths(project)
  if (paths.length === 0) return project
  return applySignedUrls(project, await signPaths(supabase, paths))
}

// Delete a scene. RLS restricts this to the owner's own rows.
//
// Storage objects are intentionally NOT deleted here: they are paid assets, deletion is
// irreversible, and a mis-click should not destroy work. Reclaiming orphaned assets is a
// housekeeping job, not part of an undo-less button.
export async function deleteScene(rowId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  const supabase = createClient()
  const { error } = await supabase.from('projects').delete().eq('id', rowId)
  return !error
}
