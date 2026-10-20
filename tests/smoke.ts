import assert from 'node:assert/strict'
import { analyzeLocalDirectory } from '../lib/analysis/local'
import { parseGitHubRepositoryUrl } from '../lib/analysis/github'
import { generateExport } from '../lib/exports'

async function main() {
  const parsed = parseGitHubRepositoryUrl('https://github.com/example/project')
  assert.equal(parsed.owner, 'example')
  assert.equal(parsed.repo, 'project')

  const local = await analyzeLocalDirectory(process.cwd())
  assert.equal(local.analysis.codeExecution, false)
  assert.equal(local.analysis.source, 'local-filesystem')
  assert.ok(local.files.every(file => !file.path.includes('node_modules')))

  const payload = { projectName: 'smoke', title: 'overview', paragraphs: ['Evidence-backed smoke test'] }
  const pdf = await generateExport('pdf', payload)
  assert.equal(new TextDecoder().decode(pdf.data.slice(0, 5)), '%PDF-')
  const docx = await generateExport('docx', payload)
  assert.equal(new TextDecoder().decode(docx.data.slice(0, 2)), 'PK')
  const pptx = await generateExport('pptx', payload)
  assert.equal(new TextDecoder().decode(pptx.data.slice(0, 2)), 'PK')

  console.log(`Smoke checks passed: ${local.files.length} local files analyzed; PDF, DOCX, and PPTX exports generated.`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
