import { PRD_SECTION_DEFINITIONS, type PRDDocument, type PRDEvidence, type PRDReference, type PRDRequirement, type PRDSection, type PRDSectionId, type PRDDocumentStatus } from './types'

export class PRDValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'PRDValidationError' }
}

const sectionIds = new Set<string>(PRD_SECTION_DEFINITIONS.map(section => section.id))
const documentStatuses = new Set<string>(['draft', 'in-review', 'approved'])
const sectionStatuses = new Set<string>(['complete', 'partial', 'uncertain', 'unknown', 'not-applicable'])
const requirementStatuses = new Set<string>(['supported', 'proposed', 'uncertain', 'unknown', 'not-applicable'])
const priorities = new Set<string>(['must', 'should', 'could', 'unknown'])
const referenceKinds = new Set<string>(['evidence', 'requirement', 'section', 'external'])

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PRDValidationError(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function string(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new PRDValidationError(`${label} must be a non-empty string.`)
  return value.trim()
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new PRDValidationError(`${label} must be an array.`)
  return value
}
function stringArray(value: unknown, label: string, maxItems = 100): string[] {
  const values = array(value, label)
  if (values.length > maxItems || values.some(item => typeof item !== 'string' || item.trim().length === 0)) throw new PRDValidationError(`${label} must contain bounded non-empty strings.`)
  return values.map(item => (item as string).trim())
}
function enumValue<T extends string>(value: unknown, allowed: Set<string>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) throw new PRDValidationError(`${label} has an unsupported value.`)
  return value as T
}
function unique(values: string[], label: string): string[] {
  if (new Set(values).size !== values.length) throw new PRDValidationError(`${label} contains duplicate IDs.`)
  return values
}

function token(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[_\s]+/g, '-') : value
}

function requirementStatus(value: unknown): unknown {
  const normalized = token(value)
  if (normalized === 'implemented' || normalized === 'complete' || normalized === 'verified') return 'supported'
  if (normalized === 'planned' || normalized === 'recommendation' || normalized === 'future') return 'proposed'
  if (normalized === 'inferred' || normalized === 'partial' || normalized === 'likely') return 'uncertain'
  return normalized
}

function sectionStatus(value: unknown): unknown {
  const normalized = token(value)
  if (normalized === 'supported' || normalized === 'implemented' || normalized === 'verified') return 'complete'
  if (normalized === 'inferred' || normalized === 'likely') return 'uncertain'
  return normalized
}

function documentStatus(value: unknown): unknown {
  const normalized = token(value)
  if (normalized === 'in-review' || normalized === 'review' || normalized === 'inreview') return 'in-review'
  return normalized
}

function priority(value: unknown): unknown {
  const normalized = token(value)
  if (normalized === 'p0' || normalized === 'critical' || normalized === 'high') return 'must'
  if (normalized === 'p1' || normalized === 'medium-high') return 'should'
  if (normalized === 'p2' || normalized === 'medium' || normalized === 'low') return 'could'
  if (normalized === 'p3' || normalized === 'nice-to-have' || normalized === 'nice') return 'unknown'
  return normalized
}

function normalizeReference(value: unknown, index: number): PRDReference {
  const item = record(value, `references[${index}]`)
  const result: PRDReference = {
    id: string(item.id, `references[${index}].id`, 160),
    kind: enumValue(item.kind, referenceKinds, `references[${index}].kind`),
    label: string(item.label, `references[${index}].label`, 500),
    target: string(item.target, `references[${index}].target`, 500),
  }
  if (item.url !== undefined) result.url = string(item.url, `references[${index}].url`, 2_000)
  return result
}

function normalizeRequirement(value: unknown, index: number, evidenceIds: Set<string>): PRDRequirement {
  const item = record(value, `requirements[${index}]`)
  const ids = unique(stringArray(item.evidenceIds, `requirements[${index}].evidenceIds`, 20), `requirements[${index}].evidenceIds`)
  if (ids.some(id => !evidenceIds.has(id))) throw new PRDValidationError(`requirements[${index}] references unsupported evidence.`)
  return {
    id: string(item.id, `requirements[${index}].id`, 160),
    text: string(item.text, `requirements[${index}].text`, 2_000),
    actor: string(item.actor, `requirements[${index}].actor`, 500),
    preconditions: stringArray(item.preconditions, `requirements[${index}].preconditions`, 20),
    trigger: string(item.trigger, `requirements[${index}].trigger`, 500),
    expectedBehavior: stringArray(item.expectedBehavior, `requirements[${index}].expectedBehavior`, 30),
    inputs: stringArray(item.inputs, `requirements[${index}].inputs`, 20),
    outputs: stringArray(item.outputs, `requirements[${index}].outputs`, 20),
    businessRules: stringArray(item.businessRules, `requirements[${index}].businessRules`, 20),
    errorConditions: stringArray(item.errorConditions, `requirements[${index}].errorConditions`, 20),
    relatedDependencies: stringArray(item.relatedDependencies, `requirements[${index}].relatedDependencies`, 20),
    status: enumValue(item.status === undefined ? 'unknown' : requirementStatus(item.status), requirementStatuses, `requirements[${index}].status`),
    priority: enumValue(item.priority === undefined ? 'unknown' : priority(item.priority), priorities, `requirements[${index}].priority`),
    acceptanceCriteria: stringArray(item.acceptanceCriteria, `requirements[${index}].acceptanceCriteria`, 30),
    evidenceIds: ids,
    rationale: string(item.rationale, `requirements[${index}].rationale`, 2_000),
  }
}

export function normalizePrdEvidence(value: unknown, index: number): PRDEvidence {
  const item = record(value, `evidence[${index}]`)
  const result: PRDEvidence = {
    id: string(item.id, `evidence[${index}].id`, 160),
    kind: enumValue(item.kind, new Set(['path', 'manifest', 'snippet', 'import', 'tree', 'metadata', 'inference']), `evidence[${index}].kind`),
    source: string(item.source, `evidence[${index}].source`, 500),
    description: string(item.description, `evidence[${index}].description`, 1_000),
    confidence: enumValue(item.confidence, new Set(['high', 'medium', 'low']), `evidence[${index}].confidence`),
  }
  if (item.quote !== undefined) result.quote = string(item.quote, `evidence[${index}].quote`, 600)
  if (item.line !== undefined && (typeof item.line !== 'number' || !Number.isInteger(item.line) || item.line < 1)) throw new PRDValidationError(`evidence[${index}].line must be a positive integer.`)
  if (item.line !== undefined) result.line = item.line as number
  return result
}

export function normalizePrdSection(value: unknown, expectedId?: PRDSectionId, evidenceIds = new Set<string>()): PRDSection {
  const item = record(value, 'section')
  const id = enumValue<PRDSectionId>(item.id, sectionIds, 'section.id')
  if (expectedId && id !== expectedId) throw new PRDValidationError(`Expected section ${expectedId}.`)
  const sectionEvidence = unique(stringArray(item.evidenceIds, 'section.evidenceIds', 40), 'section.evidenceIds')
  if (sectionEvidence.some(evidenceId => !evidenceIds.has(evidenceId))) throw new PRDValidationError('section references unsupported evidence.')
  const rawRequirements = array(item.requirements, 'section.requirements')
  const requirements = rawRequirements.map((requirement, index) => normalizeRequirement(requirement, index, evidenceIds))
  if (new Set(requirements.map(requirement => requirement.id)).size !== requirements.length) throw new PRDValidationError('section requirements contain duplicate IDs.')
  return {
    id,
    title: string(item.title, 'section.title', 300),
    status: enumValue(sectionStatus(item.status), sectionStatuses, 'section.status'),
    summary: string(item.summary, 'section.summary', 3_000),
    content: stringArray(item.content, 'section.content', 100),
    requirements,
    evidenceIds: sectionEvidence,
    references: array(item.references, 'section.references').map((reference, index) => normalizeReference(reference, index)),
  }
}

export function normalizePrdDocument(value: unknown, allowedEvidenceIds?: Set<string>): PRDDocument {
  const item = record(value, 'document')
  if (item.schemaVersion !== '1.0') throw new PRDValidationError('document.schemaVersion must be "1.0".')
  const evidence = array(item.evidence, 'document.evidence').map(normalizePrdEvidence)
  if (new Set(evidence.map(entry => entry.id)).size !== evidence.length) throw new PRDValidationError('document.evidence contains duplicate IDs.')
  if (allowedEvidenceIds && evidence.some(entry => !allowedEvidenceIds.has(entry.id))) throw new PRDValidationError('document.evidence contains unsupported evidence IDs.')
  const evidenceIds = new Set(evidence.map(entry => entry.id))
  const sections = array(item.sections, 'document.sections').map(section => normalizePrdSection(section, undefined, evidenceIds))
  if (sections.length !== PRD_SECTION_DEFINITIONS.length) throw new PRDValidationError(`document.sections must contain exactly ${PRD_SECTION_DEFINITIONS.length} sections.`)
  const expected = PRD_SECTION_DEFINITIONS.map(section => section.id)
  if (sections.some((section, index) => section.id !== expected[index])) throw new PRDValidationError('document.sections must use the canonical order and IDs.')
  const version = record(item.version, 'document.version')
  if (typeof version.number !== 'number' || !Number.isInteger(version.number) || version.number < 1) throw new PRDValidationError('document.version.number must be a positive integer.')
  return {
    schemaVersion: '1.0',
    title: string(item.title, 'document.title', 500),
    projectName: string(item.projectName, 'document.projectName', 300),
    status: enumValue<PRDDocumentStatus>(documentStatus(item.status), documentStatuses, 'document.status'),
    version: {
      number: version.number,
      label: string(version.label, 'document.version.label', 100),
      createdAt: string(version.createdAt, 'document.version.createdAt', 100),
      changeSummary: string(version.changeSummary, 'document.version.changeSummary', 1_000),
    },
    sections,
    evidence,
    references: array(item.references, 'document.references').map((reference, index) => normalizeReference(reference, index)),
  }
}
