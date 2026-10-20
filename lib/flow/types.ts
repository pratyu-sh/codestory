import type { ProjectModel } from '../analysis/types'

export type FlowMode = 'user-flow' | 'technical-flow' | 'page-map'

export type SemanticNodeType =
  | 'start'
  | 'end'
  | 'page'
  | 'process'
  | 'decision'
  | 'input-output'
  | 'database'
  | 'api'
  | 'auth'
  | 'error'
  | 'subprocess'

export type FlowConfidence = number

export type ImplementationStatus = 'implemented' | 'partial' | 'inferred' | 'unknown'

export interface FlowSource {
  path: string
  line?: number
}

export interface FlowNode {
  id: string
  label: string
  type: SemanticNodeType
  confidence: FlowConfidence
  implementationStatus: ImplementationStatus
  evidenceIds: string[]
  evidenceQuotes: string[]
  path?: string
  sourcePath?: string
  sourceLine?: number
  source?: FlowSource
  metadata?: Record<string, string | number | boolean>
}

export interface FlowEdge {
  id: string
  from: string
  to: string
  label: string
  confidence: FlowConfidence
  implementationStatus: ImplementationStatus
  evidenceIds: string[]
  evidenceQuotes: string[]
  sourcePath?: string
  sourceLine?: number
  source?: FlowSource
}

export interface FlowGraphSettings {
  maxNodes: number
  maxEdges: number
  maxEvidenceQuotes: number
  maxEvidenceQuoteCharacters: number
  includeLowConfidence: boolean
}

export interface FlowGraphRevision {
  schemaVersion: '1.0'
  revision: number
  fingerprint: string
  sourceAnalysisAt: string
}

export interface FlowGraph {
  mode: FlowMode
  nodes: FlowNode[]
  edges: FlowEdge[]
  settings: FlowGraphSettings
  revision: FlowGraphRevision
  notes: string[]
}

export interface DeriveFlowGraphOptions extends Partial<FlowGraphSettings> {
  mode?: FlowMode
}

export interface FlowValidationIssue {
  code: 'duplicate-node-id' | 'invalid-edge-endpoint' | 'duplicate-edge' | 'invalid-reference'
  message: string
  nodeId?: string
  edgeId?: string
}

export interface FlowValidationResult {
  valid: boolean
  issues: FlowValidationIssue[]
  graph: FlowGraph
}

export type FlowProjectModel = ProjectModel
