'use client'

import { useMemo, useState } from 'react'
import type { ProjectModel } from '../../lib/analysis/types'
import { PRD_SECTION_DEFINITIONS, type PRDDocument, type PRDRequirement, type PRDSection, type PRDSectionId } from '../../lib/prd/types'

export type PRDRevision = { document: PRDDocument; savedAt: string }

interface PrdWorkspaceProps {
  project: ProjectModel | null
  document: PRDDocument | null
  revisions: PRDRevision[]
  dirty: boolean
  editedSections: Record<string, boolean>
  generating: 'all' | PRDSectionId | null
  status: string
  error: string
  savedAt: string
  stale: boolean
  onGenerate: (sectionId?: PRDSectionId, userContext?: string) => Promise<boolean>
  onDocumentChange: (document: PRDDocument, sectionId: PRDSectionId) => void
  onSave: () => void
  onRestore: (revision: PRDRevision) => void
}

function sectionFor(document: PRDDocument | null, id: PRDSectionId): PRDSection | null {
  return document?.sections.find(section => section.id === id) ?? null
}

function replaceSection(document: PRDDocument, id: PRDSectionId, update: (section: PRDSection) => PRDSection): PRDDocument {
  return { ...document, sections: document.sections.map(section => section.id === id ? update(section) : section) }
}

function requirementStatusLabel(status: PRDRequirement['status']): string {
  return status.replace('-', ' ')
}

function formatSavedAt(value: string): string {
  if (!value) return 'Not saved yet'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString()
}

export function PrdWorkspace({
  project,
  document,
  revisions,
  dirty,
  editedSections,
  generating,
  status,
  error,
  savedAt,
  stale,
  onGenerate,
  onDocumentChange,
  onSave,
  onRestore,
}: PrdWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<PRDSectionId>('document-overview')
  const [userContext, setUserContext] = useState('')
  const active = sectionFor(document, activeSection)
  const activeDefinition = useMemo(() => PRD_SECTION_DEFINITIONS.find(item => item.id === activeSection), [activeSection])
  const isGeneratingActive = generating === activeSection || generating === 'all'

  function changeSection(update: (section: PRDSection) => PRDSection) {
    if (!document) return
    onDocumentChange(replaceSection(document, activeSection, update), activeSection)
  }

  function updateRequirement(requirementIndex: number, update: (requirement: PRDRequirement) => PRDRequirement) {
    changeSection(section => ({
      ...section,
      requirements: section.requirements.map((requirement, index) => index === requirementIndex ? update(requirement) : requirement),
    }))
  }

  function runGenerate(sectionId?: PRDSectionId) {
    const replacingEditedContent = dirty && (!sectionId || editedSections[sectionId])
    if (replacingEditedContent && !window.confirm('This regeneration may replace manual edits. Continue?')) return
    void onGenerate(sectionId, userContext)
  }

  function copySection() {
    if (!active) return
    const text = [
      `## ${active.title}`,
      active.summary,
      ...active.content,
      ...active.requirements.map(requirement => `- ${requirement.id}: ${requirement.text} (${requirement.status})`),
    ].join('\n\n')
    void navigator.clipboard?.writeText(text)
  }

  if (!project) {
    return <section className="artifact-panel prd-empty"><div className="prd-empty-mark">✦</div><p className="doc-kicker">AI-GENERATED PRODUCT REQUIREMENTS</p><h3>Connect a repository first</h3><p>CodeStory will ground the PRD in the repository evidence map. It will never execute source code or turn a dependency into a claimed feature.</p></section>
  }

  return <section className="prd-workspace" aria-label="PRD workspace">
    <header className="prd-header">
      <div>
        <p className="doc-kicker">AI PRODUCT REQUIREMENTS · {document?.version.label || 'NOT GENERATED'}</p>
        <h3>{document?.title || `${project.project.name} product requirements`}</h3>
        <p className="prd-subtitle">{project.project.fullName} · {project.analysis.status} static evidence · {project.files.length} files inspected</p>
      </div>
      <div className="prd-header-actions">
        {document && <label className="prd-document-status">Document status <select value={document.status} onChange={event => onDocumentChange({ ...document, status: event.target.value as PRDDocument['status'] }, activeSection)}>{['draft', 'in-review', 'approved'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
        <span className={`prd-save-state${dirty ? ' is-dirty' : ''}`}>{dirty ? 'Unsaved edits' : `Saved ${formatSavedAt(savedAt)}`}</span>
        <button className="ghost-button" disabled={!document || !dirty} onClick={onSave}>Save draft</button>
        <button className="primary-button prd-generate-button" disabled={generating !== null} onClick={() => runGenerate()}>{generating === 'all' ? 'Generating…' : document ? 'Regenerate document' : 'Generate with Gemini'}</button>
      </div>
    </header>

    {stale && <div className="prd-warning" role="status"><b>Repository analysis changed.</b> This document may be stale. Generate a new document to refresh its evidence map; existing text is preserved until you choose to replace it.</div>}
    {status && <div className="analysis-feedback success-message" role="status">{status}</div>}
    {error && <div className="analysis-feedback error-message" role="alert">{error}</div>}

    <details className="prd-context">
      <summary>Product-owner context <span>Optional notes supplied to Gemini</span></summary>
      <textarea value={userContext} onChange={event => setUserContext(event.target.value)} maxLength={4000} rows={3} placeholder="Add known users, product intent, exclusions, or terminology. These notes are treated as untrusted context and are labeled separately from repository evidence." />
    </details>

    <div className="prd-layout">
      <aside className="prd-navigation" aria-label="PRD sections">
        <div className="prd-nav-heading"><span>DOCUMENT MAP</span><b>{document ? `${document.sections.length} sections` : 'Ready to generate'}</b></div>
        {PRD_SECTION_DEFINITIONS.map((definition, index) => {
          const section = sectionFor(document, definition.id)
          return <button key={definition.id} className={`prd-nav-item${activeSection === definition.id ? ' active' : ''}`} disabled={!document} onClick={() => setActiveSection(definition.id)}>
            <span>{String(index + 1).padStart(2, '0')}</span><b>{definition.title}</b><i className={section?.status || 'unknown'}>{section ? section.status : '—'}</i>
          </button>
        })}
        {revisions.length > 0 && <details className="prd-versions"><summary>Version history ({revisions.length})</summary>{revisions.map((revision, index) => <button key={`${revision.savedAt}-${index}`} onClick={() => onRestore(revision)}><b>v{revision.document.version.number}</b><span>{formatSavedAt(revision.savedAt)}</span></button>)}</details>}
      </aside>

      <main className="prd-document-area">
        {!document ? <div className="prd-generate-empty"><div className="prd-empty-mark">✦</div><p className="doc-kicker">25 EVIDENCE-AWARE SECTIONS</p><h4>Generate the first grounded draft.</h4><p>Gemini will synthesize a structured PRD from the bounded repository evidence map. Unsupported capabilities become unknowns, proposals, or open questions instead of invented facts.</p><button className="primary-button" disabled={generating !== null} onClick={() => runGenerate()}>{generating === 'all' ? 'Preparing evidence and generating…' : 'Generate PRD with Gemini →'}</button></div> : <>
          <div className="prd-section-toolbar"><div><span className="section-index">{String(PRD_SECTION_DEFINITIONS.findIndex(item => item.id === activeSection) + 1).padStart(2, '0')}</span><span className="section-title-label">{activeDefinition?.title}</span></div><div className="prd-section-actions"><button className="ghost-button" onClick={copySection}>Copy section</button><button className="ghost-button" disabled={isGeneratingActive} onClick={() => runGenerate(activeSection)}>{isGeneratingActive ? 'Regenerating…' : 'Regenerate section'}</button></div></div>
          {active && <article className="prd-section-editor">
            <div className="prd-section-heading"><div><label htmlFor="prd-section-status">Section status</label><select id="prd-section-status" value={active.status} onChange={event => changeSection(section => ({ ...section, status: event.target.value as PRDSection['status'] }))}>{['complete', 'partial', 'uncertain', 'unknown', 'not-applicable'].map(value => <option key={value} value={value}>{value}</option>)}</select></div><span className="prd-section-evidence-count">{active.evidenceIds.length} evidence references</span></div>
            <label className="prd-field-label" htmlFor="prd-section-summary">Section summary</label>
            <textarea id="prd-section-summary" className="prd-summary-editor" value={active.summary} onChange={event => changeSection(section => ({ ...section, summary: event.target.value }))} rows={4} />
            <div className="prd-content-block"><div className="prd-block-heading"><h4>Document content</h4><button className="text-button" onClick={() => changeSection(section => ({ ...section, content: [...section.content, ''] }))}>+ Add paragraph</button></div>{active.content.length === 0 && <p className="prd-muted">No supported repository-backed content was generated for this section.</p>}{active.content.map((paragraph, index) => <div className="prd-edit-row" key={`${active.id}-paragraph-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><textarea aria-label={`Content paragraph ${index + 1}`} value={paragraph} onChange={event => changeSection(section => ({ ...section, content: section.content.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} rows={3} /></div>)}</div>
            <div className="prd-content-block"><div className="prd-block-heading"><h4>Requirements and acceptance criteria</h4></div>{active.requirements.length === 0 && <p className="prd-muted">No structured requirements are supported by the current evidence. Use the section notes and open questions instead.</p>}{active.requirements.map((requirement, index) => <article className="prd-requirement" key={requirement.id}><div className="prd-requirement-head"><span>{requirement.id}</span><select value={requirement.status} aria-label={`${requirement.id} status`} onChange={event => updateRequirement(index, item => ({ ...item, status: event.target.value as PRDRequirement['status'] }))}>{['supported', 'proposed', 'uncertain', 'unknown', 'not-applicable'].map(value => <option key={value} value={value}>{requirementStatusLabel(value as PRDRequirement['status'])}</option>)}</select><select value={requirement.priority} aria-label={`${requirement.id} priority`} onChange={event => updateRequirement(index, item => ({ ...item, priority: event.target.value as PRDRequirement['priority'] }))}>{['must', 'should', 'could', 'unknown'].map(value => <option key={value} value={value}>{value}</option>)}</select></div><textarea aria-label={`${requirement.id} text`} value={requirement.text} onChange={event => updateRequirement(index, item => ({ ...item, text: event.target.value }))} rows={2} /><div className="prd-requirement-facts"><div><b>Actor</b><span>{requirement.actor}</span></div><div><b>Trigger</b><span>{requirement.trigger}</span></div><div><b>Expected behavior</b><span>{requirement.expectedBehavior.join(' · ')}</span></div><div><b>Preconditions</b><span>{requirement.preconditions.join(' · ')}</span></div><div><b>Inputs / outputs</b><span>{requirement.inputs.join(', ') || 'None identified'} → {requirement.outputs.join(', ') || 'None identified'}</span></div><div><b>Business rules / errors</b><span>{requirement.businessRules.join(' · ') || 'None identified'} / {requirement.errorConditions.join(' · ') || 'None identified'}</span></div></div><p className="prd-rationale"><b>Why:</b> {requirement.rationale}</p><ul className="prd-acceptance">{requirement.acceptanceCriteria.map((criterion, criterionIndex) => <li key={`${requirement.id}-${criterionIndex}`}><input value={criterion} aria-label={`${requirement.id} acceptance criterion ${criterionIndex + 1}`} onChange={event => updateRequirement(index, item => ({ ...item, acceptanceCriteria: item.acceptanceCriteria.map((value, valueIndex) => valueIndex === criterionIndex ? event.target.value : value) }))} /></li>)}</ul><div className="prd-evidence-chips">{requirement.evidenceIds.map(id => <span key={id}>{id}</span>)}</div></article>)}</div>
            <details className="prd-evidence-panel"><summary>View source evidence ({active.evidenceIds.length})</summary><ul>{active.evidenceIds.map(id => { const evidence = document.evidence.find(item => item.id === id); return <li key={id}><b>{id}</b> · {evidence?.source || 'Unknown source'}{evidence?.line ? `:${evidence.line}` : ''} — {evidence?.description || 'Evidence was not returned.'}{evidence?.quote && <q>{evidence.quote}</q>}</li> })}</ul></details>
          </article>}
        </>}
      </main>
    </div>
  </section>
}

export default PrdWorkspace
