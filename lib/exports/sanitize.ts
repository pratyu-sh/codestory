import type {
  ArtifactDiagramEdge,
  ArtifactDiagramSummary,
  ArtifactHeading,
  NormalizedArtifactPayload,
} from './types'

export const EXPORT_INPUT_LIMIT_BYTES = 300_000

const MAX_PROJECT_NAME_LENGTH = 120
const MAX_TITLE_LENGTH = 240
const MAX_HEADING_COUNT = 40
const MAX_HEADING_LENGTH = 160
const MAX_PARAGRAPH_COUNT = 40
const MAX_PARAGRAPH_LENGTH = 4_000
const MAX_BULLET_COUNT = 80
const MAX_BULLET_LENGTH = 500
const MAX_DIAGRAM_TEXT_LENGTH = 4_000
const MAX_DIAGRAM_NODE_COUNT = 40
const MAX_DIAGRAM_NODE_LENGTH = 160
const MAX_DIAGRAM_EDGE_COUNT = 60
const MAX_TOTAL_TEXT_LENGTH = 50_000

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /((?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|authorization|private[_-]?key|secret)\s*[:=]\s*(?:bearer\s+)?)(["']?)[^\s"',;}]+/gi,
    replacement: '$1$2[redacted]',
  },
  {
    pattern: /\b(?:sk|pk|ghp|gho|github_pat|xox[baprs]-|AIza)[A-Za-z0-9_\-]{12,}\b/gi,
    replacement: '[redacted]',
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
    replacement: '[redacted]',
  },
]

function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((result, secret) => {
    secret.pattern.lastIndex = 0
    return result.replace(secret.pattern, secret.replacement)
  }, value)
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const withoutControls = value
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
  const redacted = redactSecrets(withoutControls)
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1).trimEnd()}…` : redacted
}

function arrayOfUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normaliseHeading(value: unknown): ArtifactHeading | null {
  if (typeof value === 'string') {
    const text = cleanText(value, MAX_HEADING_LENGTH)
    return text ? { text, level: 2 } : null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const text = cleanText(record.text ?? record.title, MAX_HEADING_LENGTH)
  if (!text) return null
  const level = record.level === 1 || record.level === 3 ? record.level : 2
  return { text, level }
}

function normaliseDiagram(value: unknown): NormalizedArtifactPayload['diagramSummary'] {
  if (typeof value === 'string') {
    const summary = cleanText(value, MAX_DIAGRAM_TEXT_LENGTH)
    return summary ? { title: 'Diagram summary', summary, nodes: [], edges: [] } : undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const title = cleanText(record.title, 160) || 'Diagram summary'
  const summary = cleanText(record.summary, MAX_DIAGRAM_TEXT_LENGTH)
  const nodes = arrayOfUnknown(record.nodes)
    .map(node => cleanText(node, MAX_DIAGRAM_NODE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_DIAGRAM_NODE_COUNT)
  const edges: ArtifactDiagramEdge[] = arrayOfUnknown(record.edges)
    .map(edge => {
      if (!edge || typeof edge !== 'object') return null
      const item = edge as Record<string, unknown>
      const from = cleanText(item.from, MAX_DIAGRAM_NODE_LENGTH)
      const to = cleanText(item.to, MAX_DIAGRAM_NODE_LENGTH)
      if (!from || !to) return null
      const label = cleanText(item.label, MAX_DIAGRAM_NODE_LENGTH)
      return label ? { from, to, label } : { from, to }
    })
    .filter((edge): edge is ArtifactDiagramEdge => edge !== null)
    .slice(0, MAX_DIAGRAM_EDGE_COUNT)
  if (!summary && nodes.length === 0 && edges.length === 0) return undefined
  return { title, summary, nodes, edges }
}

function truncateTotalText(payload: NormalizedArtifactPayload): NormalizedArtifactPayload {
  let remaining = MAX_TOTAL_TEXT_LENGTH
  const take = (value: string): string => {
    if (remaining <= 0) return ''
    const result = value.slice(0, remaining)
    remaining -= result.length
    return result
  }

  payload.projectName = take(payload.projectName)
  payload.title = take(payload.title)
  payload.headings = payload.headings.map(item => ({ ...item, text: take(item.text) })).filter(item => item.text)
  payload.paragraphs = payload.paragraphs.map(take).filter(Boolean)
  payload.bullets = payload.bullets.map(take).filter(Boolean)
  if (payload.diagramSummary) {
    payload.diagramSummary.summary = take(payload.diagramSummary.summary)
    payload.diagramSummary.title = take(payload.diagramSummary.title)
    payload.diagramSummary.nodes = payload.diagramSummary.nodes.map(take).filter(Boolean)
    payload.diagramSummary.edges = payload.diagramSummary.edges
      .map(edge => ({ ...edge, from: take(edge.from), to: take(edge.to), ...(edge.label ? { label: take(edge.label) } : {}) }))
      .filter(edge => edge.from && edge.to)
  }
  return payload
}

export function sanitizeArtifactPayload(input: unknown): NormalizedArtifactPayload {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const headings = arrayOfUnknown(record.headings)
    .map(normaliseHeading)
    .filter((heading): heading is ArtifactHeading => heading !== null)
    .slice(0, MAX_HEADING_COUNT)
  const paragraphs = arrayOfUnknown(record.paragraphs)
    .map(value => cleanText(value, MAX_PARAGRAPH_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_PARAGRAPH_COUNT)
  const bullets = arrayOfUnknown(record.bullets)
    .map(value => cleanText(value, MAX_BULLET_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_BULLET_COUNT)

  return truncateTotalText({
    projectName: cleanText(record.projectName ?? record.project ?? 'CodeAtlas project', MAX_PROJECT_NAME_LENGTH) || 'CodeAtlas project',
    title: cleanText(record.title ?? 'CodeAtlas artifact', MAX_TITLE_LENGTH) || 'CodeAtlas artifact',
    headings,
    paragraphs,
    bullets,
    diagramSummary: normaliseDiagram(record.diagramSummary ?? record.diagram),
  })
}

/** British spelling kept as a small compatibility alias for server callers. */
export const sanitiseArtifactPayload = sanitizeArtifactPayload

export function sanitizeFilename(value: string, extension: `.${'pdf' | 'docx' | 'pptx'}`): string {
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/[. ]+$/, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 96)
    .replace(/^[. -]+|[. -]+$/g, '')
  const safeBase = base && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(base) ? base : 'codeatlas-export'
  return `${safeBase}${extension}`
}
