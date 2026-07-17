'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { ConnectionMode, Moment, Transition } from '@/types'

const CONNECTION_MODES: { value: ConnectionMode; label: string }[] = [
  { value: 'hard-cut', label: 'Hard Cut' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'fade-to-black', label: 'Fade to Black' },
  { value: 'generated-bridge', label: 'Generated Bridge ✦ AI' },
]

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
  const bridgeSelected = activeMode === 'generated-bridge'
  const bridgeReady = Boolean(transition?.videoUrl)

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

            <Select value={activeMode} onValueChange={(value) => onSetConnectionMode(value as ConnectionMode)}>
              <SelectTrigger className="w-full" size="sm">
                {/* Base UI's SelectValue renders the raw value; show the label instead. */}
                <SelectValue>{CONNECTION_MODES.find((m) => m.value === activeMode)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CONNECTION_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {bridgeSelected ? (
              bridgeReady ? (
                <video
                  src={transition?.videoUrl ?? undefined}
                  controls
                  className="aspect-9/16 w-full rounded-2xl object-cover"
                />
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
                  {!canBridge && <p className="text-xs text-muted-foreground">Both moments need images first.</p>}
                </>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                {activeMode === 'hard-cut'
                  ? 'Instant editorial cut — free, no generation.'
                  : 'Deterministic playback effect — free, no generation.'}
                {bridgeReady ? ' A generated bridge is saved for this pair.' : ''}
              </p>
            )}

            {bridgeError ? <p className="text-xs text-destructive">{bridgeError}</p> : null}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
