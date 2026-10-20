import type { ProjectModel } from '../analysis/types'
import type { PRDEvidence } from './types'

export const PRD_EVIDENCE_LIMITS = {
  maxEntries: 180,
  maxQuoteCharacters: 360,
  maxDescriptionCharacters: 280,
  maxMapCharacters: 36_000,
} as const

export interface EvidenceMap {
  entries: PRDEvidence[]
  serialized: string
}

function cap(value: string, max: number): string {
  const clean = value.replace(/\u0000/g, '').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) } catch { return '[unserializable]' }
}

/**
 * Makes a stable, bounded projection of analysis evidence. All values in the
 * projection are data; prompt construction explicitly marks them as untrusted.
 */
export function buildEvidenceMap(project: ProjectModel): EvidenceMap {
  const entries: PRDEvidence[] = project.evidence
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, PRD_EVIDENCE_LIMITS.maxEntries)
    .map(evidence => ({
      id: cap(evidence.id, 120),
      kind: evidence.kind,
      source: cap(evidence.path ?? project.project.fullName, 240),
      description: cap(evidence.description, PRD_EVIDENCE_LIMITS.maxDescriptionCharacters),
      ...(evidence.quote ? { quote: cap(evidence.quote, PRD_EVIDENCE_LIMITS.maxQuoteCharacters) } : {}),
      ...(typeof evidence.line === 'number' ? { line: evidence.line } : {}),
      confidence: evidence.confidence,
    }))

  const modelSummary = {
    project: {
      name: cap(project.project.name, 160),
      fullName: cap(project.project.fullName, 240),
      description: project.project.description ? cap(project.project.description, 500) : null,
      primaryLanguage: project.project.primaryLanguage,
    },
    files: project.files.slice().sort((a, b) => a.path.localeCompare(b.path)).slice(0, 220).map(file => ({
      path: cap(file.path, 240), role: file.role, language: file.language, evidenceIds: file.evidenceIds.slice(0, 8),
    })),
    technologies: project.technologies.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80).map(item => ({
      name: cap(item.name, 120), category: item.category, evidenceIds: item.evidenceIds.slice(0, 8),
    })),
    evidence: entries,
  }
  let serialized = safeJson(modelSummary)
  if (serialized.length > PRD_EVIDENCE_LIMITS.maxMapCharacters) {
    serialized = `${serialized.slice(0, PRD_EVIDENCE_LIMITS.maxMapCharacters - 1)}…`
  }
  return { entries, serialized }
}
