'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { exportImagesZip, exportStoryboardPdf } from '@/lib/export'
import type { Project } from '@/types'

interface ExportControlsProps {
  project: Project
}

export function ExportControls({ project }: ExportControlsProps) {
  const [busy, setBusy] = useState<'pdf' | 'zip' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: 'pdf' | 'zip') {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'pdf') await exportStoryboardPdf(project)
      else await exportImagesZip(project)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Please try again.')
    }
    setBusy(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => run('pdf')} disabled={busy !== null} className="flex-1">
          {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
        </Button>
        <Button variant="outline" onClick={() => run('zip')} disabled={busy !== null} className="flex-1">
          {busy === 'zip' ? 'Zipping…' : 'Download Images (.zip)'}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
