// Client-only export helpers (per locked architecture: pure client-side, no server
// involvement). The PDF is composed directly with jsPDF from the moment images rather
// than screenshotting DOM nodes — keeps export decoupled from UI markup.
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import { composeCharacterDescription } from '@/lib/prompts'
import type { Moment, Project } from '@/types'

// jsPDF's built-in fonts are latin-1; typographic characters (em dashes, curly quotes)
// that Claude's descriptions use would render as garbage.
function sanitize(text: string): string {
  return text
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
}

async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error("Couldn't download a moment image for the export. Please try again.")
  }
  return res.blob()
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read a downloaded image. Please try again.'))
    reader.readAsDataURL(blob)
  })
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function baseFilename(project: Project): string {
  const slug = project.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'scenelab'
}

function momentsWithImages(project: Project): (Moment & { imageUrl: string })[] {
  return project.moments.filter((m): m is Moment & { imageUrl: string } => Boolean(m.imageUrl))
}

// A4 portrait storyboard: cover page, then two moments per page (9:16 frames side by side
// with shot metadata above and the description below).
export async function exportStoryboardPdf(project: Project): Promise<void> {
  const moments = momentsWithImages(project)
  if (moments.length === 0) {
    throw new Error('Generate at least one moment image before exporting.')
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // Cover
  doc.setFontSize(24)
  doc.text(sanitize(project.title.trim() || 'SCENELAB Storyboard'), 20, 40)
  doc.setFontSize(11)
  doc.setTextColor(90)
  const coverLines = [
    `Style: ${project.stylePreset}`,
    composeCharacterDescription(project.characters)
      ? `Characters: ${sanitize(composeCharacterDescription(project.characters))}`
      : null,
    `${project.moments.length} moments (${moments.length} with images)`,
    new Date().toLocaleDateString(),
  ].filter((line): line is string => line !== null)
  coverLines.forEach((line, i) => {
    doc.text(doc.splitTextToSize(line, 170), 20, 55 + i * 8)
  })
  doc.setTextColor(0)

  const IMG_W = 82
  const IMG_H = (IMG_W * 16) / 9
  const COLS = [20, 108]
  const TOP = 22

  for (let i = 0; i < moments.length; i++) {
    const moment = moments[i]
    if (i % 2 === 0) doc.addPage()
    const x = COLS[i % 2]

    const dataUrl = await blobToDataUrl(await fetchImageBlob(moment.imageUrl))

    doc.setFontSize(12)
    doc.text(`Moment ${moment.number} - ${moment.shotType} - ${moment.durationSeconds}s`, x, TOP - 5)
    doc.addImage(dataUrl, 'JPEG', x, TOP, IMG_W, IMG_H)
    doc.setFontSize(9)
    doc.setTextColor(60)
    const description = doc.splitTextToSize(sanitize(moment.description), IMG_W).slice(0, 8)
    doc.text(description, x, TOP + IMG_H + 6)
    doc.setTextColor(0)
  }

  doc.save(`${baseFilename(project)}-storyboard.pdf`)
}

export async function exportImagesZip(project: Project): Promise<void> {
  const moments = momentsWithImages(project)
  if (moments.length === 0) {
    throw new Error('Generate at least one moment image before exporting.')
  }

  const zip = new JSZip()
  for (const moment of moments) {
    const blob = await fetchImageBlob(moment.imageUrl)
    zip.file(`moment-${String(moment.number).padStart(2, '0')}.jpg`, blob)
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(blob, `${baseFilename(project)}-images.zip`)
}
