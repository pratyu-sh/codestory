/**
 * Shared, serialisable types for the CodeAtlas repository analysis pipeline.
 *
 * These types intentionally describe evidence and confidence alongside every
 * derived artifact. The analyzer is heuristic and must never present an
 * inferred relationship as if it came from executing the repository.
 */

export type AnalysisStatus = 'complete' | 'partial'

export type TechnologyCategory =
  | 'language'
  | 'framework'
  | 'runtime'
  | 'database'
  | 'orm'
  | 'build'
  | 'infrastructure'
  | 'service'
  | 'testing'
  | 'other'

export type EvidenceKind =
  | 'path'
  | 'manifest'
  | 'snippet'
  | 'import'
  | 'tree'
  | 'metadata'
  | 'inference'

export type EvidenceConfidence = 'high' | 'medium' | 'low'

export interface ProjectInfo {
  name: string
  owner: string
  fullName: string
  url: string
  apiUrl: string
  defaultBranch: string
  description: string | null
  primaryLanguage: string | null
  stars: number
  forks: number
  openIssues: number
  license: string | null
  isFork: boolean
}

export type FileRole =
  | 'manifest'
  | 'route'
  | 'service'
  | 'data-model'
  | 'component'
  | 'config'
  | 'test'
  | 'documentation'
  | 'source'
  | 'other'

export interface ProjectFile {
  path: string
  size: number
  sha: string
  url: string
  language: string | null
  role: FileRole
  evidenceIds: string[]
}

export interface Evidence {
  id: string
  kind: EvidenceKind
  path?: string
  line?: number
  quote?: string
  description: string
  confidence: EvidenceConfidence
}

export interface Technology {
  name: string
  category: TechnologyCategory
  confidence: number
  evidenceIds: string[]
}

export type GraphNodeType =
  | 'entrypoint'
  | 'service'
  | 'data-model'
  | 'component'
  | 'config'
  | 'technology'
  | 'source'

export interface GraphNode {
  id: string
  label: string
  type: GraphNodeType
  path?: string
  metadata?: Record<string, string | number | boolean>
  evidenceIds: string[]
}

export type GraphEdgeType =
  | 'imports'
  | 'calls'
  | 'persists'
  | 'uses'
  | 'contains'
  | 'inferred-flow'

export interface GraphEdge {
  id: string
  from: string
  to: string
  type: GraphEdgeType
  verified: boolean
  evidenceIds: string[]
}

export interface FlowStep {
  id: string
  order: number
  label: string
  kind: 'entrypoint' | 'service' | 'data-model' | 'component' | 'source'
  path?: string
  evidenceIds: string[]
}

export interface FlowModel {
  steps: FlowStep[]
  /** Alias for graph-oriented consumers that use nodes/edges for every view. */
  nodes: FlowStep[]
  edges: GraphEdge[]
  notes: string[]
}

export interface SystemDesignLayer {
  id: string
  label: string
  nodeIds: string[]
}

export interface SystemDesignModel {
  nodes: GraphNode[]
  edges: GraphEdge[]
  layers: SystemDesignLayer[]
  notes: string[]
}

export interface InterviewSeed {
  id: string
  category: 'architecture' | 'backend' | 'data' | 'frontend' | 'operations'
  question: string
  whyItMatters: string
  expectedSignals: string[]
  evidenceIds: string[]
}

export interface AnalysisLimits {
  maxFiles: number
  maxContentFiles: number
  maxSnippetCharacters: number
  maxEvidence: number
  maxGraphNodes: number
  maxGraphEdges: number
}

export interface AnalysisSummary {
  status: AnalysisStatus
  analyzedAt: string
  source: 'github-rest-api' | 'local-filesystem'
  codeExecution: false
  warnings: string[]
  skippedFileCount: number
  truncated: boolean
  limits: AnalysisLimits
}

export interface ProjectModel {
  project: ProjectInfo
  files: ProjectFile[]
  technologies: Technology[]
  evidence: Evidence[]
  flow: FlowModel
  systemDesign: SystemDesignModel
  interviewSeeds: InterviewSeed[]
  analysis: AnalysisSummary
}

export interface AnalyzeErrorBody {
  error: {
    code:
    | 'INVALID_URL'
    | 'NOT_FOUND'
    | 'RATE_LIMITED'
    | 'GITHUB_API_ERROR'
    | 'UPSTREAM_TIMEOUT'
    | 'INVALID_REQUEST'
    | 'ANALYSIS_FAILED'
    message: string
    retryAfterSeconds?: number
  }
}
