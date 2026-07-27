export type ShotType = 'wide' | 'medium' | 'close-up' | 'pov' | 'over-the-shoulder'
export type StylePreset = 'anime' | 'cinematic' | 'illustrated' | 'hyper-realistic'

// Editorial connection between two adjacent moments. 'hard-cut' is the default and costs
// nothing. 'dissolve' and 'fade-to-black' are deterministic playback effects (CSS in the
// animatic — never Kling calls). 'generated-bridge' is an explicit AI generation (Kling O3
// dual-keyframe). Future modes (wipe, match-cut planning, J/L-cuts) extend this union.
export type ConnectionMode = 'hard-cut' | 'dissolve' | 'fade-to-black' | 'generated-bridge'

// A moment is one visual beat of the single continuous scene a Project represents.
export interface Moment {
  id: string
  number: number
  shotType: ShotType
  description: string
  durationSeconds: number
  // Character range of the script this moment is drawn from (derived from the breakdown's
  // verbatim scriptAnchor). Drives the compose→review shared-element transition; null =
  // no clean source span (that moment fades instead of flying). Optional: pre-existing
  // saved projects lack it.
  scriptSpan?: { start: number; end: number } | null
  // Names of the cast members visibly present in this moment (assigned by the breakdown,
  // editable in the inspector). Only these characters enter the image prompt.
  // undefined/null = legacy data → whole cast (old behavior). [] = deliberately no one.
  characterNames?: string[] | null
  // Temporal split (fixes reversed-action renders): startFrame is the frozen instant the
  // shot OPENS (drives the still), motion is the forward change (drives the clip),
  // endFrame is the frozen closing instant (drives dual-keyframe animation). Legacy
  // moments fall back to `description` for all three.
  startFrame?: string | null
  motion?: string | null
  endFrame?: string | null
  // Which Setting this shot takes place in (assigned by the breakdown from the provided
  // settings list; editable in the inspector). null/undefined = unassigned.
  locationName?: string | null
  // Cached end-pose still for dual-keyframe animation (paid asset — kept once generated).
  endImageUrl?: string | null
  // Which model produced the current clip (provenance): Kling 1.6 single-frame or
  // Kling O3 dual-keyframe. undefined = legacy → Kling 1.6.
  videoModel?: 'kling-1.6' | 'kling-o3-anchored' | null
  imageUrl: string | null
  imagePrompt: string | null
  videoUrl: string | null
  videoPrompt: string | null
  imageGeneratedAt: string | null
  videoGeneratedAt: string | null
}

export interface Transition {
  id: string
  fromMomentId: string          // Moment.id of the earlier moment
  toMomentId: string            // Moment.id of the next moment — must be adjacent
  mode: ConnectionMode
  // Generated-bridge fields. videoUrl is KEPT when mode flips back to 'hard-cut' so a
  // paid generation is never discarded; absence of a Transition record means Hard Cut.
  videoUrl: string | null
  transitionPrompt: string | null
  bridgeDirection: string | null
  generatedAt: string | null
}

// A named character in the scene. All character descriptions are composed into the
// image prompt so every generated frame keeps the cast consistent.
export interface Character {
  id: string
  name: string
  description: string
}

// A named location/setting. The breakdown may only place shots inside these, and the
// assigned setting's description enters the image prompt — the location continuity layer.
export interface Setting {
  id: string
  name: string
  description: string
}

export interface Project {
  id: string
  title: string
  script: string
  characters: Character[]
  settings: Setting[]         // established locations (normalize ?? [] when loading old data)
  stylePreset: StylePreset
  moments: Moment[]
  transitions: Transition[]   // sparse — only pairs the user has touched
  createdAt: string
  updatedAt: string
}
