import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { sanitizeArtifactPayload } from './sanitize'
import type { NormalizedArtifactPayload } from './types'

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 54
const BODY_SIZE = 10.5
const BODY_LEADING = 15

function pdfSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?')
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(pdfSafe(candidate), size) <= maxWidth || !line) {
        line = candidate
      } else {
        lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

export async function generatePdf(input: unknown): Promise<Uint8Array> {
  const payload: NormalizedArtifactPayload = sanitizeArtifactPayload(input)
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  let page: PDFPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  const ensureSpace = (height: number) => {
    if (y - height < MARGIN) {
      page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN
    }
  }
  const drawWrapped = (text: string, options: { size: number; font: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gapAfter?: number }) => {
    const indent = options.indent ?? 0
    const lines = wrapText(text, options.font, options.size, PAGE_WIDTH - (MARGIN * 2) - indent)
    for (const line of lines) {
      ensureSpace(options.size + 4)
      page.drawText(pdfSafe(line), {
        x: MARGIN + indent,
        y,
        size: options.size,
        font: options.font,
        color: options.color ?? rgb(0.12, 0.14, 0.18),
      })
      y -= options.size + 4
    }
    y -= options.gapAfter ?? 4
  }
  const heading = (text: string, size: number, gapAfter = 8) => {
    ensureSpace(size + 16)
    drawWrapped(text, { size, font: bold, color: rgb(0.18, 0.12, 0.38), gapAfter })
  }

  heading(payload.projectName, 11, 4)
  heading(payload.title, 24, 14)
  for (const paragraph of payload.paragraphs) drawWrapped(paragraph, { size: BODY_SIZE, font: regular, gapAfter: 6 })
  for (const item of payload.headings) {
    heading(item.text, item.level === 1 ? 17 : item.level === 3 ? 11 : 14, 6)
  }
  if (payload.bullets.length > 0) {
    heading('Key points', 14, 4)
    for (const bullet of payload.bullets) drawWrapped(`- ${bullet}`, { size: BODY_SIZE, font: regular, indent: 10, gapAfter: 3 })
  }
  if (payload.diagramSummary) {
    heading(payload.diagramSummary.title, 14, 4)
    if (payload.diagramSummary.summary) drawWrapped(payload.diagramSummary.summary, { size: BODY_SIZE, font: regular, gapAfter: 5 })
    if (payload.diagramSummary.nodes.length) drawWrapped(`Nodes: ${payload.diagramSummary.nodes.join('  |  ')}`, { size: BODY_SIZE, font: regular, gapAfter: 4 })
    for (const edge of payload.diagramSummary.edges) {
      drawWrapped(`- ${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ''}`, { size: BODY_SIZE, font: regular, indent: 10, gapAfter: 3 })
    }
  }

  return document.save()
}
