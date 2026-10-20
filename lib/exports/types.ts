export type ExportFormat = 'pdf' | 'docx' | 'pptx'

export interface ArtifactHeading {
  text: string
  level?: 1 | 2 | 3
}

export interface ArtifactDiagramEdge {
  from: string
  to: string
  label?: string
}

export interface ArtifactDiagramSummary {
  title?: string
  summary?: string
  nodes?: string[]
  edges?: ArtifactDiagramEdge[]
}

/**
 * The small, serialisable contract shared by every export format. Keep this
 * payload presentation-oriented: callers should provide summaries rather than
 * raw repository files or source trees.
 */
export interface ArtifactPayload {
  projectName: string
  title: string
  headings?: Array<string | ArtifactHeading>
  paragraphs?: string[]
  bullets?: string[]
  diagramSummary?: string | ArtifactDiagramSummary
}

export interface NormalizedArtifactPayload {
  projectName: string
  title: string
  headings: ArtifactHeading[]
  paragraphs: string[]
  bullets: string[]
  diagramSummary?: Required<Pick<ArtifactDiagramSummary, 'title' | 'summary'>> & {
    nodes: string[]
    edges: ArtifactDiagramEdge[]
  }
}

export interface GeneratedExport {
  data: Uint8Array
  contentType: string
  extension: `.${ExportFormat}`
  filename: string
}
