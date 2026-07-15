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
}

export function SceneCard({ scene, isGenerating, error, onGenerateImage }: SceneCardProps) {
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

        {isGenerating ? (
          <Skeleton className="aspect-9/16 w-full rounded-2xl" />
        ) : scene.imageUrl ? (
          <div className="relative aspect-9/16 w-full overflow-hidden rounded-2xl">
            <Image src={scene.imageUrl} alt={scene.description} fill className="object-cover" unoptimized />
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
      <CardFooter>
        {!scene.imageUrl && (
          <Button onClick={onGenerateImage} disabled={isGenerating} className="w-full">
            {isGenerating ? 'Generating…' : 'Generate Image'}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
