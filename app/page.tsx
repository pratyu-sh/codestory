'use client'

import { useMemo, useRef, useState } from 'react'
import type { ProjectModel, InterviewSeed } from '../lib/analysis/types'
import { RepositoryGraph } from './components/RepositoryGraph'

type Artifact = 'Overview' | 'Flowchart' | 'System Design' | 'PRD' | 'Interview Questions'
type ExportFormat = 'pdf' | 'docx' | 'pptx'
type ChatMessage = { role: 'user' | 'assistant'; text: string }
const artifacts: Artifact[] = ['Overview', 'Flowchart', 'System Design', 'PRD', 'Interview Questions']
const emptyChats = (): Record<Artifact, ChatMessage[]> => ({
  Overview: [], Flowchart: [], 'System Design': [], PRD: [], 'Interview Questions': [],
})
const emptyDrafts = (): Record<Artifact, string> => ({
  Overview: '', Flowchart: '', 'System Design': '', PRD: '', 'Interview Questions': '',
})

function followUps(seeds: InterviewSeed[], version: number): InterviewSeed[] {
  if (!version) return seeds
  return seeds.map(seed => ({
    ...seed,
    question: [
      `Which source evidence would you use to validate your answer to: ${seed.question}`,
      `What failure case would you test when considering: ${seed.question}`,
      `What trade-off and alternative would you discuss for: ${seed.question}`,
    ][(version - 1) % 3],
  }))
}

function evidenceFor(project: ProjectModel, artifact: Artifact) {
  if (artifact === 'Overview' || artifact === 'PRD') return project.evidence
  const ids = new Set(artifact === 'Interview Questions'
    ? project.interviewSeeds.flatMap(item => item.evidenceIds)
    : artifact === 'Flowchart'
      ? [...project.flow.steps, ...project.flow.edges].flatMap(item => item.evidenceIds)
      : [...project.systemDesign.nodes, ...project.systemDesign.edges].flatMap(item => item.evidenceIds))
  return project.evidence.filter(item => ids.has(item.id))
}

function artifactText(project: ProjectModel, artifact: Artifact, summary: string, questions: InterviewSeed[]) {
  if (artifact === 'PRD') return [
    `Executive summary (editable): ${summary}`,
    `Repository: ${project.project.fullName}. ${project.project.description || 'No repository description provided.'}`,
    `Detected technologies: ${project.technologies.map(item => item.name).join(', ') || 'None detected'}.`,
    'Requirements and product intent are not verified by static analysis. Validate the following implementation inventory with maintainers.',
    ...project.files.map(file => `${file.role}: ${file.path}`),
  ]
  if (artifact === 'Interview Questions') return questions.flatMap(item => [
    item.question, item.whyItMatters,
    `Discussion signals: ${item.expectedSignals.join(', ')}`,
    `Evidence: ${item.evidenceIds.join(', ') || 'No references supplied'}`,
  ])
  if (artifact === 'Flowchart') return [
    ...project.flow.steps.map(step => `${step.order}. ${step.label} (${step.kind}) ${step.path || ''}`),
    ...project.flow.edges.map(edge => `${edge.from} → ${edge.to}: ${edge.type} (${edge.verified ? 'verified' : 'inferred'})`),
    ...project.flow.notes,
  ]
  if (artifact === 'System Design') return [
    ...project.systemDesign.nodes.map(node => `${node.label} (${node.type}) ${node.path || ''}`),
    ...project.systemDesign.edges.map(edge => `${edge.from} → ${edge.to}: ${edge.type} (${edge.verified ? 'verified' : 'inferred'})`),
    ...project.systemDesign.notes,
  ]
  return [
    project.project.fullName,
    project.project.description || 'No repository description provided.',
    `Technologies: ${project.technologies.map(item => item.name).join(', ') || 'None detected'}`,
    `${project.files.length} files analyzed; ${project.analysis.skippedFileCount} skipped or filtered.`,
    `Analysis: ${project.analysis.status}; truncated: ${project.analysis.truncated ? 'yes' : 'no'}.`,
    `${project.flow.steps.length} flow steps; ${project.systemDesign.nodes.length} architecture nodes.`,
  ]
}

function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (format: ExportFormat) => void }) {
  const menu = useRef<HTMLDetailsElement>(null)
  if (disabled) return <button className="export-button" disabled>⇩ Export</button>
  return (
    <details className="export-menu" ref={menu}>
      <summary className="export-button">⇩ Export</summary>
      <div className="export-options">
        {(['pdf', 'docx', 'pptx'] as const).map(format => (
          <button key={format} onClick={() => {
            if (menu.current) menu.current.open = false
            onExport(format)
          }}>{format.toUpperCase()}</button>
        ))}
      </div>
    </details>
  )
}

export default function Home() {
  const [activeArtifact, setActiveArtifact] = useState<Artifact>('Overview')
  const [repo, setRepo] = useState('')
  const [project, setProject] = useState<ProjectModel | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisStatus, setAnalysisStatus] = useState('')
  const controller = useRef<AbortController | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const [summary, setSummary] = useState('')
  const [questionVersion, setQuestionVersion] = useState(0)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [chatOpen, setChatOpen] = useState(false)
  const [conversations, setConversations] = useState(emptyChats)
  const [drafts, setDrafts] = useState(emptyDrafts)
  const questions = useMemo(() => followUps(project?.interviewSeeds || [], questionVersion), [project, questionVersion])
  const projectName = project?.project.name || 'No repository imported'
  const busy = analyzing || exporting

  async function analyzeRepository() {
    if (busy || controller.current) return
    setAnalysisError('')
    setAnalysisStatus('')
    if (!/^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/?$/.test(repo.trim())) {
      setAnalysisError('Enter a public GitHub URL like https://github.com/owner/repository.')
      return
    }
    const request = new AbortController()
    controller.current = request
    setAnalyzing(true)
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: repo.trim() }), signal: request.signal,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || 'Repository analysis failed.')
      if (request.signal.aborted) return
      const next = payload as ProjectModel
      setProject(next)
      setSummary(next.project.description || `${next.project.fullName}: ${next.files.length} files inspected by bounded static analysis.`)
      setConversations(emptyChats())
      setDrafts(emptyDrafts())
      setQuestionVersion(0)
      setRevealed({})
      setExportError('')
      setExportStatus('')
      setActiveArtifact('Overview')
      setAnalysisStatus(`Imported ${next.project.fullName}.`)
    } catch (error) {
      if (request.signal.aborted) setAnalysisStatus('Import cancelled. Existing analysis retained.')
      else setAnalysisError(error instanceof Error ? error.message : 'Repository analysis failed.')
    } finally {
      controller.current = null
      setAnalyzing(false)
    }
  }

  function ask() {
    const question = drafts[activeArtifact].trim()
    if (!question || !project) return
    const evidence = evidenceFor(project, activeArtifact)
    const terms = question.toLowerCase().split(/\W+/).filter(term => term.length > 3)
    const matches = evidence.filter(item => terms.some(term =>
      `${item.path || ''} ${item.description} ${item.quote || ''}`.toLowerCase().includes(term)))
    const text = /^(summary|summarize|overview)\b/i.test(question)
      ? artifactText(project, activeArtifact, summary, questions).slice(0, 8).join('\n')
      : matches.length
        ? `Matching ${activeArtifact} evidence (keyword lookup, not an inferred answer):\n${matches.slice(0, 5).map(item =>
          `${item.path || item.id}${item.line ? `:${item.line}` : ''}: ${item.description}${item.quote ? ` — ${item.quote}` : ''}`).join('\n')}`
        : `I cannot answer that from the active ${activeArtifact} evidence. Try “summary” or a file path or technology shown in this artifact.`
    setConversations(current => ({
      ...current,
      [activeArtifact]: [...current[activeArtifact], { role: 'user', text: question }, { role: 'assistant', text }],
    }))
    setDrafts(current => ({ ...current, [activeArtifact]: '' }))
  }

  async function exportArtifact(format: ExportFormat) {
    if (!project || busy) return
    setExporting(true)
    setExportError('')
    setExportStatus('')
    const artifact = {
      projectName, title: activeArtifact,
      headings: [{ text: activeArtifact, level: 1 }],
      paragraphs: artifactText(project, activeArtifact, summary, questions),
      bullets: ['Static analysis only; repository code was not executed.', ...project.analysis.warnings,
        ...evidenceFor(project, activeArtifact).map(item => `${item.id}: ${item.path || 'metadata'}${item.line ? `:${item.line}` : ''} — ${item.description}`)],
    }
    try {
      const response = await fetch('/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, artifact }),
      })
      if (!response.ok) throw new Error('Export failed. Please try again.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `${projectName}-${activeArtifact}.${format}`.replace(/[/\\]/g, '-')
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setExportStatus(`${activeArtifact} ${format.toUpperCase()} download requested.`)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">✦</div>
          <div><strong>CodeAtlas</strong><span>developer intelligence</span></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-card">
          <div className="repo-avatar">{project ? projectName[0].toUpperCase() : '—'}</div>
          <div><b>{projectName}</b><small>{project?.project.owner || 'Public GitHub analysis'}</small></div>
        </div>
        <nav aria-label="Artifacts">
          {artifacts.map(label => (
            <button key={label} className={`nav-item${activeArtifact === label ? ' active' : ''}`}
              aria-pressed={activeArtifact === label} onClick={() => setActiveArtifact(label)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="status">{analyzing ? 'Analyzing repository' : project ? `Analysis: ${project.analysis.status}` : 'Awaiting repository'}</div>
        </div>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <div className="crumb"><span>Workspace</span><b>/</b><strong>{projectName}</strong></div>
          <details className="top-actions">
            <summary className="help-button">Help</summary>
            <p>Import a public GitHub repository, then choose an artifact. Graphs use static evidence;
              inferred links are not runtime traces. Export downloads the current artifact.
              The local evidence assistant uses summaries and keyword matching, not AI.</p>
          </details>
        </header>
        <div className="content">
          <div className="hero-row">
            <div>
              <div className="eyebrow">{analyzing ? 'ANALYZING REPOSITORY' : project ? 'REPOSITORY ANALYSIS' : 'START WITH A REPOSITORY'}</div>
              <h1>Understand your codebase <span>✦</span></h1>
              <p>Inspect a public GitHub repository through traceable structure, flows, and source evidence.</p>
            </div>
            {project && <div className="last-sync">Last analyzed<br /><b>{new Date(project.analysis.analyzedAt).toLocaleString()}</b></div>}
          </div>
          <form className={`repo-input${analysisError ? ' has-error' : ''}`} onSubmit={event => {
            event.preventDefault()
            void analyzeRepository()
          }}>
            <label className="sr-only" htmlFor="repository-url">Public GitHub repository URL</label>
            <span className="github" aria-hidden="true">⌘</span>
            <input id="repository-url" type="url" value={repo} disabled={busy}
              placeholder="https://github.com/owner/repository" required
              onChange={event => { setRepo(event.target.value); setAnalysisError(''); setAnalysisStatus('') }} />
            <button type="submit" disabled={busy}>{analyzing ? 'Analyzing…' : 'Analyze repository →'}</button>
            {analyzing && <button type="button" onClick={() => controller.current?.abort()}>Cancel</button>}
          </form>
          {analysisError && <p className="analysis-feedback error-message" role="alert">{analysisError}</p>}
          {analysisStatus && <p className="analysis-feedback success-message" role="status">{analysisStatus}</p>}
          {project && <section className="evidence-note" aria-label="Analysis limits">
            <b>Static analysis · {project.analysis.status}</b>
            <p>Repository code was not executed. {project.analysis.skippedFileCount} files skipped or filtered.
              {project.analysis.truncated && ' Analysis was truncated by configured limits.'}</p>
            {project.analysis.warnings.length > 0 && <ul>{project.analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          </section>}
          <div className="workspace-toolbar">
            <div className="tabs" aria-label="Artifact views">
              {artifacts.map(label => <button key={label}
                className={`tab${activeArtifact === label ? ' active' : ''}`}
                aria-pressed={activeArtifact === label} onClick={() => setActiveArtifact(label)}>{label}</button>)}
            </div>
            <ExportMenu disabled={!project || busy} onExport={exportArtifact} />
          </div>
          {exporting && <p role="status">Preparing export…</p>}
          {exportError && <p className="error-message" role="alert">{exportError}</p>}
          {exportStatus && <p role="status">{exportStatus}</p>}
          {activeArtifact === 'Overview' && <>
            <div className="stats-grid">
              <div className="stat-card"><div><small>TECH STACK</small><strong>{project?.technologies.map(item => item.name).join(' · ') || 'No technology evidence'}</strong></div></div>
              <div className="stat-card"><div><small>FILES ANALYZED</small><strong>{project ? project.files.length : '—'}</strong></div></div>
              <div className="stat-card"><div><small>ANALYSIS STATUS</small><strong>{project?.analysis.status || 'Awaiting import'}</strong><p>{project ? `${project.evidence.length} evidence references` : 'No repository analyzed'}</p></div></div>
            </div>
            <section className="panel architecture">
              <div className="panel-head"><div><h3>Architecture at a glance</h3><p>{project?.project.description || 'No repository description available.'}</p></div></div>
              {project?.systemDesign.nodes.length ? <ul>{project.systemDesign.nodes.map(node => <li key={node.id}>{node.label} · {node.type}{node.path && ` · ${node.path}`}</li>)}</ul> : <p>Import a repository with detected components to inspect its architecture.</p>}
              <button className="text-button" onClick={() => setActiveArtifact('System Design')}>View full map →</button>
            </section>
          </>}
          <div hidden={activeArtifact !== 'Flowchart'}>
            <RepositoryGraph key={project?.analysis.analyzedAt || 'empty'} project={project} mode="flow" />
          </div>
          <div hidden={activeArtifact !== 'System Design'}>
            <RepositoryGraph key={project?.analysis.analyzedAt || 'empty'} project={project} mode="system" />
          </div>
          {activeArtifact === 'PRD' && <section className="artifact-panel document-view">
            <article className="prd-document">
              <div className="doc-kicker">REPOSITORY PRODUCT BRIEF · DRAFT</div>
              <h3>{projectName}</h3>
              {!project ? <p>Import a repository to create a source-grounded draft.</p> : <>
                <p className="evidence-note">Static implementation evidence does not establish product requirements or user intent. Confirm requirements with maintainers.</p>
                <label htmlFor="prd-summary"><h4>Executive summary (editable draft)</h4></label>
                <textarea id="prd-summary" rows={4} value={summary} onChange={event => setSummary(event.target.value)} />
                <h4>Detected technologies</h4>
                <p>{project.technologies.map(item => item.name).join(', ') || 'No technologies detected.'}</p>
                <h4>Implementation inventory</h4>
                <ul>{project.files.map(file => <li key={file.path}>{file.role}: {file.path}</li>)}</ul>
                <h4>Source evidence</h4>
                <ul>{project.evidence.map(item => <li key={item.id}>{item.path || item.id}: {item.description}</li>)}</ul>
              </>}
            </article>
          </section>}
          {activeArtifact === 'Interview Questions' && <section className="artifact-panel questions-view">
            <div className="panel-head">
              <div><h3>Interview practice set</h3><p>Repository seeds with deterministic follow-up templates.</p></div>
              <button className="ghost-button" disabled={!questions.length} onClick={() => setQuestionVersion(value => value + 1)}>↻ Regenerate follow-ups</button>
            </div>
            {!questions.length && <p>No interview seeds available. Import a repository with relevant evidence.</p>}
            <div className="question-list">{questions.map((item, index) => <details className="question-card"
              key={item.id} open={revealed[item.id] || false}
              onToggle={event => {
                const open = event.currentTarget.open
                setRevealed(current => current[item.id] === open ? current : { ...current, [item.id]: open })
              }}>
              <summary><span className="question-number">{String(index + 1).padStart(2, '0')}</span><div><small>{item.category}</small><b>{item.question}</b></div></summary>
              <div className="answer"><p>{item.whyItMatters}</p><p>Discussion signals: {item.expectedSignals.join(', ')}</p><small>Evidence: {item.evidenceIds.join(', ') || 'No references supplied'}</small></div>
            </details>)}</div>
          </section>}
        </div>
        <aside className="chat-panel" aria-label="Evidence assistant (local)">
          <div className="chat-head">
            <div><b>Evidence assistant (local)</b><small>{activeArtifact} · summaries and keyword lookup, not AI</small></div>
            <button aria-expanded={chatOpen} aria-controls="evidence-chat-body"
              aria-label={chatOpen ? 'Hide evidence assistant' : 'Show evidence assistant'}
              onClick={() => setChatOpen(value => !value)}>{chatOpen ? '−' : '+'}</button>
          </div>
          <div id="evidence-chat-body" hidden={!chatOpen}>
            <div className="chat-body" aria-live="polite">
              {!conversations[activeArtifact].length && <p className="chat-empty">Ask for a summary or enter a source term from this artifact. Unknown answers are not inferred.</p>}
              {conversations[activeArtifact].map((message, index) => <p key={index}
                className={message.role === 'user' ? 'user-message' : 'assistant-message'} style={{ whiteSpace: 'pre-wrap' }}>
                <b>{message.role === 'user' ? 'You' : 'Local evidence'}: </b>{message.text}
              </p>)}
            </div>
            <form className="chat-compose" onSubmit={event => { event.preventDefault(); ask() }}>
              <label className="sr-only" htmlFor="evidence-question">Question about {activeArtifact}</label>
              <textarea id="evidence-question" value={drafts[activeArtifact]} disabled={!project || analyzing}
                placeholder={project ? 'Ask for a summary or source evidence…' : 'Import a repository first'}
                onChange={event => setDrafts(current => ({ ...current, [activeArtifact]: event.target.value }))} />
              <button type="submit" disabled={!project || analyzing || !drafts[activeArtifact].trim()}>Send</button>
            </form>
          </div>
        </aside>
      </section>
    </main>
  )
}
