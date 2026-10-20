import type { Evidence as AnalysisEvidence, ProjectModel } from '../analysis/types'

/** The stable order and identifiers used by every generated PRD. */
export const PRD_SECTION_DEFINITIONS = [
  { id: 'document-overview', title: 'Document overview' },
  { id: 'executive-summary', title: 'Executive summary' },
  { id: 'product-overview', title: 'Product overview' },
  { id: 'goals-and-non-goals', title: 'Goals and non-goals' },
  { id: 'target-users-and-personas', title: 'Target users and personas' },
  { id: 'functional-requirements', title: 'Functional requirements' },
  { id: 'feature-catalog', title: 'Feature catalog' },
  { id: 'user-journeys-and-workflows', title: 'User journeys and workflows' },
  { id: 'user-stories', title: 'User stories' },
  { id: 'business-rules-and-domain-logic', title: 'Business rules and domain logic' },
  { id: 'information-architecture', title: 'Information architecture' },
  { id: 'ui-ux-requirements', title: 'UI/UX requirements' },
  { id: 'api-and-integration-requirements', title: 'API and integration requirements' },
  { id: 'data-model-and-persistence', title: 'Data model and persistence' },
  { id: 'system-architecture-and-technical-constraints', title: 'System architecture and technical constraints' },
  { id: 'non-functional-requirements', title: 'Non-functional requirements' },
  { id: 'security-privacy-and-permissions', title: 'Security, privacy, and permissions' },
  { id: 'error-handling-and-edge-cases', title: 'Error handling and edge cases' },
  { id: 'analytics-and-success-metrics', title: 'Analytics and success metrics' },
  { id: 'dependencies-and-constraints', title: 'Dependencies and constraints' },
  { id: 'testing-and-acceptance-strategy', title: 'Testing and acceptance strategy' },
  { id: 'known-issues-and-implementation-gaps', title: 'Known issues and implementation gaps' },
  { id: 'future-improvements-and-roadmap', title: 'Future improvements and roadmap' },
  { id: 'assumptions-and-open-questions', title: 'Assumptions and open questions' },
  { id: 'glossary-and-references', title: 'Glossary and references' },
] as const

export type PRDSectionId = typeof PRD_SECTION_DEFINITIONS[number]['id']
export type PRDDocumentStatus = 'draft' | 'in-review' | 'approved'
export type PRDRequirementStatus = 'supported' | 'proposed' | 'uncertain' | 'unknown' | 'not-applicable'
export type PRDSectionStatus = 'complete' | 'partial' | 'uncertain' | 'unknown' | 'not-applicable'

export interface PRDVersion {
  number: number
  label: string
  createdAt: string
  changeSummary: string
}

/** A reference is intentionally separate from evidence: it may point to a requirement or a public URL. */
export interface PRDReference {
  id: string
  kind: 'evidence' | 'requirement' | 'section' | 'external'
  label: string
  target: string
  url?: string
}

export interface PRDEvidence {
  id: string
  kind: AnalysisEvidence['kind']
  source: string
  description: string
  quote?: string
  line?: number
  confidence: AnalysisEvidence['confidence']
}

export interface PRDRequirement {
  id: string
  text: string
  actor: string
  preconditions: string[]
  trigger: string
  expectedBehavior: string[]
  inputs: string[]
  outputs: string[]
  businessRules: string[]
  errorConditions: string[]
  relatedDependencies: string[]
  status: PRDRequirementStatus
  priority: 'must' | 'should' | 'could' | 'unknown'
  acceptanceCriteria: string[]
  evidenceIds: string[]
  rationale: string
}

export interface PRDSection {
  id: PRDSectionId
  title: string
  status: PRDSectionStatus
  summary: string
  content: string[]
  requirements: PRDRequirement[]
  evidenceIds: string[]
  references: PRDReference[]
}

export interface PRDDocument {
  schemaVersion: '1.0'
  title: string
  projectName: string
  status: PRDDocumentStatus
  version: PRDVersion
  sections: PRDSection[]
  evidence: PRDEvidence[]
  references: PRDReference[]
}

export interface PRDGenerationInput {
  project: ProjectModel
  document?: PRDDocument
  sectionId?: PRDSectionId
  userContext?: string
}

export interface PRDGenerationResult {
  document: PRDDocument
  prompt: string
}
