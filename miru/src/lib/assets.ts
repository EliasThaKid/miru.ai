import type { Project } from '@/types'

// Shared (client-safe) vocabulary for durably-stored assets. The server mirrors paid fal
// outputs into Storage (`lib/asset-store.ts`); this module holds the pieces both sides need:
// the bucket name, the signing window, and the path↔url plumbing used when a project loads.
//
// The durable thing is the PATH. A display URL is always derived and always expiring — never
// treat a stored URL as permanent.

export const ASSET_BUCKET = 'assets'

// Signed-URL lifetime. Every project load re-mints these, so this only has to outlive a
// single editing session comfortably — not the project.
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

// Every storage path referenced by a project, deduped. Order is irrelevant; the caller maps
// results back by path.
export function collectAssetPaths(project: Project): string[] {
  const paths = new Set<string>()
  for (const moment of project.moments ?? []) {
    if (moment.imageStoragePath) paths.add(moment.imageStoragePath)
    if (moment.endImageStoragePath) paths.add(moment.endImageStoragePath)
    if (moment.videoStoragePath) paths.add(moment.videoStoragePath)
  }
  for (const transition of project.transitions ?? []) {
    if (transition.videoStoragePath) paths.add(transition.videoStoragePath)
  }
  return [...paths]
}

// Rewrite each asset URL whose path resolved to a fresh signed URL. A path missing from the
// map (signing failed, object deleted) keeps its previous URL rather than being blanked — a
// possibly-dead URL is strictly better than dropping the reference to a paid asset.
export function applySignedUrls(project: Project, signed: Map<string, string>): Project {
  const pick = (path: string | null | undefined, current: string | null) =>
    (path ? signed.get(path) : undefined) ?? current

  return {
    ...project,
    moments: (project.moments ?? []).map((moment) => ({
      ...moment,
      imageUrl: pick(moment.imageStoragePath, moment.imageUrl),
      endImageUrl: pick(moment.endImageStoragePath, moment.endImageUrl ?? null),
      videoUrl: pick(moment.videoStoragePath, moment.videoUrl),
    })),
    transitions: (project.transitions ?? []).map((transition) => ({
      ...transition,
      videoUrl: pick(transition.videoStoragePath, transition.videoUrl),
    })),
  }
}
