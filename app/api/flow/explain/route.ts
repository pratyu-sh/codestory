import { NextResponse } from 'next/server'
import { explainFlowNode, FlowAiConfigurationError, FlowAiUpstreamError } from '../../../../lib/flow/ai'
import { assertValidFlowGraph } from '../../../../lib/flow'
import type { FlowGraph } from '../../../../lib/flow/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'Request body must be valid JSON.' } }, { status: 400 }) }
  if (!isRecord(body) || typeof body.nodeId !== 'string' || !isRecord(body.graph)) return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'Provide a flow graph and selected node ID.' } }, { status: 400 })
  try {
    const graph = assertValidFlowGraph(body.graph as unknown as FlowGraph)
    if (JSON.stringify(graph).length > 180_000) return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'The flow graph is too large to explain.' } }, { status: 400 })
    const result = await explainFlowNode(graph, body.nodeId)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof FlowAiConfigurationError) return NextResponse.json({ error: { code: 'MISSING_API_KEY', message: 'Flow explanations are not configured on the server.' } }, { status: 503 })
    if (error instanceof FlowAiUpstreamError) return NextResponse.json({ error: { code: 'UPSTREAM_FAILURE', message: error.message } }, { status: 502 })
    return NextResponse.json({ error: { code: 'INVALID_GRAPH', message: 'The flow graph could not be validated.' } }, { status: 400 })
  }
}
