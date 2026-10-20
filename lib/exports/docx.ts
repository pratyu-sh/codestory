import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { sanitizeArtifactPayload } from './sanitize'
import type { NormalizedArtifactPayload } from './types'

export async function generateDocx(input: unknown): Promise<Uint8Array> {
  const payload: NormalizedArtifactPayload = sanitizeArtifactPayload(input)
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: payload.projectName, bold: true, color: '5B3FA3', size: 22 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
    }),
    new Paragraph({ text: payload.title, heading: HeadingLevel.TITLE, spacing: { after: 260 } }),
  ]

  for (const paragraph of payload.paragraphs) {
    children.push(new Paragraph({ text: paragraph, spacing: { after: 160, line: 276 } }))
  }
  for (const item of payload.headings) {
    const heading = item.level === 1 ? HeadingLevel.HEADING_1 : item.level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2
    children.push(new Paragraph({ text: item.text, heading, spacing: { before: 180, after: 100 } }))
  }
  if (payload.bullets.length > 0) {
    children.push(new Paragraph({ text: 'Key points', heading: HeadingLevel.HEADING_2 }))
    for (const bullet of payload.bullets) {
      children.push(new Paragraph({ text: bullet, bullet: { level: 0 }, spacing: { after: 80 } }))
    }
  }
  if (payload.diagramSummary) {
    children.push(new Paragraph({ text: payload.diagramSummary.title, heading: HeadingLevel.HEADING_2 }))
    if (payload.diagramSummary.summary) children.push(new Paragraph({ text: payload.diagramSummary.summary, spacing: { after: 100 } }))
    for (const node of payload.diagramSummary.nodes) children.push(new Paragraph({ text: `Node: ${node}`, bullet: { level: 0 } }))
    for (const edge of payload.diagramSummary.edges) {
      children.push(new Paragraph({ text: `${edge.from} → ${edge.to}${edge.label ? ` (${edge.label})` : ''}`, bullet: { level: 0 } }))
    }
  }

  const document = new Document({
    creator: 'CodeAtlas',
    title: payload.title,
    subject: `CodeAtlas export for ${payload.projectName}`,
    sections: [{ children }],
  })
  const buffer = await Packer.toBuffer(document)
  return new Uint8Array(buffer)
}
