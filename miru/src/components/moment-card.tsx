'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { ConnectionMode, Moment, Transition } from '@/types'

interface MomentCardProps {
  moment: Moment
  nextMoment: Moment | null
  transition: Transition | null
  isGeneratingImage: boolean
  imageError: string | null
  onGenerateImage: () => void
  isGeneratingVideo: boolean
  videoError: string | null
  onAnimateMoment: () => void
  isGeneratingBridge: boolean
  bridgeError: string | null
  onGenerateBridge: (bridgeDirection: string) => void
  onSetConnectionMode: (mode: ConnectionMode) => void
}

export function MomentCard({
  moment,
  nextMoment,
  transition,
  isGeneratingImage,
  imageError,
  onGenerateImage,
  isGeneratingVideo,
  videoError,
  onAnimateMoment,
  isGeneratingBridge,
  bridgeError,
  onGenerateBridge,
  onSetConnectionMode,
}: MomentCardProps) {
  const [bridgeDirection, setBridgeDirection] = useState('')

  // Absence of a Transition record means the default: Hard Cut.
  const activeMode: ConnectionMode = transition?.mode ?? 'hard-cut'
  const canBridge = Boolean(moment.imageUrl && nextMoment?.imageUrl)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Moment {moment.number}</span>
          <Badge variant="outline">{moment.shotType}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{moment.description}</p>
        <p className="text-xs text-muted-foreground">{moment.durationSeconds}s</p>

        {isGeneratingImage || isGeneratingVideo ? (
          <Skeleton className="aspect-9/16 w-full rounded-2xl" />
        ) : moment.videoUrl ? (
          <video
            src={moment.videoUrl}
            poster={moment.imageUrl ?? undefined}
            controls
            className="aspect-9/16 w-full rounded-2xl object-cover"
          />
        ) : moment.imageUrl ? (
          <div className="relative aspect-9/16 w-full overflow-hidden rounded-2xl">
            <Image src={moment.imageUrl} alt={moment.description} fill className="object-cover" unoptimized />
          </div>
        ) : null}

        {imageError ? <p className="text-xs text-destructive">{imageError}</p> : null}
        {videoError ? <p className="text-xs text-destructive">{videoError}</p> : null}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {!moment.imageUrl && (
          <Button onClick={onGenerateImage} disabled={isGeneratingImage} className="w-full">
            {isGeneratingImage ? 'Generating…' : 'Generate Image'}
          </Button>
        )}
        {moment.imageUrl && !moment.videoUrl && (
          <Button onClick={onAnimateMoment} disabled={isGeneratingVideo} className="w-full">
            {isGeneratingVideo ? 'Animating… (~2-5 min)' : 'Animate Moment'}
          </Button>
        )}

        {nextMoment && (
          <div className="flex w-full flex-col gap-2 border-t pt-3">
            <p className="text-xs font-medium">Connection to Moment {nextMoment.number}</p>

            {activeMode === 'hard-cut' ? (
              <>
                <p className="text-xs text-muted-foreground">Type: Hard Cut — instant, no generation</p>
                {transition?.videoUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSetConnectionMode('generated-bridge')}
                    className="w-full"
                  >
                    Use Generated Bridge
                  </Button>
                ) : (
                  <>
                    <Input
                      value={bridgeDirection}
                      onChange={(e) => setBridgeDirection(e.target.value)}
                      placeholder="Bridge direction (optional), e.g. she lowers her hand, camera tracks right"
                      disabled={isGeneratingBridge}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onGenerateBridge(bridgeDirection)}
                      disabled={!canBridge || isGeneratingBridge}
                      className="w-full"
                    >
                      {isGeneratingBridge ? 'Generating bridge… (~1-2 min)' : 'Generate Bridge ✦ AI'}
                    </Button>
                    {!canBridge && (
                      <p className="text-xs text-muted-foreground">Both moments need images first.</p>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Type: Generated Bridge ✦ AI</p>
                {transition?.videoUrl ? (
                  <video src={transition.videoUrl} controls className="aspect-9/16 w-full rounded-2xl object-cover" />
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSetConnectionMode('hard-cut')}
                  className="w-full"
                >
                  Use Hard Cut instead (bridge is kept)
                </Button>
              </>
            )}

            {bridgeError ? <p className="text-xs text-destructive">{bridgeError}</p> : null}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
