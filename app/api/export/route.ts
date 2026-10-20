import { NextResponse } from 'next/server'
import {
  EXPORT_INPUT_LIMIT_BYTES,
  generateExport,
  type ExportFormat,
} from '../../../lib/exports'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FORMATS: ExportFormat[] = ['pdf', 'docx', 'pptx']

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { code: 'INVALID_REQUEST', message } }, { status })
}

export async function POST(request: Request) {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return jsonError('Request body could not be read.', 400)
  }
  if (new TextEncoder().encode(raw).byteLength > EXPORT_INPUT_LIMIT_BYTES) {
    return jsonError(`Export payload is limited to ${EXPORT_INPUT_LIMIT_BYTES.toLocaleString()} bytes.`, 413)
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return jsonError('Request body must be valid JSON.', 400)
  }
  if (!body || typeof body !== 'object') return jsonError('Provide an export object with a format and artifact payload.', 400)

  const record = body as Record<string, unknown>
  const format = record.format
  if (typeof format !== 'string' || !FORMATS.includes(format as ExportFormat)) {
    return jsonError('The "format" field must be one of: pdf, docx, pptx.', 400)
  }
  const artifact = record.artifact ?? record.payload ?? record
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return jsonError('Provide an object in the "artifact" field.', 400)
  }
  const artifactRecord = artifact as Record<string, unknown>
  if (typeof artifactRecord.projectName !== 'string' || artifactRecord.projectName.trim().length === 0) {
    return jsonError('The artifact requires a non-empty "projectName".', 400)
  }
  if (typeof artifactRecord.title !== 'string' || artifactRecord.title.trim().length === 0) {
    return jsonError('The artifact requires a non-empty "title".', 400)
  }

  try {
    const result = await generateExport(format as ExportFormat, artifact)
    const bodyBytes = new Uint8Array(result.data)
    return new NextResponse(bodyBytes, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(bodyBytes.byteLength),
        'Content-Disposition': `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return jsonError('The artifact could not be exported.', 500)
  }
}
