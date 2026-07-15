'use client'

import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Scene } from '@/types'

interface SceneCardProps {
  scene: Scene
  isGenerating: boolean
  error: string | null
  onGenerateImage: () => void
  isGeneratingVideo: boolean
  videoError: string | null
  onAnimateScene: () => void
}

export function SceneCard({
  scene,
  isGenerating,
  error,
  onGenerateImage,
  isGeneratingVideo,
  videoError,
  onAnimateScene,
}: SceneCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Scene {scene.number}</span>
          <Badge variant="outline">{scene.shotType}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{scene.description}</p>
        <p className="text-xs text-muted-foreground">{scene.durationSeconds}s</p>

        {isGenerating || isGeneratingVideo ? (
          <Skeleton className="aspect-9/16 w-full rounded-2xl" />
        ) : scene.videoUrl ? (
          <video
            src={scene.videoUrl}
            poster={scene.imageUrl ?? undefined}
            controls
            className="aspect-9/16 w-full rounded-2xl object-cover"
          />
        ) : scene.imageUrl ? (
          <div className="relative aspect-9/16 w-full overflow-hidden rounded-2xl">
            <Image src={scene.imageUrl} alt={scene.description} fill className="object-cover" unoptimized />
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {videoError ? <p className="text-xs text-destructive">{videoError}</p> : null}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {!scene.imageUrl && (
          <Button onClick={onGenerateImage} disabled={isGenerating} className="w-full">
            {isGenerating ? 'Generating…' : 'Generate Image'}
          </Button>
        )}
        {scene.imageUrl && !scene.videoUrl && (
          <Button onClick={onAnimateScene} disabled={isGeneratingVideo} className="w-full">
            {isGeneratingVideo ? 'Animating… (~2-5 min)' : 'Animate Scene'}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
