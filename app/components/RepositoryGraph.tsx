'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FlowStep, GraphEdge, GraphNode, ProjectModel } from '../../lib/analysis/types'
import { deriveFlowGraph, getPlaybackPath, projectFlowGraph, type FlowMode, type FlowNode } from '../../lib/flow'

type Point = { x: number; y: number }
type GraphMode = 'flow' | 'system'
type RepositoryGraphProps = { project: ProjectModel | null; mode?: GraphMode }
type DiagramNode = {
  id: string
  label: string
  path?: string
  evidenceIds: string[]
  type: string
  order?: number
  metadata?: Record<string, string | number | boolean>
  confidence?: number
  implementationStatus?: string
  sourceLine?: number
}
type DiagramEdge = GraphEdge & { label?: string; confidence?: number; implementationStatus?: string }

const W = 228
const H = 112
const PLAYBACK_SPEEDS = [0.5, 1, 2]

function diagramNode(node: GraphNode | FlowStep | FlowNode): DiagramNode {
  return {
    id: node.id,
    label: node.label,
    path: node.path,
    evidenceIds: node.evidenceIds,
    type: 'kind' in node ? node.kind : node.type,
    order: 'order' in node ? node.order : undefined,
    metadata: 'metadata' in node ? node.metadata : undefined,
    confidence: 'confidence' in node ? node.confidence : undefined,
    implementationStatus: 'implementationStatus' in node ? node.implementationStatus : undefined,
    sourceLine: 'sourceLine' in node ? node.sourceLine : undefined,
  }
}

function nodeTypeClass(type: string) {
  return `node-type-${type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

export function RepositoryGraph({ project, mode = 'system' }: RepositoryGraphProps) {
  const [flowMode, setFlowMode] = useState<FlowMode>('user-flow')
  const derivedFlow = useMemo(() => {
    if (!project || mode !== 'flow') return null
    return projectFlowGraph(deriveFlowGraph(project, { mode: flowMode }), flowMode)
  }, [flowMode, mode, project])
  const nodes = useMemo<DiagramNode[]>(() => {
    if (!project) return []
    if (mode === 'flow' && derivedFlow) return derivedFlow.nodes.map(diagramNode)
    if (mode === 'system') return (project.systemDesign.nodes ?? []).map(diagramNode)
    const steps = project.flow.steps ?? project.flow.nodes ?? []
    const start: DiagramNode = { id: 'flow:start', label: 'Start request', type: 'start', evidenceIds: [] }
    const end: DiagramNode = { id: 'flow:end', label: 'End / response', type: 'end', evidenceIds: [] }
    return [start, ...steps.map(diagramNode), end]
  }, [derivedFlow, project, mode])

  const edges = useMemo<DiagramEdge[]>(() => {
    const ids = new Set(nodes.map(node => node.id))
    if (mode === 'flow') {
      if (derivedFlow) return derivedFlow.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        type: edge.label === 'imports' ? 'imports' : edge.implementationStatus === 'inferred' ? 'inferred-flow' : 'calls',
        verified: edge.implementationStatus === 'implemented',
        evidenceIds: edge.evidenceIds,
        label: edge.label,
        confidence: edge.confidence,
        implementationStatus: edge.implementationStatus,
      }))
      const existing = project?.flow.edges ?? []
      return nodes.slice(0, -1).map((node, index): GraphEdge => {
        const next = nodes[index + 1]
        const matched = existing.find(edge => edge.from === node.id && edge.to === next.id)
        return matched ?? {
          id: `flow-route-${index}`,
          from: node.id,
          to: next.id,
          type: 'inferred-flow',
          verified: false,
          evidenceIds: [],
        }
      })
    }
    return (project?.systemDesign.edges ?? []).filter(edge => ids.has(edge.from) && ids.has(edge.to))
  }, [derivedFlow, project, mode, nodes])

  const initial = useMemo(() => {
    if (mode === 'flow') {
      return Object.fromEntries(nodes.map((node, index) => [node.id, { x: 32 + index * 270, y: 154 }]))
    }
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
    return Object.fromEntries(nodes.map((node, index) => [node.id, { x: 32 + index % columns * 260, y: 32 + Math.floor(index / columns) * 170 }]))
  }, [mode, nodes])

  const [positions, setPositions] = useState<Record<string, Point>>(initial)
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [trace, setTrace] = useState<GraphEdge[]>([])
  const [step, setStep] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [animateDashedEdges, setAnimateDashedEdges] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [aiExplanation, setAiExplanation] = useState<{ nodeId: string; explanation: string; caveats: string[] } | null>(null)
  const [explaining, setExplaining] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; x: number; y: number; start: Point } | null>(null)
  const layoutHydrated = useRef(false)
  const marker = useId().replace(/:/g, '')
  const layoutKey = project ? `codestory:flow-layout:v1:${project.project.fullName}:${project.analysis.analyzedAt}:${mode}:${mode === 'flow' ? flowMode : 'system'}` : ''
  const point = (id: string) => positions[id] ?? initial[id] ?? { x: 32, y: 32 }
  const bounds = nodes.reduce((size, node) => ({ width: Math.max(size.width, point(node.id).x + W + 32), height: Math.max(size.height, point(node.id).y + H + 32) }), { width: 256, height: 180 })
  const normalizedSearch = search.trim().toLowerCase()
  const typeOptions = useMemo(() => Array.from(new Set(nodes.map(node => node.type))).sort(), [nodes])
  const visibleNodes = useMemo(() => nodes.filter(node => {
    const matchesSearch = !normalizedSearch || [node.label, node.path, node.type].some(value => value?.toLowerCase().includes(normalizedSearch))
    return matchesSearch && (typeFilter === 'all' || node.type === typeFilter)
  }), [nodes, normalizedSearch, typeFilter])
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes])
  const visibleEdges = useMemo(() => edges.filter(edge => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)), [edges, visibleNodeIds])

  useEffect(() => {
    layoutHydrated.current = false
    let restored: Record<string, Point> | null = null
    if (layoutKey) {
      try {
        const raw = window.localStorage.getItem(layoutKey)
        const value = raw ? JSON.parse(raw) as unknown : null
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const candidate = value as Record<string, unknown>
          restored = Object.fromEntries(Object.entries(candidate).filter(([, point]) => point && typeof point === 'object' && typeof (point as Record<string, unknown>).x === 'number' && typeof (point as Record<string, unknown>).y === 'number').map(([id, point]) => [id, { x: (point as { x: number }).x, y: (point as { y: number }).y }]))
        }
      } catch { restored = null }
    }
    setPositions(restored && Object.keys(restored).length ? { ...initial, ...restored } : initial)
    setSelected(null); setSelectedEdge(null); setPlaying(false); setTrace([]); setStep(-1); setZoom(1)
    const hydrationTimer = window.setTimeout(() => { layoutHydrated.current = true }, 0)
    return () => window.clearTimeout(hydrationTimer)
  }, [initial, layoutKey])
  useEffect(() => {
    if (!layoutHydrated.current || !layoutKey || !Object.keys(positions).length) return
    try { window.localStorage.setItem(layoutKey, JSON.stringify(positions)) } catch { /* layout persistence is best effort */ }
  }, [layoutKey, positions])
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      if (mode === 'flow') {
        const next = step + 1
        if (next >= trace.length) { setPlaying(false); return }
        setStep(next)
        setSelected(trace[next]?.to ?? null)
        setSelectedEdge(trace[next]?.id ?? null)
        if (next >= trace.length - 1) setPlaying(false)
        return
      }
      if (step + 1 >= trace.length) { setPlaying(false); return }
      const next = step + 1
      setStep(next); setSelectedEdge(trace[next].id); setSelected(trace[next].to)
    }, 1000 / playbackSpeed)
    return () => window.clearTimeout(timer)
  }, [mode, nodes, playbackSpeed, playing, step, trace])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new MutationObserver(() => { if (element.closest('[hidden]')) setPlaying(false) })
    for (let parent = element.parentElement; parent; parent = parent.parentElement) observer.observe(parent, { attributes: true, attributeFilter: ['hidden'] })
    return () => observer.disconnect()
  }, [])

  function fit() {
    if (!viewport.current) return
    setZoom(Math.min(1.5, (viewport.current.clientWidth - 8) / bounds.width, (viewport.current.clientHeight - 8) / bounds.height))
    viewport.current.scrollTo({ left: 0, top: 0, behavior: 'instant' })
  }

  function startTrace() {
    if (mode === 'flow') {
      if (!edges.length) return
      const path = derivedFlow ? getPlaybackPath(derivedFlow, selected ?? undefined) : []
      const pathEdges = path.slice(0, -1).map((from, index) => edges.find(edge => edge.from === from && edge.to === path[index + 1])).filter((edge): edge is DiagramEdge => Boolean(edge))
      const playbackEdges = pathEdges.length ? pathEdges : edges
      setTrace(playbackEdges); setStep(-1); setSelected(playbackEdges[0]?.from ?? nodes[0]?.id ?? null); setSelectedEdge(playbackEdges[0]?.id ?? null)
      setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return
    }
    const first = edges.find(edge => edge.from === selected) ?? edges[0]
    if (!first) return
    const path: GraphEdge[] = [], visited = new Set<string>([first.from])
    let edge: GraphEdge | undefined = first
    while (edge && !visited.has(edge.to)) {
      path.push(edge); visited.add(edge.to)
      const destination: string = edge.to
      edge = edges.find(candidate => candidate.from === destination && !visited.has(candidate.to))
    }
    if (!path.length) path.push(first)
    setTrace(path); setStep(0); setSelectedEdge(path[0].id); setSelected(path[0].to)
    setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }

  function restartTrace() {
    if (!trace.length) { startTrace(); return }
    setStep(0)
    if (mode === 'flow') { setSelected(trace[0]?.from ?? nodes[0]?.id ?? null); setSelectedEdge(trace[0]?.id ?? null) }
    else { setSelectedEdge(trace[0]?.id ?? null); setSelected(trace[0]?.to ?? null) }
    setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }

  function togglePlayback() {
    if (playing) { setPlaying(false); return }
    const complete = mode === 'flow' ? (trace.length > 0 && step >= trace.length - 1) : step >= trace.length - 1
    if (!trace.length || complete) { restartTrace(); return }
    setPlaying(true)
  }

  function selectRouteStep(index: number) {
    if (mode !== 'flow' || !nodes.length) return
    const next = Math.max(0, Math.min(index, nodes.length - 1)), position = point(nodes[next].id)
    setStep(next); setSelected(nodes[next].id); setSelectedEdge(next > 0 ? edges[next - 1]?.id ?? null : edges[0]?.id ?? null); setPlaying(false)
    viewport.current?.scrollTo({ left: Math.max(0, position.x * zoom - viewport.current.clientWidth / 2 + W / 2), top: Math.max(0, position.y * zoom - viewport.current.clientHeight / 2 + H / 2), behavior: 'smooth' })
  }

  function source(path: string, line?: number) {
    if (!project) return '#'
    const info = project.project
    return `https://github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.name)}/blob/${encodeURIComponent(info.defaultBranch)}/${path.split('/').map(encodeURIComponent).join('/')}${line && line > 0 ? `#L${line}` : ''}`
  }

  async function explainSelectedNode() {
    if (!derivedFlow || !selected || explaining) return
    setExplaining(true)
    setAiExplanation(null)
    try {
      const response = await fetch('/api/flow/explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: derivedFlow, nodeId: selected }),
      })
      const payload = await response.json() as { nodeId?: string; explanation?: string; caveats?: string[]; error?: { message?: string } }
      if (!response.ok || typeof payload.explanation !== 'string') throw new Error(payload.error?.message || 'Gemini could not explain this node.')
      setAiExplanation({ nodeId: payload.nodeId || selected, explanation: payload.explanation, caveats: Array.isArray(payload.caveats) ? payload.caveats : [] })
    } catch (error) {
      setAiExplanation({ nodeId: selected, explanation: error instanceof Error ? error.message : 'Gemini explanation failed.', caveats: ['This explanation is unavailable; the static evidence inspector remains authoritative.'] })
    } finally {
      setExplaining(false)
    }
  }

  function evidence(ids: string[]) {
    const records = project?.evidence.filter(item => ids.includes(item.id)) ?? []
    return records.length ? <ul>{records.map(item => <li key={item.id}><b>{item.kind} · {item.confidence} confidence</b><p>{item.description}</p>{item.path && <a href={source(item.path, item.line)} target="_blank" rel="noreferrer">{item.path}{item.line ? `:${item.line}` : ''}</a>}{item.quote && <pre>{item.quote}</pre>}</li>)}</ul> : <p>No source evidence attached.</p>
  }

  const node = nodes.find(item => item.id === selected)
  const edge = edges.find(item => item.id === selectedEdge)
  const incoming = node ? edges.filter(item => item.to === node.id) : []
  const outgoing = node ? edges.filter(item => item.from === node.id) : []
  const verified = (item: GraphEdge) => item.verified && item.type === 'imports'
  const flowComplete = mode === 'flow' && trace.length > 0 && step >= trace.length - 1
  const chooseEdge = (item: GraphEdge) => { setSelectedEdge(item.id); setSelected(null); setPlaying(false) }
  const edgeLabel = (item: GraphEdge) => `${nodes.find(n => n.id === item.from)?.label ?? item.from} → ${nodes.find(n => n.id === item.to)?.label ?? item.to}`

  return <section className={`artifact-panel repository-graph ${mode === 'flow' ? 'flow-graph-panel' : 'system-graph-panel'}`}>
    <div className="panel-head"><div><p className="graph-kicker">{mode === 'flow' ? 'STANDARD REQUEST FLOW' : 'ARCHITECTURE MAP'}</p><h3>{mode === 'flow' ? 'Start-to-end request path' : 'System design'}</h3><p>{mode === 'flow' ? 'Read the inferred request route from entry to response. It reflects repository evidence, not a live run.' : 'Static repository evidence · imports do not prove runtime execution.'}</p></div></div>
    <div className="graph-toolbar" aria-label="Diagram controls">
      {mode === 'flow' && <label className="graph-control">View <select value={flowMode} onChange={event => { setFlowMode(event.target.value as FlowMode); setTrace([]); setStep(-1); setSelected(null); setSelectedEdge(null); setPlaying(false) }}><option value="user-flow">User flow</option><option value="technical-flow">Technical flow</option><option value="page-map">Page map</option></select></label>}
      <button className="ghost-button" disabled={!nodes.length} onClick={() => setZoom(value => Math.max(.05, value / 1.2))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span>
      <button className="ghost-button" disabled={!nodes.length} onClick={() => setZoom(value => Math.min(2, value * 1.2))} aria-label="Zoom in">+</button>
      <button className="ghost-button" disabled={!nodes.length} onClick={fit}>Fit diagram</button>
       <button className="ghost-button" disabled={!nodes.length} onClick={() => { if (layoutKey) window.localStorage.removeItem(layoutKey); setPositions(initial); setZoom(1); setPlaying(false) }}>Reset layout</button>
      <button className="primary-button" disabled={!edges.length} onClick={togglePlayback}>{playing ? 'Pause playback' : flowComplete ? 'Replay route' : trace.length ? 'Play playback' : mode === 'flow' ? 'Trace route' : 'Trace connected path'}</button>
      {trace.length > 0 && <button className="ghost-button" onClick={restartTrace}>Restart</button>}
      {!playing && trace.length > 0 && step < trace.length - 1 && <button className="ghost-button" onClick={() => mode === 'flow' ? (() => { const next = step + 1; setStep(next); setSelectedEdge(trace[next].id); setSelected(trace[next].to) })() : (() => { const next = step + 1; setStep(next); setSelectedEdge(trace[next].id); setSelected(trace[next].to) })()}>Next {mode === 'flow' ? 'step' : 'edge'}</button>}
      <label className="graph-control">Speed <select value={playbackSpeed} onChange={event => setPlaybackSpeed(Number(event.target.value))}>{PLAYBACK_SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
      <button className={`ghost-button ${animateDashedEdges ? 'is-active' : ''}`} aria-pressed={animateDashedEdges} onClick={() => setAnimateDashedEdges(value => !value)}>Animate inferred edges</button>
    </div>
    <div className="graph-filters" aria-label="Graph filters">
      <label>Search nodes <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Label, path, or type" /></label>
      <label>Node type <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">All types</option>{typeOptions.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      {(search || typeFilter !== 'all') && <button className="ghost-button" onClick={() => { setSearch(''); setTypeFilter('all') }}>Clear filters</button>}
    </div>
     <p className="graph-help">{mode === 'flow' ? `${flowMode === 'user-flow' ? 'User journeys' : flowMode === 'technical-flow' ? 'Technical execution' : 'Page navigation'} are derived from repository evidence. This is a guided visualization, not a live execution.` : 'Drag a node or focus it and use arrow keys (Shift for larger steps). Solid: verified import. Dashed: inferred relationship.'}</p>
    {mode === 'flow' && nodes.length > 0 && <ol className="flow-route-list" aria-label="Ordered route steps">
      {nodes.map((item, index) => <li key={item.id} className={step === index ? 'active' : ''}><button type="button" onClick={() => selectRouteStep(index)} aria-current={step === index ? 'step' : undefined}><span className="flow-route-index">{index === 0 ? 'S' : index === nodes.length - 1 ? 'E' : String(index).padStart(2, '0')}</span><span><b>{item.label}</b><small>{index === 0 ? 'Entry point' : index === nodes.length - 1 ? 'Response complete' : `${item.type} · ${item.path || 'detected step'}`}</small></span></button></li>)}
    </ol>}
    <div className="graph-legend" aria-label="Graph legend"><span className="legend-title">Legend</span><span><i className="legend-shape legend-entrypoint" /> entry / service node</span><span><i className="legend-shape legend-data" /> data / component node</span><span><i className="legend-line verified" /> verified import</span><span><i className="legend-line inferred" /> inferred relationship</span></div>
    <div className="graph-canvas-layout">
      <div className={`graph-viewport${mode === 'flow' ? ' flow-graph-viewport' : ''}`} ref={viewport} tabIndex={0} aria-label={`${mode === 'flow' ? 'Flow' : 'System'} diagram, scroll to explore`}>
        {!nodes.length ? <div className="graph-empty">{project ? 'No graph nodes were detected in the analyzed files.' : 'Analyze a repository to generate an evidence-backed graph.'}</div> : !visibleNodes.length ? <div className="graph-empty">No nodes match the current filters.</div> : <div style={{ width: bounds.width * zoom, height: bounds.height * zoom, position: 'relative' }}>
          <div className="graph-world" style={{ width: bounds.width, height: bounds.height, transform: `scale(${zoom})` }}>
            <svg className="graph-edges" width={bounds.width} height={bounds.height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#55534e" /></marker></defs>{visibleEdges.map(item => {
              const a = point(item.from), b = point(item.to), dx = b.x - a.x, dy = b.y - a.y
              const ratio = Math.max(Math.abs(dx) / (W / 2), Math.abs(dy) / (H / 2)) || 1
              const d = mode === 'flow' ? `M ${a.x + W} ${a.y + H / 2} L ${b.x} ${b.y + H / 2}` : item.from === item.to ? `M ${a.x + W} ${a.y + 65} C ${a.x + W + 30} ${a.y + 65}, ${a.x + W + 30} ${a.y - 25}, ${a.x + W - 20} ${a.y}` : `M ${a.x + W / 2 + dx / ratio} ${a.y + H / 2 + dy / ratio} L ${b.x + W / 2 - dx / ratio} ${b.y + H / 2 - dy / ratio}`
              return <path key={item.id} className={animateDashedEdges && !verified(item) ? 'animated-edge' : undefined} d={d} fill="none" stroke={selectedEdge === item.id ? '#5a359c' : '#55534e'} strokeWidth={selectedEdge === item.id ? 4 : 2} strokeDasharray={verified(item) ? undefined : '7 5'} markerEnd={`url(#${marker})`} />
            })}</svg>
            {visibleNodes.map(item => <button key={item.id} className={`graph-node ${mode === 'flow' ? 'flow-node' : ''} ${nodeTypeClass(item.type)} ${item.type === 'start' ? 'flow-start' : ''} ${item.type === 'end' ? 'flow-end' : ''} ${selected === item.id ? 'selected' : ''}`} style={{ left: point(item.id).x, top: point(item.id).y, width: W, height: H }} aria-label={`${item.label}, ${item.path ?? item.type}. Use arrow keys to move.`} aria-pressed={selected === item.id}
              onClick={() => { setSelected(item.id); setSelectedEdge(null) }}
              onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: item.id, x: event.clientX, y: event.clientY, start: point(item.id) }; setSelected(item.id) }}
              onPointerMove={event => { const active = drag.current; if (!active || active.id !== item.id) return; setPositions(current => ({ ...current, [item.id]: { x: Math.max(16, active.start.x + (event.clientX - active.x) / zoom), y: Math.max(16, active.start.y + (event.clientY - active.y) / zoom) } })) }}
              onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
              onKeyDown={event => { const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }; const delta = directions[event.key]; if (!delta) return; event.preventDefault(); const distance = event.shiftKey ? 40 : 10, current = point(item.id); setPositions(previous => ({ ...previous, [item.id]: { x: Math.max(16, current.x + delta.x * distance), y: Math.max(16, current.y + delta.y * distance) } })) }}>
                <b>{item.label}</b><small>{item.type}</small><span title={item.path}>{item.path ?? (item.type === 'start' ? 'Request enters the system' : item.type === 'end' ? 'Response leaves the system' : 'No source path attached')}</span>
            </button>)}
          </div>
        </div>}
      </div>
      {(node || edge) && <aside className="graph-inspector" aria-label="Selected graph evidence">
        <p className="inspector-kicker">DETAILS INSPECTOR</p>
        <h4>{edge && !node ? `Relationship: ${edge.type}` : node?.label}</h4>
         {node ? <><p>{node.type}{node.path ? ` · ${node.path}` : ''}</p>{node.implementationStatus && <p>Implementation: {node.implementationStatus} · Confidence: {Math.round((node.confidence ?? 0) * 100)}%</p>}{node.path && <a href={source(node.path, node.sourceLine)} target="_blank" rel="noreferrer">Open source: {node.path}{node.sourceLine ? `:${node.sourceLine}` : ''}</a>}{mode === 'flow' && derivedFlow && <button className="ghost-button graph-explain-button" disabled={explaining} onClick={() => void explainSelectedNode()}>{explaining ? 'Explaining with Gemini…' : 'Explain with Gemini'}</button>}{aiExplanation?.nodeId === node.id && <div className="graph-ai-explanation"><b>Gemini interpretation</b><p>{aiExplanation.explanation}</p>{aiExplanation.caveats.map((caveat, index) => <small key={index}>Caveat: {caveat}</small>)}</div>}<h5>Incoming ({incoming.length})</h5>{incoming.length ? <ul>{incoming.map(item => <li key={item.id}><button className="inspector-link" onClick={() => chooseEdge(item)}>{edgeLabel(item)}{item.label ? ` · ${item.label}` : ''}</button></li>)}</ul> : <p>No incoming relationships.</p>}<h5>Outgoing ({outgoing.length})</h5>{outgoing.length ? <ul>{outgoing.map(item => <li key={item.id}><button className="inspector-link" onClick={() => chooseEdge(item)}>{edgeLabel(item)}{item.label ? ` · ${item.label}` : ''}</button></li>)}</ul> : <p>No outgoing relationships.</p>}<h5>Evidence</h5>{evidence(node.evidenceIds)}</> : edge && <><p>{verified(edge) ? 'Verified static import; not runtime proof.' : 'Inferred relationship; not verified runtime behavior.'}</p><p>{edgeLabel(edge)}{edge.label ? ` · ${edge.label}` : ''}{edge.implementationStatus ? ` · ${edge.implementationStatus}` : ''}</p><h5>Evidence</h5>{evidence(edge.evidenceIds)}</>}
      </aside>}
    </div>
     <p className="graph-status" role="status">{mode === 'flow' ? `${nodes.length} evidence nodes · ${edges.length} directed relationships` : `${nodes.length} nodes · ${edges.length} relationships`}{visibleNodes.length !== nodes.length ? ` · ${visibleNodes.length} shown` : ''}{trace.length > 0 ? ` · Trace ${Math.max(0, step + 1)}/${trace.length}: ${playing ? 'playing' : flowComplete ? 'complete' : 'paused'}` : ''}</p>
    {edges.length > 0 && <details className="graph-relationships"><summary>Inspect relationships ({edges.length})</summary><ul>{edges.map(item => <li key={item.id}><button className="ghost-button" aria-pressed={selectedEdge === item.id} onClick={() => { setSelectedEdge(item.id); setSelected(null); setPlaying(false) }}>{edgeLabel(item)} · {verified(item) ? 'Verified import' : 'Inferred'} ({item.type})</button></li>)}</ul></details>}
    {(mode === 'flow' ? project?.flow.notes : project?.systemDesign.notes)?.map((note, index) => <p className="artifact-note" key={index}>{note}</p>)}
  </section>
}

export default RepositoryGraph
