import { generateDocx } from './docx'
import { generatePdf } from './pdf'
import { generatePptx } from './pptx'
import { sanitizeArtifactPayload, sanitizeFilename } from './sanitize'
import type { ExportFormat, GeneratedExport } from './types'
import type { NormalizedArtifactPayload } from './types'

export * from './types'
export * from './sanitize'
export { generateDocx } from './docx'
export { generatePdf } from './pdf'
export { generatePptx } from './pptx'

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function filenameFor(payload: NormalizedArtifactPayload, format: ExportFormat): string {
  return sanitizeFilename(`${payload.projectName}-${payload.title}`, `.${format}`)
}

export async function generateExport(format: ExportFormat, input: unknown): Promise<GeneratedExport> {
  const payload = sanitizeArtifactPayload(input)
  let data: Uint8Array
  if (format === 'pdf') data = await generatePdf(payload)
  else if (format === 'docx') data = await generateDocx(payload)
  else if (format === 'pptx') data = await generatePptx(payload)
  else throw new Error(`Unsupported export format: ${String(format)}`)
  return { data, contentType: CONTENT_TYPES[format], extension: `.${format}`, filename: filenameFor(payload, format) }
}
