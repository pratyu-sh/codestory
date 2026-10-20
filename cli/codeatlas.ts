#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { analyzeLocalDirectory } from '../lib/analysis/local'
import { analyzeRepository } from '../lib/analysis/pipeline'
import { generateExport, type ArtifactPayload, type ExportFormat } from '../lib/exports'

const help = `CodeAtlas local CLI\n\nUsage: npm run cli -- [command] [options]\nCommands: prd, flow, system, questions\nOptions: --output <dir>  --repo <public GitHub URL>  --format <pdf|docx|pptx|all>  --help\nAnalyzes the current directory without executing code.`
function arg(args: string[], name: string) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
function payload(command: string, model: Awaited<ReturnType<typeof analyzeLocalDirectory>>): ArtifactPayload {
  const project = model.project.name
  const bullets = [`Files analyzed: ${model.files.length}`, `Languages: ${model.technologies.map(t => t.name).join(', ') || 'none'}`, `Static analysis only; code was not executed.`]
  if (command === 'flow') bullets.push(...model.flow.notes)
  if (command === 'system') bullets.push(...model.systemDesign.notes)
  if (command === 'questions') bullets.push(...model.interviewSeeds.map(q => q.question))
  return { projectName: project, title: command.toUpperCase(), headings: ['Summary'], paragraphs: [`CodeAtlas analysis for ${project}.`], bullets, diagramSummary: command === 'system' ? { title: 'System design', summary: 'Static file-role map', nodes: model.systemDesign.nodes.map(n => n.label), edges: [] } : undefined }
}
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) return console.log(help)
  const command = ['prd', 'flow', 'system', 'questions'].includes(args[0]) ? args[0] : undefined
  const output = path.resolve(arg(args, '--output') ?? './codeatlas-docs')
  const repo = arg(args, '--repo')
  const model = repo ? await analyzeRepository(repo) : await analyzeLocalDirectory(process.cwd())
  console.log(`CodeAtlas: ${model.project.name}\nFiles: ${model.files.length}\nLanguages: ${model.technologies.map(t => t.name).join(', ') || 'none'}\nSkipped: ${model.analysis.skippedFileCount}`)
  await fs.mkdir(output, { recursive: true })
  if (!command) { await fs.writeFile(path.join(output, 'prd.json'), JSON.stringify(model, null, 2)); await fs.writeFile(path.join(output, 'prd.md'), `# ${model.project.name}\n\n- Files: ${model.files.length}\n- Languages: ${model.technologies.map(t => t.name).join(', ') || 'none'}\n- Static analysis only: no code executed.\n`); return }
  const formats = (arg(args, '--format') ?? 'all') === 'all' ? ['pdf', 'docx', 'pptx'] : [arg(args, '--format') as ExportFormat]
  for (const format of formats) { const result = await generateExport(format as ExportFormat, payload(command, model)); await fs.writeFile(path.join(output, result.filename), result.data) }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
