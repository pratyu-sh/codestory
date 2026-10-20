import type { FlowGraph, FlowNode, FlowEdge, FlowValidationIssue, FlowValidationResult } from './types'

function edgeKey(edge: FlowEdge): string {
  return `${edge.from}|${edge.to}|${edge.label}`
}

export function normalizeFlowGraph(graph: FlowGraph): FlowGraph {
  const nodes: FlowNode[] = []
  const nodeIds = new Set<string>()
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) continue
    nodeIds.add(node.id)
    nodes.push({
      ...node,
      evidenceIds: Array.from(new Set(node.evidenceIds)),
      evidenceQuotes: Array.from(new Set(node.evidenceQuotes)),
    })
  }
  const edges: FlowEdge[] = []
  const edgeKeys = new Set<string>()
  for (const edge of graph.edges) {
    const key = edgeKey(edge)
    if (edgeKeys.has(key) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
    edgeKeys.add(key)
    edges.push({
      ...edge,
      evidenceIds: Array.from(new Set(edge.evidenceIds)),
      evidenceQuotes: Array.from(new Set(edge.evidenceQuotes)),
    })
  }
  return { ...graph, nodes, edges }
}

export function validateFlowGraph(graph: FlowGraph): FlowValidationResult {
  const issues: FlowValidationIssue[] = []
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) issues.push({ code: 'duplicate-node-id', message: `Duplicate node ID: ${node.id}`, nodeId: node.id })
    ids.add(node.id)
  }
  const edgeKeys = new Set<string>()
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) issues.push({ code: 'invalid-edge-endpoint', message: `Edge ${edge.id} references a missing node`, edgeId: edge.id })
    const key = edgeKey(edge)
    if (edgeKeys.has(key)) issues.push({ code: 'duplicate-edge', message: `Duplicate edge: ${key}`, edgeId: edge.id })
    edgeKeys.add(key)
  }
  const normalized = normalizeFlowGraph(graph)
  return { valid: issues.length === 0, issues, graph: normalized }
}

export function assertValidFlowGraph(graph: FlowGraph): FlowGraph {
  const result = validateFlowGraph(graph)
  if (!result.valid) throw new Error(result.issues.map(issue => issue.message).join('; '))
  return result.graph
}

export const validateGraph = validateFlowGraph
