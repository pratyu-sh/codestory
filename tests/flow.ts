import assert from 'node:assert/strict'
import {
  deriveFlowGraph,
  explainFlowNode,
  getPlaybackPath,
  projectFlowGraph,
  validateFlowGraph,
  type FlowGraph,
} from '../lib/flow'
import type { ProjectModel } from '../lib/analysis/types'

function fixture(): ProjectModel {
  return {
    project: {
      name: 'Flow fixture', owner: 'example', fullName: 'example/flow-fixture',
      url: 'https://github.com/example/flow-fixture', apiUrl: 'https://api.github.com/repos/example/flow-fixture',
      defaultBranch: 'main', description: null, primaryLanguage: 'TypeScript', stars: 0, forks: 0,
      openIssues: 0, license: null, isFork: false,
    },
    files: [
      { path: 'app/page.tsx', size: 100, sha: '', url: '', language: 'TypeScript', role: 'component', evidenceIds: ['ev-page'] },
      { path: 'app/api/orders/route.ts', size: 100, sha: '', url: '', language: 'TypeScript', role: 'route', evidenceIds: ['ev-api'] },
      { path: 'lib/orders.ts', size: 100, sha: '', url: '', language: 'TypeScript', role: 'service', evidenceIds: ['ev-service'] },
      { path: 'db/schema.prisma', size: 100, sha: '', url: '', language: 'Prisma', role: 'data-model', evidenceIds: ['ev-db'] },
      { path: 'middleware/auth.ts', size: 100, sha: '', url: '', language: 'TypeScript', role: 'source', evidenceIds: ['ev-auth'] },
      { path: 'utils/misc.ts', size: 100, sha: '', url: '', language: 'TypeScript', role: 'source', evidenceIds: ['ev-low'] },
    ],
    technologies: [{ name: 'Prisma', category: 'orm', confidence: 0.95, evidenceIds: ['ev-db'] }],
    evidence: [
      { id: 'ev-page', kind: 'snippet', path: 'app/page.tsx', line: 4, quote: "<a href=\"/api/orders\">Orders</a>", description: 'Page links to orders', confidence: 'high' },
      { id: 'ev-api', kind: 'snippet', path: 'app/api/orders/route.ts', line: 1, quote: "import { listOrders } from '../../../lib/orders'", description: 'API imports service', confidence: 'high' },
      { id: 'ev-service', kind: 'snippet', path: 'lib/orders.ts', line: 2, quote: 'return prisma.order.findMany()', description: 'Service reads database', confidence: 'high' },
      { id: 'ev-db', kind: 'path', path: 'db/schema.prisma', description: 'Database schema', confidence: 'high' },
      { id: 'ev-auth', kind: 'snippet', path: 'middleware/auth.ts', line: 1, quote: 'authorize(request)', description: 'Authorization middleware', confidence: 'medium' },
      { id: 'ev-low', kind: 'path', path: 'utils/misc.ts', description: 'Low-confidence source path', confidence: 'low' },
      { id: 'ev-unrelated', kind: 'snippet', path: 'README.md', quote: 'https://example.invalid/not-a-route', description: 'Unrelated quote', confidence: 'low' },
    ],
    flow: { steps: [], nodes: [], edges: [], notes: [] },
    systemDesign: { nodes: [], edges: [], layers: [], notes: [] },
    interviewSeeds: [],
    analysis: {
      status: 'complete', analyzedAt: '2026-01-01T00:00:00.000Z', source: 'github-rest-api', codeExecution: false,
      warnings: [], skippedFileCount: 0, truncated: false,
      limits: { maxFiles: 20, maxContentFiles: 20, maxSnippetCharacters: 500, maxEvidence: 20, maxGraphNodes: 20, maxGraphEdges: 20 },
    },
  }
}

function node(graph: FlowGraph, type: string, path: string) {
  return graph.nodes.find(item => item.type === type && item.path === path)
}

async function main() {
  const graph = deriveFlowGraph(fixture(), { maxEvidenceQuotes: 1, maxEvidenceQuoteCharacters: 80 })
  assert.equal(validateFlowGraph(graph).valid, true)
  assert.ok(node(graph, 'page', 'app/page.tsx'))
  assert.ok(node(graph, 'api', 'app/api/orders/route.ts'))
  assert.ok(node(graph, 'database', 'db/schema.prisma'))
  assert.ok(graph.nodes.every(item => item.evidenceQuotes.length <= 1 && item.evidenceQuotes.every(quote => quote.length <= 80)))
  const filtered = deriveFlowGraph(fixture(), { includeLowConfidence: false })
  assert.equal(node(filtered, 'process', 'utils/misc.ts'), undefined)

  const pageMap = projectFlowGraph(graph, 'page-map')
  assert.ok(pageMap.nodes.every(item => ['page', 'api', 'auth', 'error', 'start', 'end'].includes(item.type)))
  assert.ok(pageMap.edges.every(edge => pageMap.nodes.some(item => item.id === edge.from) && pageMap.nodes.some(item => item.id === edge.to)))

  const duplicate = { ...graph, nodes: [graph.nodes[0], graph.nodes[0]], edges: [] }
  assert.equal(validateFlowGraph(duplicate).valid, false)
  assert.equal(validateFlowGraph(duplicate).graph.nodes.length, 1)

  const start = { id: 'start', label: 'Start', type: 'start' as const, confidence: 1, implementationStatus: 'implemented' as const, evidenceIds: [], evidenceQuotes: [] }
  const middle = { id: 'middle', label: 'Middle', type: 'process' as const, confidence: 1, implementationStatus: 'implemented' as const, evidenceIds: [], evidenceQuotes: [] }
  const end = { id: 'end', label: 'End', type: 'end' as const, confidence: 1, implementationStatus: 'implemented' as const, evidenceIds: [], evidenceQuotes: [] }
  const playback: FlowGraph = { ...graph, nodes: [start, middle, end], edges: [
    { id: 'a', from: 'start', to: 'middle', label: 'next', confidence: 1, implementationStatus: 'implemented', evidenceIds: [], evidenceQuotes: [] },
    { id: 'b', from: 'middle', to: 'end', label: 'next', confidence: 1, implementationStatus: 'implemented', evidenceIds: [], evidenceQuotes: [] },
  ] }
  assert.deepEqual(getPlaybackPath(playback), ['start', 'middle', 'end'])
  assert.deepEqual(getPlaybackPath(playback, 'middle', 'end'), ['middle', 'end'])
  const explanation = await explainFlowNode(playback, 'middle', {
    apiKey: 'test-only-key', model: 'test-model', fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ explanation: 'This is a static process node.', caveats: ['No runtime telemetry is attached.'] }) }] } }],
    }), { status: 200 }),
  })
  assert.equal(explanation.nodeId, 'middle')
  assert.match(explanation.explanation, /static process/)
  console.log('Flow checks passed: validation, projections, evidence bounds, filtering, playback paths, and Gemini explanation.')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
