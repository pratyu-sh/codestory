'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { GraphEdge, ProjectModel } from '../../lib/analysis/types'

type Point = { x: number; y: number }
const W = 192, H = 96

export function RepositoryGraph({ project, mode }: { project: ProjectModel | null; mode: 'flow' | 'system' }) {
  const nodes = useMemo(() => mode === 'flow' ? project?.flow.nodes ?? [] : project?.systemDesign.nodes ?? [], [project, mode])
  const edges = useMemo(() => {
    const ids = new Set(nodes.map(node => node.id))
    return (mode === 'flow' ? project?.flow.edges ?? [] : project?.systemDesign.edges ?? []).filter(edge => ids.has(edge.from) && ids.has(edge.to))
  }, [project, mode, nodes])
  const initial = useMemo(() => {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
    return Object.fromEntries(nodes.map((node, index) => [node.id, { x: 32 + index % columns * 260, y: 32 + Math.floor(index / columns) * 170 }]))
  }, [nodes])
  const [positions, setPositions] = useState<Record<string, Point>>(initial)
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [trace, setTrace] = useState<GraphEdge[]>([])
  const [step, setStep] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; x: number; y: number; start: Point } | null>(null)
  const marker = useId().replace(/:/g, '')
  const point = (id: string) => positions[id] ?? initial[id] ?? { x: 32, y: 32 }
  const bounds = nodes.reduce((size, node) => ({ width: Math.max(size.width, point(node.id).x + W + 32), height: Math.max(size.height, point(node.id).y + H + 32) }), { width: 256, height: 180 })

  useEffect(() => {
    setPositions(initial); setSelected(null); setSelectedEdge(null); setPlaying(false); setTrace([]); setStep(-1); setZoom(1)
  }, [initial])
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      if (step + 1 >= trace.length) { setPlaying(false); return }
      const next = step + 1
      setStep(next); setSelectedEdge(trace[next].id); setSelected(trace[next].to)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [playing, step, trace])
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
  function source(path: string, line?: number) {
    if (!project) return '#'
    const info = project.project
    return `https://github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.name)}/blob/${encodeURIComponent(info.defaultBranch)}/${path.split('/').map(encodeURIComponent).join('/')}${line && line > 0 ? `#L${line}` : ''}`
  }
  function evidence(ids: string[]) {
    const records = project?.evidence.filter(item => ids.includes(item.id)) ?? []
    return records.length ? <ul>{records.map(item => <li key={item.id}><b>{item.kind} · {item.confidence} confidence</b><p>{item.description}</p>{item.path && <a href={source(item.path, item.line)} target="_blank" rel="noreferrer">{item.path}{item.line ? `:${item.line}` : ''}</a>}{item.quote && <pre>{item.quote}</pre>}</li>)}</ul> : <p>No source evidence attached.</p>
  }
  const node = nodes.find(item => item.id === selected), edge = edges.find(item => item.id === selectedEdge)
  const verified = (item: GraphEdge) => item.verified && item.type === 'imports'
  return <section className="artifact-panel repository-graph">
    <div className="panel-head"><div><h3>{mode === 'flow' ? 'Repository execution flow' : 'System design'}</h3><p>Static repository evidence · imports do not prove runtime execution.</p></div></div>
    <div className="graph-toolbar" aria-label="Diagram controls">
      <button className="ghost-button" disabled={!nodes.length} onClick={() => setZoom(value => Math.max(.05, value / 1.2))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span>
      <button className="ghost-button" disabled={!nodes.length} onClick={() => setZoom(value => Math.min(2, value * 1.2))} aria-label="Zoom in">+</button>
      <button className="ghost-button" disabled={!nodes.length} onClick={fit}>Fit diagram</button>
      <button className="ghost-button" disabled={!nodes.length} onClick={() => { setPositions(initial); setZoom(1); setPlaying(false) }}>Reset layout</button>
      <button className="primary-button" disabled={!edges.length} onClick={() => playing ? setPlaying(false) : startTrace()}>{playing ? 'Stop trace' : 'Trace connected path'}</button>
      {!playing && trace.length > 0 && step < trace.length - 1 && <button className="ghost-button" onClick={() => { const next = step + 1; setStep(next); setSelectedEdge(trace[next].id); setSelected(trace[next].to) }}>Next trace edge</button>}
    </div>
    <p className="graph-help">Drag a node or focus it and use arrow keys (Shift for larger steps). Solid: verified import. Dashed: inferred relationship.</p>
    <div className="graph-viewport" ref={viewport} tabIndex={0} aria-label={`${mode === 'flow' ? 'Flow' : 'System'} diagram, scroll to explore`}>
      {!nodes.length ? <div className="graph-empty">{project ? 'No graph nodes were detected in the analyzed files.' : 'Analyze a repository to generate an evidence-backed graph.'}</div> : <div style={{ width: bounds.width * zoom, height: bounds.height * zoom, position: 'relative' }}>
        <div className="graph-world" style={{ width: bounds.width, height: bounds.height, transform: `scale(${zoom})` }}>
          <svg className="graph-edges" width={bounds.width} height={bounds.height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#55534e" /></marker></defs>{edges.map(item => {
            const a = point(item.from), b = point(item.to), dx = b.x - a.x, dy = b.y - a.y
            const ratio = Math.max(Math.abs(dx) / (W / 2), Math.abs(dy) / (H / 2)) || 1
            const d = item.from === item.to ? `M ${a.x + W} ${a.y + 65} C ${a.x + W + 30} ${a.y + 65}, ${a.x + W + 30} ${a.y - 25}, ${a.x + W - 20} ${a.y}` : `M ${a.x + W / 2 + dx / ratio} ${a.y + H / 2 + dy / ratio} L ${b.x + W / 2 - dx / ratio} ${b.y + H / 2 - dy / ratio}`
            return <path key={item.id} d={d} fill="none" stroke={selectedEdge === item.id ? '#5a359c' : '#55534e'} strokeWidth={selectedEdge === item.id ? 4 : 2} strokeDasharray={verified(item) ? undefined : '7 5'} markerEnd={`url(#${marker})`} />
          })}</svg>
          {nodes.map(item => <button key={item.id} className={`graph-node ${selected === item.id ? 'selected' : ''}`} style={{ left: point(item.id).x, top: point(item.id).y, width: W, height: H }} aria-label={`${item.label}, ${item.path ?? ('kind' in item ? item.kind : item.type)}. Use arrow keys to move.`} aria-pressed={selected === item.id}
            onClick={() => { setSelected(item.id); setSelectedEdge(null) }}
            onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: item.id, x: event.clientX, y: event.clientY, start: point(item.id) }; setSelected(item.id) }}
            onPointerMove={event => { const active = drag.current; if (!active || active.id !== item.id) return; setPositions(current => ({ ...current, [item.id]: { x: Math.max(16, active.start.x + (event.clientX - active.x) / zoom), y: Math.max(16, active.start.y + (event.clientY - active.y) / zoom) } })) }}
            onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
            onKeyDown={event => { const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }; const delta = directions[event.key]; if (!delta) return; event.preventDefault(); const distance = event.shiftKey ? 40 : 10, current = point(item.id); setPositions(previous => ({ ...previous, [item.id]: { x: Math.max(16, current.x + delta.x * distance), y: Math.max(16, current.y + delta.y * distance) } })) }}>
            <b>{item.label}</b><small>{'kind' in item ? item.kind : item.type}</small><span title={item.path}>{item.path ?? 'No source path attached'}</span>
          </button>)}
        </div>
      </div>}
    </div>
    <p className="graph-status" role="status">{nodes.length} nodes · {edges.length} relationships{trace.length > 0 ? ` · Trace ${step + 1}/${trace.length}: ${playing ? 'playing' : 'paused / complete'}` : ''}</p>
    {edges.length > 0 && <details className="graph-relationships"><summary>Inspect relationships ({edges.length})</summary><ul>{edges.map(item => <li key={item.id}><button className="ghost-button" aria-pressed={selectedEdge === item.id} onClick={() => { setSelectedEdge(item.id); setSelected(null); setPlaying(false) }}>{nodes.find(n => n.id === item.from)?.label} → {nodes.find(n => n.id === item.to)?.label} · {verified(item) ? 'Verified import' : 'Inferred'} ({item.type})</button></li>)}</ul></details>}
    {(node || edge) && <aside className="graph-inspector" aria-label="Selected graph evidence"><h4>{edge ? `Relationship: ${edge.type}` : node?.label}</h4>{edge ? <><p>{verified(edge) ? 'Verified static import; not runtime proof.' : 'Inferred relationship; not verified runtime behavior.'}</p>{evidence(edge.evidenceIds)}</> : node && <>{node.path && <a href={source(node.path)} target="_blank" rel="noreferrer">Open source: {node.path}</a>}{evidence(node.evidenceIds)}</>}</aside>}
    {(mode === 'flow' ? project?.flow.notes : project?.systemDesign.notes)?.map((note, index) => <p className="artifact-note" key={index}>{note}</p>)}
  </section>
}

export default RepositoryGraph
