import assert from 'node:assert/strict'
import { generatePrd } from '../lib/prd/client'
import { normalizePrdDocument, PRDValidationError } from '../lib/prd/schema'
import { PRD_SECTION_DEFINITIONS, type PRDDocument } from '../lib/prd'
import type { ProjectModel } from '../lib/analysis/types'

const evidenceId = 'evidence:route'

function makeProject(): ProjectModel {
  return {
    project: {
      name: 'Example project',
      owner: 'example',
      fullName: 'example/project',
      url: 'https://github.com/example/project',
      apiUrl: 'https://api.github.com/repos/example/project',
      defaultBranch: 'main',
      description: 'A test project',
      primaryLanguage: 'TypeScript',
      stars: 0,
      forks: 0,
      openIssues: 0,
      license: null,
      isFork: false,
    },
    files: [],
    technologies: [],
    evidence: [{
      id: evidenceId,
      kind: 'path',
      path: 'app/api/example/route.ts',
      description: 'Example API route',
      confidence: 'high',
    }],
    flow: { steps: [], nodes: [], edges: [], notes: [] },
    systemDesign: { nodes: [], edges: [], layers: [], notes: [] },
    interviewSeeds: [],
    analysis: {
      status: 'complete',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      source: 'github-rest-api',
      codeExecution: false,
      warnings: [],
      skippedFileCount: 0,
      truncated: false,
      limits: {
        maxFiles: 10,
        maxContentFiles: 10,
        maxSnippetCharacters: 100,
        maxEvidence: 10,
        maxGraphNodes: 10,
        maxGraphEdges: 10,
      },
    },
  }
}

function makeSection(id: (typeof PRD_SECTION_DEFINITIONS)[number]['id'], summary = `Summary for ${id}`) {
  return {
    id,
    title: PRD_SECTION_DEFINITIONS.find(section => section.id === id)?.title ?? id,
    status: 'unknown' as const,
    summary,
    content: [`Content for ${id}`],
    requirements: id === 'functional-requirements' ? [
      {
        id: 'FR-001',
        text: 'The user can submit a repository for analysis.',
        actor: 'Authorized user',
        preconditions: ['The repository URL is public and valid.'],
        trigger: 'The user submits the repository URL.',
        expectedBehavior: ['The system validates and analyzes the repository.'],
        inputs: ['Repository URL'],
        outputs: ['Project analysis'],
        businessRules: ['Repository source is treated as untrusted data.'],
        errorConditions: ['The repository cannot be reached.'],
        relatedDependencies: ['GitHub REST API'],
        status: 'supported' as const,
        priority: 'must' as const,
        acceptanceCriteria: ['A valid URL returns an evidence-backed analysis.'],
        evidenceIds: [evidenceId],
        rationale: 'The repository is the source for every downstream artifact.',
      },
    ] : [],
    evidenceIds: id === 'document-overview' ? [evidenceId] : [],
    references: [],
  }
}

function makeDocument(): PRDDocument {
  return {
    schemaVersion: '1.0',
    title: 'Example PRD',
    projectName: 'Example project',
    status: 'draft',
    version: {
      number: 1,
      label: 'v1',
      createdAt: '2026-01-01T00:00:00.000Z',
      changeSummary: 'Initial document',
    },
    sections: PRD_SECTION_DEFINITIONS.map(section => makeSection(section.id)),
    evidence: [{
      id: evidenceId,
      kind: 'path',
      source: 'app/api/example/route.ts',
      description: 'Example API route',
      confidence: 'high',
    }],
    references: [],
  }
}

function assertValidationFailure(value: unknown, message: string, allowedEvidenceIds?: Set<string>) {
  assert.throws(() => normalizePrdDocument(value, allowedEvidenceIds), PRDValidationError, message)
}

async function main() {
  const valid = makeDocument()
  const normalized = normalizePrdDocument({ ...valid, title: '  Example PRD  ' })
  assert.equal(normalized.title, 'Example PRD')
   assert.equal(normalized.sections.length, PRD_SECTION_DEFINITIONS.length)
   assert.deepEqual(normalized.sections.map(section => section.id), PRD_SECTION_DEFINITIONS.map(section => section.id))
   assert.equal(normalized.sections.find(section => section.id === 'functional-requirements')?.requirements[0]?.actor, 'Authorized user')

  assertValidationFailure({ ...valid, schemaVersion: '2.0' }, 'rejects unsupported schema versions')
  assertValidationFailure({
    ...valid,
    sections: [valid.sections[1], valid.sections[0], ...valid.sections.slice(2)],
  }, 'rejects non-canonical section order')
  assertValidationFailure({
    ...valid,
    evidence: [valid.evidence[0], valid.evidence[0]],
  }, 'rejects duplicate evidence IDs')
  assertValidationFailure(valid, 'rejects evidence outside an allowed evidence map', new Set(['different-evidence']))
  normalizePrdDocument(valid, new Set([evidenceId]))

  const project = makeProject()
  const regeneratedSection = {
    ...makeSection('goals-and-non-goals', 'Regenerated goals summary'),
    title: 'Regenerated goals',
    status: 'complete' as const,
    content: ['Updated goals content'],
    evidenceIds: [evidenceId],
  }
  const requests: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ section: regeneratedSection }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const result = await generatePrd(project, {
    document: valid,
    sectionId: 'goals-and-non-goals',
    userContext: 'Focus on the product goals.',
  }, {
    apiKey: 'test-only-key',
    model: 'test-model',
    fetchImpl,
  })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent?key=test-only-key')
  assert.equal(requests[0].init.method, 'POST')
  const requestBody = JSON.parse(String(requests[0].init.body)) as { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: { responseMimeType: string } }
  assert.equal(requestBody.generationConfig.responseMimeType, 'application/json')
  assert.match(requestBody.contents[0].parts[0].text, /Regenerate only section "goals-and-non-goals"/)

  assert.equal(result.document.version.number, 2)
  assert.equal(result.document.version.changeSummary, 'Regenerated Regenerated goals.')
  assert.equal(result.document.sections.find(section => section.id === 'goals-and-non-goals')?.summary, 'Regenerated goals summary')
  assert.equal(result.document.sections.find(section => section.id === 'goals-and-non-goals')?.title, 'Regenerated goals')
   assert.equal(result.document.sections.find(section => section.id === 'document-overview')?.summary, valid.sections[0].summary)
  assert.equal(result.document.sections.length, PRD_SECTION_DEFINITIONS.length)

  console.log('PRD checks passed: document validation and mocked section regeneration.')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
