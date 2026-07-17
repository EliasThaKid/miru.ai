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

export interface Project {
  id: string
  title: string
  script: string
  characterDescription: string
  stylePreset: StylePreset
  moments: Moment[]
  transitions: Transition[]   // sparse — only pairs the user has touched
  createdAt: string
  updatedAt: string
}
