import type { ProjectModel } from '../analysis/types'
import { buildEvidenceMap } from './evidence-map'
import { buildPrdPrompt } from './prompt'
import { normalizePrdDocument, normalizePrdSection, PRDValidationError } from './schema'
import type { PRDDocument, PRDGenerationResult, PRDSection, PRDSectionId } from './types'

export const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'

export type FetchImpl = typeof fetch

export class PRDUpstreamError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) { super(message); this.name = 'PRDUpstreamError'; this.status = status }
}

export class PRDConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'PRDConfigurationError' }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
}

const documentResponseSchema = {
  type: 'OBJECT',
  properties: {
    schemaVersion: { type: 'STRING' }, title: { type: 'STRING' }, projectName: { type: 'STRING' }, status: { type: 'STRING' },
    version: { type: 'OBJECT', properties: { number: { type: 'INTEGER' }, label: { type: 'STRING' }, createdAt: { type: 'STRING' }, changeSummary: { type: 'STRING' } }, required: ['number', 'label', 'createdAt', 'changeSummary'] },
    sections: { type: 'ARRAY', items: { type: 'OBJECT' } }, evidence: { type: 'ARRAY', items: { type: 'OBJECT' } }, references: { type: 'ARRAY', items: { type: 'OBJECT' } },
  },
  required: ['schemaVersion', 'title', 'projectName', 'status', 'version', 'sections', 'evidence', 'references'],
} as const

const sectionResponseSchema = {
  type: 'OBJECT',
  properties: {
    id: { type: 'STRING' }, title: { type: 'STRING' }, status: { type: 'STRING' }, summary: { type: 'STRING' },
    content: { type: 'ARRAY', items: { type: 'STRING' } }, requirements: { type: 'ARRAY', items: { type: 'OBJECT' } },
    evidenceIds: { type: 'ARRAY', items: { type: 'STRING' } }, references: { type: 'ARRAY', items: { type: 'OBJECT' } },
  },
  required: ['id', 'title', 'status', 'summary', 'content', 'requirements', 'evidenceIds', 'references'],
} as const

function extractJson(response: GeminiResponse): unknown {
  const text = response.candidates?.[0]?.content?.parts?.find(part => typeof part.text === 'string')?.text
  if (typeof text !== 'string' || text.trim().length === 0) throw new PRDValidationError('Gemini returned no structured content.')
  try { return JSON.parse(text) as unknown } catch { throw new PRDValidationError('Gemini returned malformed JSON.') }
}

function sectionFromResponse(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'section' in value) return (value as { section: unknown }).section
  return value
}

export interface GeneratePrdOptions {
  fetchImpl?: FetchImpl
  apiKey?: string
  model?: string
}

export type PRDRequestOptions = {
  document?: PRDDocument
  sectionId?: PRDSectionId
  userContext?: string
} & GeneratePrdOptions

/** Calls Gemini directly; the key is read only on the server and can be injected in tests. */
export async function generatePrd(
  project: ProjectModel,
  options: PRDRequestOptions = {},
  transport: GeneratePrdOptions = {},
): Promise<PRDGenerationResult> {
  const configuredKey = transport.apiKey ?? options.apiKey ?? process.env.GEMINI_API_KEY
  if (!configuredKey || configuredKey.trim().length === 0) throw new PRDConfigurationError('GEMINI_API_KEY is not configured.')
  const apiKey = configuredKey.trim()
  const model = transport.model?.trim() || options.model?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
  const fetchImpl = transport.fetchImpl ?? options.fetchImpl ?? fetch
  const allowedEvidenceIds = new Set(buildEvidenceMap(project).entries.map(entry => entry.id))
  const existingDocument = options.document ? normalizePrdDocument(options.document, allowedEvidenceIds) : undefined
  const prompt = buildPrdPrompt({ project, ...options, document: existingDocument })
  const url = `${GEMINI_API_ROOT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: options.sectionId ? sectionResponseSchema : documentResponseSchema },
      }),
    })
  } catch {
    throw new PRDUpstreamError('Gemini could not be reached.')
  }
  if (!response.ok) throw new PRDUpstreamError('Gemini rejected the generation request.', response.status)
  let payload: GeminiResponse
  try { payload = await response.json() as GeminiResponse } catch { throw new PRDUpstreamError('Gemini returned an unreadable response.', response.status) }
  const raw = extractJson(payload)
  if (options.sectionId) {
    if (!existingDocument) throw new PRDValidationError('A document is required for section regeneration.')
    const current = existingDocument
    const section = normalizePrdSection(sectionFromResponse(raw), options.sectionId, new Set(current.evidence.map(entry => entry.id)))
    const sections = current.sections.map(item => item.id === section.id ? section : item)
    const document = normalizePrdDocument({ ...current, sections, version: { ...current.version, number: current.version.number + 1, changeSummary: `Regenerated ${section.title}.` } }, allowedEvidenceIds)
    return { document, prompt }
  }
  return { document: normalizePrdDocument(raw, allowedEvidenceIds), prompt }
}
