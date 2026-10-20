'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectModel, InterviewSeed } from '../lib/analysis/types'
import { RepositoryGraph } from './components/RepositoryGraph'
import PrdWorkspace, { type PRDRevision } from './components/PrdWorkspace'
import { normalizePrdDocument } from '../lib/prd/schema'
import type { PRDDocument, PRDSectionId } from '../lib/prd/types'

type Artifact = 'Overview' | 'Flowchart' | 'System Design' | 'PRD' | 'Interview Questions'
type ExportFormat = 'pdf' | 'docx' | 'pptx'
type ChatMessage = { role: 'user' | 'assistant'; text: string }
const artifacts: Artifact[] = ['Overview', 'Flowchart', 'System Design', 'PRD', 'Interview Questions']
const WORKSPACE_STORAGE_KEY = 'codeatlas:workspace:v1'
const emptyChats = (): Record<Artifact, ChatMessage[]> => ({
  Overview: [], Flowchart: [], 'System Design': [], PRD: [], 'Interview Questions': [],
})
const emptyDrafts = (): Record<Artifact, string> => ({
  Overview: '', Flowchart: '', 'System Design': '', PRD: '', 'Interview Questions': '',
})

function isProjectModel(value: unknown): value is ProjectModel {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const project = record.project
  const flow = record.flow
  const systemDesign = record.systemDesign
  const analysis = record.analysis
  return Boolean(
    project && typeof project === 'object' && typeof (project as Record<string, unknown>).name === 'string'
      && Array.isArray(record.files)
      && Array.isArray(record.technologies)
      && Array.isArray(record.evidence)
      && flow && typeof flow === 'object' && Array.isArray((flow as Record<string, unknown>).steps)
      && Array.isArray((flow as Record<string, unknown>).edges)
      && systemDesign && typeof systemDesign === 'object'
      && Array.isArray((systemDesign as Record<string, unknown>).nodes)
      && Array.isArray((systemDesign as Record<string, unknown>).edges)
      && Array.isArray(record.interviewSeeds)
      && analysis && typeof analysis === 'object'
      && typeof (analysis as Record<string, unknown>).analyzedAt === 'string',
  )
}

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

function artifactText(project: ProjectModel, artifact: Artifact, summary: string, questions: InterviewSeed[], prdDocument: PRDDocument | null = null) {
  if (artifact === 'PRD' && prdDocument) return prdDocument.sections.flatMap(section => [
    `## ${section.title} · ${section.status}`,
    section.summary,
    ...section.content,
    ...section.requirements.map(requirement => `${requirement.id} [${requirement.status}/${requirement.priority}]: ${requirement.text}\nActor: ${requirement.actor}\nPreconditions: ${requirement.preconditions.join(' | ')}\nTrigger: ${requirement.trigger}\nExpected behavior: ${requirement.expectedBehavior.join(' | ')}\nInputs: ${requirement.inputs.join(' | ')}\nOutputs: ${requirement.outputs.join(' | ')}\nBusiness rules: ${requirement.businessRules.join(' | ')}\nError conditions: ${requirement.errorConditions.join(' | ')}\nRelated dependencies: ${requirement.relatedDependencies.join(' | ')}\nAcceptance: ${requirement.acceptanceCriteria.join(' | ')}\nEvidence: ${requirement.evidenceIds.join(', ') || 'none'}`),
  ])
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
  const [showLanding, setShowLanding] = useState(true)
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
  const [storageReady, setStorageReady] = useState(false)
  const howRef = useRef<HTMLElement>(null)
  const [prdDocument, setPrdDocument] = useState<PRDDocument | null>(null)
  const [prdRevisions, setPrdRevisions] = useState<PRDRevision[]>([])
  const [prdDirty, setPrdDirty] = useState(false)
  const [prdEditedSections, setPrdEditedSections] = useState<Record<string, boolean>>({})
  const [prdGenerating, setPrdGenerating] = useState<'all' | PRDSectionId | null>(null)
  const [prdStatus, setPrdStatus] = useState('')
  const [prdError, setPrdError] = useState('')
  const [prdSavedAt, setPrdSavedAt] = useState('')
  const [prdProjectKey, setPrdProjectKey] = useState('')
  const [prdStale, setPrdStale] = useState(false)
  const questions = useMemo(() => followUps(project?.interviewSeeds || [], questionVersion), [project, questionVersion])
  const projectName = project?.project.name || 'No repository imported'
  const busy = analyzing || exporting || prdGenerating !== null
  const isCanvasArtifact = activeArtifact === 'Flowchart' || activeArtifact === 'System Design'
  const currentProjectKey = project ? `${project.project.fullName}@${project.analysis.analyzedAt}` : ''

  function openWorkspace() {
    setActiveArtifact('Overview')
    setShowLanding(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function returnHome() {
    setShowLanding(true)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function scrollToHowItWorks() {
    howRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { repo?: unknown; project?: unknown; summary?: unknown; prdDocument?: unknown; prdRevisions?: unknown; prdSavedAt?: unknown; prdProjectKey?: unknown; prdStale?: unknown }
        if (isProjectModel(saved.project)) {
          setProject(saved.project)
          setRepo(typeof saved.repo === 'string' ? saved.repo : '')
          setSummary(typeof saved.summary === 'string' ? saved.summary : '')
          setAnalysisStatus('Restored the previous repository analysis.')
          if (saved.prdDocument) {
            try { setPrdDocument(normalizePrdDocument(saved.prdDocument)) } catch { setPrdDocument(null) }
          }
          if (Array.isArray(saved.prdRevisions)) {
            setPrdRevisions(saved.prdRevisions.flatMap(item => {
              if (!item || typeof item !== 'object') return []
              const revision = item as { document?: unknown; savedAt?: unknown }
              if (typeof revision.savedAt !== 'string' || !revision.document) return []
              try { return [{ document: normalizePrdDocument(revision.document), savedAt: revision.savedAt }] } catch { return [] }
            }).slice(0, 10))
          }
          const restoredProjectKey = `${saved.project.project.fullName}@${saved.project.analysis.analyzedAt}`
          setPrdSavedAt(typeof saved.prdSavedAt === 'string' ? saved.prdSavedAt : '')
          const restoredPrdProjectKey = typeof saved.prdProjectKey === 'string' ? saved.prdProjectKey : restoredProjectKey
          setPrdProjectKey(restoredPrdProjectKey)
          setPrdStale(saved.prdStale === true || restoredPrdProjectKey !== restoredProjectKey)
        }
      }
    } catch {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    } finally {
      setStorageReady(true)
    }
  }, [])

  useEffect(() => {
    if (!storageReady) return
    if (!project) {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
      return
    }
    try {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
        repo, project, summary, prdDocument, prdRevisions: prdRevisions.slice(0, 10), prdSavedAt,
        prdProjectKey, prdStale,
      }))
    } catch {
      // A full localStorage quota should not prevent the analyzed workspace from being used.
    }
  }, [project, repo, summary, prdDocument, prdRevisions, prdSavedAt, prdProjectKey, prdStale, storageReady])

  async function generatePrd(sectionId?: PRDSectionId, userContext = ''): Promise<boolean> {
    if (!project || prdGenerating) return false
    if (sectionId && prdStale) {
      setPrdError('This document belongs to an older repository analysis. Generate a new document before regenerating an individual section.')
      return false
    }
    setPrdGenerating(sectionId || 'all')
    setPrdError('')
    setPrdStatus(sectionId ? `Preparing fresh evidence for ${sectionId}…` : 'Preparing bounded repository evidence…')
    try {
      const existingDocument = prdDocument && !prdStale ? normalizePrdDocument(prdDocument) : undefined
      const body: Record<string, unknown> = { project, userContext: userContext.slice(0, 4000) }
      if (existingDocument) body.document = existingDocument
      if (sectionId) body.sectionId = sectionId
      setPrdStatus(sectionId ? `Gemini is regenerating ${sectionId}…` : 'Gemini is drafting the structured PRD…')
      const response = await fetch('/api/prd/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const payload = await response.json() as PRDDocument | { error?: { message?: string } }
      if (!response.ok) throw new Error('error' in payload ? payload.error?.message || 'PRD generation failed.' : 'PRD generation failed.')
      const next = payload as PRDDocument
      const now = new Date().toISOString()
      setPrdDocument(next)
      setPrdProjectKey(currentProjectKey)
      setPrdStale(false)
      setPrdDirty(false)
      setPrdEditedSections({})
      setPrdSavedAt(now)
      setPrdRevisions(current => [{ document: next, savedAt: now }, ...current.filter(item => item.document.version.number !== next.version.number)].slice(0, 10))
      setPrdStatus(sectionId ? `${sectionId} regenerated with Gemini and saved locally.` : 'PRD generated with Gemini and saved locally.')
      return true
    } catch (error) {
      setPrdError(error instanceof Error ? error.message : 'PRD generation failed.')
      setPrdStatus('')
      return false
    } finally {
      setPrdGenerating(null)
    }
  }

  function updatePrdDocument(next: PRDDocument, sectionId: PRDSectionId) {
    setPrdDocument(next)
    setPrdDirty(true)
    setPrdEditedSections(current => ({ ...current, [sectionId]: true }))
    setPrdStatus('Draft changed locally. Save when you are ready.')
  }

  function savePrd() {
    if (!prdDocument) return
    let currentDocument: PRDDocument
    try {
      currentDocument = normalizePrdDocument(prdDocument)
    } catch (error) {
      setPrdError(error instanceof Error ? `Cannot save this draft: ${error.message}` : 'Cannot save this draft until all fields are complete.')
      return
    }
    const now = new Date().toISOString()
    const saved: PRDDocument = {
      ...currentDocument,
      version: {
        ...currentDocument.version,
        number: prdDocument.version.number + 1,
        label: 'Saved draft',
        createdAt: now,
        changeSummary: 'Manual edits saved.',
      },
    }
    setPrdDocument(saved)
    setPrdRevisions(current => [{ document: saved, savedAt: now }, ...current].slice(0, 10))
    setPrdDirty(false)
    setPrdEditedSections({})
    setPrdSavedAt(now)
    setPrdStatus('Draft saved locally. It will be restored after refresh.')
  }

  function restorePrdRevision(revision: PRDRevision) {
    setPrdDocument(revision.document)
    setPrdDirty(false)
    setPrdEditedSections({})
    setPrdSavedAt(revision.savedAt)
    setPrdStatus(`Restored PRD version ${revision.document.version.number}.`)
  }

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
      setPrdProjectKey(`${next.project.fullName}@${next.analysis.analyzedAt}`)
      setPrdStale(Boolean(prdDocument))
      setPrdStatus(prdDocument ? 'Repository refreshed. Existing PRD preserved as a potentially stale draft.' : '')
      setPrdError('')
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
      ? artifactText(project, activeArtifact, summary, questions, prdDocument).slice(0, 8).join('\n')
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
      paragraphs: artifactText(project, activeArtifact, summary, questions, prdDocument),
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

  if (showLanding) {
    return (
      <main className="landing-page">
        <nav className="landing-nav" aria-label="Main navigation">
          <button className="landing-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="CodeAtlas home">
            <span className="landing-brand-mark" aria-hidden="true">✦</span>
            <span>CodeAtlas</span>
          </button>
          <div className="landing-nav-links">
            <button onClick={scrollToHowItWorks}>How it works</button>
            <a href="#principles">Principles</a>
          </div>
          <button className="landing-nav-cta" onClick={openWorkspace}>Open workspace <span aria-hidden="true">↗</span></button>
        </nav>

        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-kicker"><span className="kicker-line" aria-hidden="true" /> Codebase intelligence / 01</p>
            <h1 id="landing-title">Understand your codebase.<br /><em>Explain it with confidence.</em></h1>
            <p className="landing-lede">CodeAtlas turns an unfamiliar repository into a clear, evidence-backed map of how it works — so every technical conversation starts from the same source of truth.</p>
            <div className="landing-actions">
              <button className="landing-primary" onClick={openWorkspace}>Try for free <span aria-hidden="true">↗</span></button>
              <button className="landing-secondary" onClick={scrollToHowItWorks} aria-controls="how-it-works">See how <span aria-hidden="true">↓</span></button>
            </div>
            <p className="landing-note"><span aria-hidden="true">◆</span> Public GitHub repositories · Static analysis · No setup</p>
          </div>

          <div className="landing-preview" aria-label="CodeAtlas workspace preview">
            <div className="preview-topline"><span>CODEATLAS / WORKSPACE</span><span>ANALYSIS READY</span></div>
            <div className="preview-title"><span>Repository map</span><b>acme / storefront</b></div>
            <div className="preview-canvas">
              <div className="preview-grid" aria-hidden="true" />
              <div className="preview-edge edge-a" aria-hidden="true" />
              <div className="preview-edge edge-b" aria-hidden="true" />
              <div className="preview-edge edge-c" aria-hidden="true" />
              <div className="preview-node preview-node-a"><span>01</span><b>Web client</b><small>app / routes</small></div>
              <div className="preview-node preview-node-b"><span>02</span><b>API layer</b><small>server / handlers</small></div>
              <div className="preview-node preview-node-c"><span>03</span><b>Data store</b><small>lib / database</small></div>
              <div className="preview-node preview-node-d"><span>04</span><b>Auth service</b><small>middleware / auth</small></div>
              <div className="preview-cursor" aria-hidden="true">✦</div>
            </div>
            <div className="preview-footer"><span><i className="status-pip" /> 48 files inspected</span><span>Traceable evidence <b>↗</b></span></div>
          </div>
        </section>

        <section className="landing-metrics" aria-label="CodeAtlas highlights">
          <div className="metric-intro"><p className="landing-kicker">A clearer starting point</p><p>Less guessing. More signal. Built for the first day in a new codebase and every day after.</p></div>
          <div className="metric-card"><strong>01</strong><b>Map the system</b><span>See structure, technologies, and relationships in one considered view.</span></div>
          <div className="metric-card"><strong>02</strong><b>Follow the evidence</b><span>Every insight stays close to the source files that support it.</span></div>
          <div className="metric-card metric-card-dark"><strong>03</strong><b>Speak with clarity</b><span>Turn repository context into confident technical decisions.</span></div>
        </section>

        <section className="how-section" id="how-it-works" ref={howRef} aria-labelledby="how-title">
          <div className="how-heading"><p className="landing-kicker">How it works / 02</p><h2 id="how-title">From repository<br /><em>to shared understanding.</em></h2></div>
          <div className="how-steps">
            <article><span>01</span><h3>Bring a repository</h3><p>Paste a public GitHub URL. CodeAtlas reads the shape of the project without executing its code.</p></article>
            <article><span>02</span><h3>Explore the signal</h3><p>Move between an overview, execution flow, system design, product brief, and interview questions.</p></article>
            <article><span>03</span><h3>Make it legible</h3><p>Ask evidence-based questions, inspect source references, and export the artifact your team needs.</p></article>
          </div>
        </section>

        <section className="landing-principles" id="principles" aria-labelledby="principles-title">
          <div><p className="landing-kicker">Designed for trust / 03</p><h2 id="principles-title">Useful context,<br /><em>without the black box.</em></h2></div>
          <div className="principles-copy"><p>CodeAtlas makes the boundary between what the repository shows and what it suggests easy to see. Static evidence, explicit relationships, and local search keep your next explanation grounded.</p><button className="landing-text-link" onClick={openWorkspace}>Explore your workspace <span aria-hidden="true">→</span></button></div>
        </section>

        <footer className="landing-footer"><span className="landing-footer-brand"><span className="landing-brand-mark" aria-hidden="true">✦</span> CodeAtlas</span><span>Developer intelligence for the codebase in front of you.</span><button onClick={openWorkspace}>Try for free <span aria-hidden="true">↗</span></button></footer>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand brand-link" onClick={returnHome} aria-label="Back to CodeAtlas home">
          <div className="brand-mark">✦</div>
          <div><strong>CodeAtlas</strong><span>developer intelligence</span></div>
        </button>
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
      <section className={`main-area${isCanvasArtifact ? ' flowchart-mode' : ''}`}>
        <header className="topbar">
          <div className="crumb"><span>Workspace</span><b>/</b><strong>{projectName}</strong></div>
          <details className="top-actions">
            <summary className="help-button">Help</summary>
            <p>Import a public GitHub repository, then choose an artifact. Graphs use static evidence;
              inferred links are not runtime traces. Export downloads the current artifact.
              The local evidence assistant uses summaries and keyword matching, not AI.</p>
          </details>
        </header>
        <div className={`content${isCanvasArtifact ? ' canvas-artifact-content' : ''}`}>
          {!isCanvasArtifact && activeArtifact !== 'PRD' && <>
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
          </>}
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
          {activeArtifact === 'PRD' && <PrdWorkspace
            project={project}
            document={prdDocument}
            revisions={prdRevisions}
            dirty={prdDirty}
            editedSections={prdEditedSections}
            generating={prdGenerating}
            status={prdStatus}
            error={prdError}
            savedAt={prdSavedAt}
            stale={prdStale}
            onGenerate={generatePrd}
            onDocumentChange={updatePrdDocument}
            onSave={savePrd}
            onRestore={restorePrdRevision}
          />}
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
