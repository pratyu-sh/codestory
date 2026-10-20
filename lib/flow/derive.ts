import type { Evidence, GraphNode, ProjectFile, ProjectModel } from '../analysis/types'
import type {
  DeriveFlowGraphOptions,
  FlowEdge,
  FlowGraph,
  FlowGraphSettings,
  FlowNode,
  FlowMode,
  ImplementationStatus,
  SemanticNodeType,
} from './types'
import { validateFlowGraph } from './validate'

const DEFAULT_SETTINGS: FlowGraphSettings = {
  maxNodes: 120,
  maxEdges: 220,
  maxEvidenceQuotes: 3,
  maxEvidenceQuoteCharacters: 240,
  includeLowConfidence: true,
}

const NODE_TYPE_ORDER: SemanticNodeType[] = [
  'start', 'page', 'api', 'input-output', 'auth', 'process', 'decision', 'database', 'subprocess', 'error', 'end',
]

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function basename(value: string): string {
  return normalizePath(value).split('/').pop() ?? value
}

function capQuote(value: string, max: number): string {
  const compact = value.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim()
  const redacted = compact.replace(
    /((?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|authorization|private[_-]?key)\s*[:=]\s*)(["']?)[^\s"',;}]+/gi,
    '$1$2[redacted]',
  )
  return redacted.length > max ? `${redacted.slice(0, Math.max(1, max - 1))}…` : redacted
}

function confidence(value: Evidence['confidence'] | undefined): number {
  return value === 'high' ? 0.95 : value === 'medium' ? 0.75 : value === 'low' ? 0.5 : 0.5
}

function statusForEvidence(evidence: Evidence[]): ImplementationStatus {
  if (evidence.some(item => item.kind === 'snippet' || item.kind === 'import' || item.kind === 'manifest')) return 'implemented'
  if (evidence.some(item => item.kind === 'inference')) return 'inferred'
  if (evidence.some(item => item.kind === 'path' || item.kind === 'tree')) return 'partial'
  return 'unknown'
}

function routePath(filePath: string): string | undefined {
  const path = normalizePath(filePath).replace(/\.(?:tsx?|jsx?|vue|svelte|php|rb|py|java|cs)$/i, '')
  let match = path.match(/^(?:src\/)?app\/(.*)\/page$/i)
  if (match) return `/${match[1].replace(/\/\[(?:\.\.\.)?[^/]+\]/g, '/:param').replace(/\[\[[^/]+\]\]/g, '/:param')}`.replace(/\/+/g, '/')
  if (/^(?:src\/)?app\/page$/i.test(path)) return '/'
  match = path.match(/^(?:src\/)?pages\/(.*)$/i)
  if (match) return `/${match[1].replace(/\/index$/i, '').replace(/\/+/g, '/') || ''}`.replace(/\/+/g, '/') || '/'
  match = path.match(/^(?:src\/)?(?:app\/)?api\/(.*)\/route$/i)
  if (match) return `/api/${match[1]}`
  match = path.match(/^(?:src\/)?pages\/api\/(.*)$/i)
  if (match) return `/api/${match[1].replace(/\/index$/i, '')}`
  if (/(^|\/)(?:routes?|controllers?)(\/|$)/i.test(path)) {
    const stem = basename(path).replace(/\.(?:tsx?|jsx?|vue|svelte|php|rb|py|java|cs)$/i, '')
    return stem === 'index' ? '/' : `/${stem}`
  }
  return undefined
}

function isApiPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase()
  return /(^|\/)(?:app\/api|pages\/api|api|routes?|controllers?)(\/|$)/.test(normalized)
}

function signalType(file: ProjectFile, evidence: Evidence[]): SemanticNodeType | undefined {
  const path = normalizePath(file.path).toLowerCase()
  const text = evidence.map(item => `${item.description} ${item.quote ?? ''}`).join(' ').toLowerCase()
  if (/(^|\/)(?:error|errors|not-found|exception|exceptions|error-boundary)(\/|\.|$)/.test(path) || /error boundary|not found|exception handler|error handler/.test(text)) return 'error'
  if (/(^|\/)(?:auth|authentication|authorization|login|logout|session|oauth|middleware|guards?)(\/|\.|$)/.test(path) || /\b(?:authenticate|authorization|authorize|login|logout|session|oauth|jwt|bearer|cookie)\b/.test(text)) return 'auth'
  if (isApiPath(path) || /\b(?:api route|endpoint|router\.|app\.(?:get|post|put|patch|delete)|fetch\s*\(|axios\.)/.test(text)) return 'api'
  if (file.role === 'data-model' || /\b(?:database|postgres|mysql|mongodb|redis|prisma|sql)\b/.test(text)) return 'database'
  if (routePath(path)) return 'page'
  if (file.role === 'service') return 'process'
  if (file.role === 'component') return 'page'
  if (file.role === 'source') return 'process'
  return undefined
}

function evidenceForPath(project: ProjectModel, path: string | undefined): Evidence[] {
  if (!path) return []
  const normalized = normalizePath(path)
  const fileEvidenceIds = project.files.find(file => normalizePath(file.path) === normalized)?.evidenceIds ?? []
  const ids = new Set(fileEvidenceIds)
  return project.evidence.filter(item => item.path && normalizePath(item.path) === normalized || ids.has(item.id))
}

function evidenceForNode(project: ProjectModel, file: ProjectFile, type: SemanticNodeType): Evidence[] {
  const pathEvidence = evidenceForPath(project, file.path)
  const technologyEvidence = project.technologies
    .filter(item => (type === 'database' && item.category === 'database') || (type === 'api' && item.category === 'service'))
    .flatMap(item => item.evidenceIds)
    .map(id => project.evidence.find(item => item.id === id))
    .filter((item): item is Evidence => Boolean(item && (!item.path || normalizePath(item.path) === normalizePath(file.path))))
  const seen = new Set<string>()
  return [...pathEvidence, ...technologyEvidence].filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)))
}

function nodeId(type: SemanticNodeType, path: string): string {
  return `flow:${type}:${normalizePath(path)}`
}

function nodeFromFile(project: ProjectModel, file: ProjectFile): FlowNode | undefined {
  const type = signalType(file, evidenceForPath(project, file.path))
  if (!type) return undefined
  const evidence = evidenceForNode(project, file, type)
  const source = evidence.find(item => item.path)?.path
  const line = evidence.find(item => item.line !== undefined)?.line
  const quotes = evidence.map(item => item.quote).filter((quote): quote is string => Boolean(quote))
  const route = routePath(file.path)
  const label = type === 'page' && route ? route : basename(file.path)
  return {
    id: nodeId(type, file.path),
    label,
    type,
    path: normalizePath(file.path),
    confidence: evidence.length ? Math.max(...evidence.map(item => confidence(item.confidence))) : 0.5,
    implementationStatus: statusForEvidence(evidence),
    evidenceIds: evidence.map(item => item.id),
    evidenceQuotes: quotes,
    sourcePath: source,
    sourceLine: line,
    source: source ? { path: source, line } : undefined,
    metadata: route ? { route } : undefined,
  }
}

function nodeFromGraphNode(project: ProjectModel, graphNode: GraphNode): FlowNode | undefined {
  const graphPath = graphNode.path
  if (!graphPath || project.files.some(file => normalizePath(file.path) === normalizePath(graphPath))) return undefined
  const type: SemanticNodeType | undefined = graphNode.type === 'entrypoint' ? (isApiPath(graphPath) ? 'api' : 'page')
    : graphNode.type === 'data-model' ? 'database'
      : graphNode.type === 'service' ? 'process'
        : graphNode.type === 'component' ? 'page'
          : graphNode.type === 'source' ? 'process' : undefined
  if (!type) return undefined
  const evidence = graphNode.evidenceIds.map(id => project.evidence.find(item => item.id === id)).filter((item): item is Evidence => Boolean(item))
  return {
    id: nodeId(type, graphPath),
    label: graphNode.label,
    type,
    path: normalizePath(graphPath),
    confidence: evidence.length ? Math.max(...evidence.map(item => confidence(item.confidence))) : 0.5,
    implementationStatus: statusForEvidence(evidence),
    evidenceIds: evidence.map(item => item.id),
    evidenceQuotes: evidence.map(item => item.quote).filter((quote): quote is string => Boolean(quote)),
    sourcePath: evidence.find(item => item.path)?.path,
    sourceLine: evidence.find(item => item.line !== undefined)?.line,
  }
}

function fileNodeMap(nodes: FlowNode[]): Map<string, FlowNode> {
  return new Map(nodes.filter(node => node.path).map(node => [normalizePath(node.path as string), node]))
}

function edgeId(from: string, to: string, label: string): string {
  return `flow-edge:${label}:${from}->${to}`
}

function addEvidenceEdge(
  project: ProjectModel,
  edges: FlowEdge[],
  seen: Set<string>,
  nodes: Map<string, FlowNode>,
  fromId: string,
  toId: string,
  label: string,
  evidenceIds: string[],
  maxEdges: number,
): void {
  if (!nodes.has(fromId) || !nodes.has(toId) || fromId === toId || evidenceIds.length === 0) return
  const key = `${fromId}|${toId}|${label}`
  if (seen.has(key) || edges.length >= maxEdges) return
  const evidence = evidenceIds.map(id => project.evidence.find(item => item.id === id)).filter((item): item is Evidence => Boolean(item))
  if (evidence.length === 0) return
  const source = evidence.find(item => item.path)
  edges.push({
    id: edgeId(fromId, toId, label),
    from: fromId,
    to: toId,
    label,
    confidence: Math.max(...evidence.map(item => confidence(item.confidence))),
    implementationStatus: statusForEvidence(evidence),
    evidenceIds: evidence.map(item => item.id),
    evidenceQuotes: evidence.map(item => item.quote).filter((quote): quote is string => Boolean(quote)),
    sourcePath: source?.path,
    sourceLine: evidence.find(item => item.line !== undefined)?.line,
    source: source?.path ? { path: source.path, line: evidence.find(item => item.line !== undefined)?.line } : undefined,
  })
  seen.add(key)
}

function resolveImport(sourcePath: string, value: string, files: ProjectFile[]): ProjectFile | undefined {
  if (!value.startsWith('.')) return undefined
  const sourceParts = normalizePath(sourcePath).split('/')
  sourceParts.pop()
  const parts = [...sourceParts, ...value.split('/')]
  const resolved: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') resolved.pop()
    else resolved.push(part)
  }
  const base = resolved.join('/')
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.json']
  return extensions.map(ext => `${base}${ext}`).map(path => files.find(file => normalizePath(file.path) === path)).find(Boolean)
    ?? extensions.slice(1).map(ext => `${base}/index${ext}`).map(path => files.find(file => normalizePath(file.path) === path)).find(Boolean)
}

function addEvidenceDerivedEdges(project: ProjectModel, nodes: FlowNode[], edges: FlowEdge[], settings: FlowGraphSettings): void {
  const byPath = fileNodeMap(nodes)
  const seen = new Set(edges.map(edge => `${edge.from}|${edge.to}|${edge.label}`))
  for (const evidence of project.evidence.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    if (!evidence.path || !evidence.quote) continue
    const source = byPath.get(normalizePath(evidence.path))
    if (!source) continue
    const imports = Array.from(evidence.quote.matchAll(/(?:from\s+|import\s*\(|require\s*\(|export\s+[^\n]*?from\s*)['"]([^'"]+)['"]/g))
    for (const match of imports) {
      const targetFile = resolveImport(evidence.path, match[1], project.files)
      const target = targetFile ? byPath.get(normalizePath(targetFile.path)) : undefined
      if (target) addEvidenceEdge(project, edges, seen, new Map(nodes.map(node => [node.id, node])), source.id, target.id, 'imports', [evidence.id], settings.maxEdges)
    }

    for (const token of Array.from(evidence.quote.matchAll(/(?:href\s*=\s*|navigate\s*\(|router\.(?:push|replace)\s*\(|fetch\s*\(|axios\.(?:get|post|put|patch|delete)\s*\(|['"])(\/(?:[A-Za-z0-9_:@%+~.-]+\/?)+)['"]/gi))) {
      const targetRoute = token[1].replace(/\/$/, '') || '/'
      const target = nodes.find(node => node.metadata?.route === targetRoute || (node.type === 'api' && node.metadata?.route === targetRoute))
      if (target) addEvidenceEdge(project, edges, seen, new Map(nodes.map(node => [node.id, node])), source.id, target.id, 'navigates to', [evidence.id], settings.maxEdges)
    }
  }
}

function addExistingEdges(project: ProjectModel, nodes: FlowNode[], edges: FlowEdge[], settings: FlowGraphSettings): void {
  const oldToNew = new Map<string, FlowNode>()
  for (const node of nodes) {
    if (node.path) oldToNew.set(`file:${normalizePath(node.path)}`, node)
    oldToNew.set(node.id, node)
  }
  const seen = new Set(edges.map(edge => `${edge.from}|${edge.to}|${edge.label}`))
  const oldEdges = [...project.flow.edges, ...project.systemDesign.edges]
  for (const edge of oldEdges) {
    const from = oldToNew.get(edge.from) ?? nodes.find(node => node.path && edge.from === `file:${normalizePath(node.path)}`)
    const to = oldToNew.get(edge.to) ?? nodes.find(node => node.path && edge.to === `file:${normalizePath(node.path)}`)
    if (!from || !to || edge.evidenceIds.length === 0) continue
    addEvidenceEdge(project, edges, seen, new Map(nodes.map(node => [node.id, node])), from.id, to.id, edge.type === 'inferred-flow' ? 'inferred flow' : edge.type, edge.evidenceIds, settings.maxEdges)
  }
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function boundGraph(graph: FlowGraph): FlowGraph {
  const settings = graph.settings
  const quote = (value: string) => capQuote(value, settings.maxEvidenceQuoteCharacters)
  const nodes = graph.nodes.slice(0, settings.maxNodes).map(node => ({
    ...node,
    evidenceIds: Array.from(new Set(node.evidenceIds)),
    evidenceQuotes: Array.from(new Set(node.evidenceQuotes.map(quote))).slice(0, settings.maxEvidenceQuotes),
  }))
  const nodeIds = new Set(nodes.map(node => node.id))
  const edges = graph.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)).slice(0, settings.maxEdges).map(edge => ({
    ...edge,
    evidenceIds: Array.from(new Set(edge.evidenceIds)),
    evidenceQuotes: Array.from(new Set(edge.evidenceQuotes.map(quote))).slice(0, settings.maxEvidenceQuotes),
  }))
  return { ...graph, nodes, edges }
}

export function deriveFlowGraph(project: ProjectModel, options: DeriveFlowGraphOptions = {}): FlowGraph {
  const settings: FlowGraphSettings = { ...DEFAULT_SETTINGS, ...project.analysis.limits, ...options }
  settings.maxNodes = Math.max(0, Math.floor(settings.maxNodes))
  settings.maxEdges = Math.max(0, Math.floor(settings.maxEdges))
  settings.maxEvidenceQuotes = Math.max(0, Math.floor(settings.maxEvidenceQuotes))
  settings.maxEvidenceQuoteCharacters = Math.max(20, Math.floor(settings.maxEvidenceQuoteCharacters))
  const byId = new Map<string, FlowNode>()
  for (const file of project.files.slice().sort((a, b) => normalizePath(a.path).localeCompare(normalizePath(b.path)))) {
    const node = nodeFromFile(project, file)
    if (node && !byId.has(node.id)) byId.set(node.id, node)
  }
  for (const graphNode of [...project.systemDesign.nodes, ...project.flow.nodes.map(step => ({ id: step.id, label: step.label, type: step.kind === 'entrypoint' ? 'entrypoint' : step.kind, path: step.path, evidenceIds: step.evidenceIds }))]) {
    const node = nodeFromGraphNode(project, graphNode as GraphNode)
    if (node && !byId.has(node.id)) byId.set(node.id, node)
  }
  const candidateNodes = Array.from(byId.values())
    .filter(node => settings.includeLowConfidence || node.confidence >= 0.75)
    .sort((a, b) => NODE_TYPE_ORDER.indexOf(a.type) - NODE_TYPE_ORDER.indexOf(b.type) || (a.path ?? '').localeCompare(b.path ?? ''))
  const nodes = candidateNodes.slice(0, settings.maxNodes)
  const edges: FlowEdge[] = []
  addExistingEdges(project, nodes, edges, settings)
  addEvidenceDerivedEdges(project, nodes, edges, settings)
  const source = `${project.files.map(file => `${file.path}:${file.role}:${file.evidenceIds.join(',')}`).sort().join('|')}|${project.technologies.map(item => `${item.name}:${item.category}:${item.evidenceIds.join(',')}`).sort().join('|')}|${project.evidence.map(item => `${item.id}:${item.path ?? ''}:${item.line ?? ''}:${item.quote ?? ''}`).sort().join('|')}|${project.flow.edges.map(edge => `${edge.from}:${edge.to}:${edge.type}:${edge.evidenceIds.join(',')}`).sort().join('|')}|${project.systemDesign.edges.map(edge => `${edge.from}:${edge.to}:${edge.type}:${edge.evidenceIds.join(',')}`).sort().join('|')}`
  const graph: FlowGraph = {
    mode: options.mode ?? 'technical-flow',
    nodes,
    edges,
    settings,
    revision: { schemaVersion: '1.0', revision: 1, fingerprint: stableHash(source), sourceAnalysisAt: project.analysis.analyzedAt },
    notes: ['Derived from ProjectModel files, evidence, technologies, and existing static-analysis relationships; no code was executed.'],
  }
  return boundGraph(validateFlowGraph(graph).graph)
}

export function projectFlowGraph(graph: FlowGraph, mode: FlowMode): FlowGraph {
  const allowed: Record<FlowMode, Set<SemanticNodeType>> = {
    'technical-flow': new Set<SemanticNodeType>(NODE_TYPE_ORDER),
    'user-flow': new Set<SemanticNodeType>(['start', 'end', 'page', 'api', 'input-output', 'auth', 'decision', 'error']),
    'page-map': new Set<SemanticNodeType>(['start', 'end', 'page', 'api', 'auth', 'error']),
  }
  const nodes = graph.nodes.filter(node => allowed[mode].has(node.type))
  const ids = new Set(nodes.map(node => node.id))
  return { ...graph, mode, nodes, edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) }
}

/** Apply deterministic confidence and size filters to an already-derived graph. */
export function filterFlowGraph(graph: FlowGraph, options: Partial<FlowGraphSettings> = {}): FlowGraph {
  const settings: FlowGraphSettings = { ...graph.settings, ...options }
  const nodes = graph.nodes
    .filter(node => settings.includeLowConfidence || node.confidence >= 0.75)
    .slice(0, Math.max(0, Math.floor(settings.maxNodes)))
  const nodeIds = new Set(nodes.map(node => node.id))
  return {
    ...graph,
    settings,
    nodes,
    edges: graph.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)).slice(0, Math.max(0, Math.floor(settings.maxEdges))),
  }
}

export function getPlaybackPath(graph: FlowGraph, startNodeId?: string, endNodeId?: string): string[] {
  const nodes = graph.nodes.slice().sort((a, b) => a.id.localeCompare(b.id))
  const byId = new Map(nodes.map(node => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const list = outgoing.get(edge.from) ?? []
    if (!list.includes(edge.to)) list.push(edge.to)
    outgoing.set(edge.from, list)
  }
  const indegree = new Map(nodes.map(node => [node.id, 0]))
  for (const edge of graph.edges) if (indegree.has(edge.to)) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  const start = startNodeId && byId.has(startNodeId) ? startNodeId : nodes.find(node => node.type === 'start')?.id ?? nodes.find(node => (indegree.get(node.id) ?? 0) === 0)?.id
  if (!start) return []
  const target = endNodeId && byId.has(endNodeId) ? endNodeId : nodes.find(node => node.type === 'end')?.id
  const queue: Array<{ id: string; path: string[] }> = [{ id: start, path: [start] }]
  const visited = new Set<string>()
  while (queue.length) {
    const current = queue.shift() as { id: string; path: string[] }
    if (current.id === target || (!target && (outgoing.get(current.id) ?? []).length === 0)) return current.path
    if (visited.has(current.id)) continue
    visited.add(current.id)
    for (const next of (outgoing.get(current.id) ?? []).sort()) {
      if (!current.path.includes(next)) queue.push({ id: next, path: [...current.path, next] })
    }
  }
  return [start]
}

export function playbackPath(graph: FlowGraph, startNodeId?: string, endNodeId?: string): FlowNode[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  return getPlaybackPath(graph, startNodeId, endNodeId).map(id => nodes.get(id)).filter((node): node is FlowNode => Boolean(node))
}
