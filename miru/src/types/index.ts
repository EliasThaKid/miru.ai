export type ShotType = 'wide' | 'medium' | 'close-up' | 'pov' | 'over-the-shoulder'
export type StylePreset = 'anime' | 'cinematic' | 'illustrated' | 'hyper-realistic'

export interface Scene {
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
  fromSceneId: string
  toSceneId: string
  videoUrl: string | null
  transitionPrompt: string | null
  generatedAt: string | null
}

export interface Project {
  id: string
  title: string
  script: string
  characterDescription: string
  stylePreset: StylePreset
  scenes: Scene[]
  transitions: Transition[]
  createdAt: string
  updatedAt: string
}
