import { NextResponse } from 'next/server'
import type { ProjectModel } from '../../../../lib/analysis/types'
import {
  generatePrd,
  buildEvidenceMap,
  normalizePrdDocument,
  PRDConfigurationError,
  PRD_SECTION_DEFINITIONS,
  PRDUpstreamError,
  PRDValidationError,
  type PRDDocument,
  type PRDSectionId,
} from '../../../../lib/prd'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ErrorCode = 'INVALID_REQUEST' | 'MISSING_API_KEY' | 'UPSTREAM_FAILURE' | 'MALFORMED_OUTPUT'

function errorResponse(code: ErrorCode, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isProjectModel(value: unknown): value is ProjectModel {
  if (!isRecord(value)) return false
  const project = value.project
  return isRecord(project)
    && typeof project.name === 'string'
    && typeof project.fullName === 'string'
    && Array.isArray(value.files)
    && Array.isArray(value.technologies)
    && Array.isArray(value.evidence)
    && isRecord(value.flow)
    && isRecord(value.systemDesign)
    && Array.isArray(value.interviewSeeds)
    && isRecord(value.analysis)
}

function isSectionId(value: unknown): value is PRDSectionId {
  return typeof value === 'string' && PRD_SECTION_DEFINITIONS.some(section => section.id === value)
}

export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch { return errorResponse('INVALID_REQUEST', 'Request body must be valid JSON.', 400) }
  if (!isRecord(body) || !isProjectModel(body.project)) return errorResponse('INVALID_REQUEST', 'The "project" field must be a valid ProjectModel.', 400)

  const sectionId = body.sectionId
  if (sectionId !== undefined && !isSectionId(sectionId)) return errorResponse('INVALID_REQUEST', 'The "sectionId" field must be one of the canonical PRD section IDs.', 400)
  if (body.userContext !== undefined && (typeof body.userContext !== 'string' || body.userContext.length > 4_000)) {
    return errorResponse('INVALID_REQUEST', 'The "userContext" field must be a string of at most 4,000 characters.', 400)
  }
  let document: PRDDocument | undefined
  if (body.document !== undefined) {
    if (!isRecord(body.document)) return errorResponse('INVALID_REQUEST', 'The "document" field must be a PRD document object.', 400)
    try {
      document = normalizePrdDocument(body.document, new Set(buildEvidenceMap(body.project).entries.map(entry => entry.id)))
    } catch {
      return errorResponse('INVALID_REQUEST', 'The "document" field must be a valid PRD document for this project.', 400)
    }
  }
  if (sectionId !== undefined && body.document === undefined) return errorResponse('INVALID_REQUEST', 'A document is required when regenerating a section.', 400)

  try {
    const result = await generatePrd(body.project, {
      document,
      sectionId,
      userContext: body.userContext as string | undefined,
    })
    return NextResponse.json(result.document, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof PRDConfigurationError) return errorResponse('MISSING_API_KEY', 'PRD generation is not configured on the server.', 503)
    if (error instanceof PRDValidationError) return errorResponse('MALFORMED_OUTPUT', 'Gemini returned a PRD that did not match the required schema or evidence map.', 502)
    if (error instanceof PRDUpstreamError) {
      return errorResponse('UPSTREAM_FAILURE', 'The PRD model could not complete the request. Try again shortly.', 502)
    }
    return errorResponse('UPSTREAM_FAILURE', 'The PRD could not be generated. Try again shortly.', 502)
  }
}
