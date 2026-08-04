export type ShotType = 'wide' | 'medium' | 'close-up' | 'pov' | 'over-the-shoulder'
export type StylePreset = 'anime' | 'cinematic' | 'illustrated' | 'hyper-realistic'

// What a moment's frame is ABOUT — drives prompt composition so an insert/detail shot of a
// thing is not rendered with a person. 'object'/'environment' frames carry NO visible cast
// and get object/location-only framing and continuity (never facial/wardrobe identity),
// which is what stops object-only shots from generating people. 'mixed' = a person and a
// prominent object both matter (people still included).
export type VisualFocus = 'character' | 'multiple_characters' | 'object' | 'environment' | 'mixed'

// ---- Cinematic blocking (compact composition plan) ----
// A shot label is not a composition plan: these encode WHERE subjects sit, HOW MUCH of each
// is visible, and how objects physically behave, so the still reads as motivated blocking
// instead of a posed portrait or a catalog display. All fields are optional — a moment with
// no blocking composes exactly as before (graceful degradation).
export type VisibilityMode = 'full' | 'partial' | 'back_only' | 'shoulder_only' | 'hands_only' | 'silhouette' | 'offscreen'
export type DepthPlane = 'extreme_foreground' | 'foreground' | 'midground' | 'background'
export type ScreenRegion = 'far_left' | 'left' | 'center' | 'right' | 'far_right'
export type BodyOrientation =
  | 'toward_camera'
  | 'three_quarter_left'
  | 'three_quarter_right'
  | 'profile_left'
  | 'profile_right'
  | 'back_to_camera'
  | 'toward_object'
  | 'away_from_other_character'
export type ActionPhase = 'pre_action' | 'action_ready' | 'mid_action' | 'post_action'
export type SymmetryIntent = 'natural' | 'avoid' | 'intentional'

// Where one subject (a character, or an unnamed focal figure) sits in the frame and how much
// of them is shown. `name` matches a cast member; absent = the focal non-cast subject.
// skin/hair/wardrobe are COMPACT visible identity anchors inlined into the subject's first
// blocking sentence (the continuity lock); the composer drops the ones the shot/visibility
// can't physically show. The full character reference still trails the prompt.
export interface SubjectBlocking {
  name?: string | null
  visibility: VisibilityMode
  depth: DepthPlane
  screenRegion: ScreenRegion
  bodyOrientation?: BodyOrientation | null
  gazeTarget?: string | null
  pose?: string | null
  occludedBy?: string | null
  skin?: string | null
  hair?: string | null
  wardrobe?: string | null
}

// How a physical object sits and behaves — the antidote to the "garment displayed like a
// product" failure.
export interface ObjectPhysics {
  item: string
  gravityState?: string | null
  deformation?: string | null
  containment?: string | null
  occlusion?: string | null
  symmetry?: SymmetryIntent | null
}

export interface MomentBlocking {
  actionPhase?: ActionPhase | null
  focalAction?: string | null
  subjects?: SubjectBlocking[] | null
  objectPhysics?: ObjectPhysics[] | null
  avoid?: string[] | null
  // SETTING LOCK — emitted right after the camera/style header so the location is fixed
  // before any action. settingCategory is the explicit venue type ("public commercial coin
  // laundromat"); practicalLighting is the location's own light (overrides a generic
  // "natural lighting"); environmentAnchors are up to three concrete visible fixtures.
  settingCategory?: string | null
  practicalLighting?: string | null
  environmentAnchors?: string[] | null
}

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
  // What the frame is about (assigned by the breakdown; editable in the inspector). Drives
  // whether the prompt includes characters, identity continuity, and person-vs-object
  // framing. undefined/null = legacy → derived from the assigned cast size at compose time.
  visualFocus?: VisualFocus | null
  // Cinematic blocking/composition plan (assigned by the breakdown; `avoid` editable in the
  // inspector). Optional — absent composes with the legacy shot-label behavior.
  blocking?: MomentBlocking | null
  // Which Setting this shot takes place in (assigned by the breakdown from the provided
  // settings list; editable in the inspector). null/undefined = unassigned.
  locationName?: string | null
  // Cached end-pose still for dual-keyframe animation (paid asset — kept once generated).
  endImageUrl?: string | null
  // Durable Storage object paths for the three paid assets above. These — not the *Url
  // fields — are what survives: provider URLs and signed URLs both expire, so every load
  // re-mints display URLs from these paths (see lib/assets.ts). null/undefined = the asset
  // was never mirrored (anonymous demo, or mirroring failed) and the URL is all we have.
  imageStoragePath?: string | null
  endImageStoragePath?: string | null
  videoStoragePath?: string | null
  // Which model produced the current clip (provenance): Kling 1.6 single-frame or
  // Kling O3 dual-keyframe. undefined = legacy → Kling 1.6.
  videoModel?: 'kling-1.6' | 'kling-o3-anchored' | null
  imageUrl: string | null
  // Provenance only: the exact prompt last SENT to the image model. Written on every
  // successful generation for inspection/debugging. It is NOT an override and must never
  // be fed back in as one — regeneration always recomposes from current canonical state.
  imagePrompt: string | null
  // Intentional user-authored prompt override (inspector PROMPT field). This — and only
  // this — is passed as the render's promptOverride, taking the place of buildImagePrompt.
  // null/undefined = no override → always auto-compose from cast/setting/startFrame.
  userPromptOverride?: string | null
  // True when a canonical composition input (cast, location, or the startFrame source)
  // changed after the override was authored, so the override no longer reflects current
  // state. Surfaced as a "stale" warning; cleared when the user re-edits or resets it.
  userPromptOverrideStale?: boolean | null
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
  // Durable Storage object path for the bridge clip (see Moment's *StoragePath fields).
  videoStoragePath?: string | null
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
