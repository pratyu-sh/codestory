import { promises as fs } from 'node:fs'
import path from 'node:path'
import { classifyFileRole, getLanguageForPath, isIgnoredDependencyOrGeneratedPath, isSecretLikePath, isTextLikePath, normalizePath } from './rules'
import type { ProjectModel, ProjectFile, Technology, GraphNode, GraphNodeType } from './types'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', 'out', 'vendor', 'target', '.cache'])

async function walk(root: string, dir = root, files: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(root, full, files)
    else files.push(path.relative(root, full))
  }
  return files
}

export async function analyzeLocalDirectory(root = process.cwd()): Promise<ProjectModel> {
  const absolute = path.resolve(root)
  const all = await walk(absolute)
  const candidates = all.filter(file => {
    const normalized = normalizePath(file)
    return !isSecretLikePath(normalized) && !isIgnoredDependencyOrGeneratedPath(normalized) && isTextLikePath(normalized)
  }).slice(0, 300)
  const files: ProjectFile[] = []
  const languageCounts = new Map<string, number>()
  for (const relative of candidates) {
    const normalized = normalizePath(relative)
    const stat = await fs.stat(path.join(absolute, relative))
    const language = getLanguageForPath(normalized)
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1)
    files.push({ path: normalized, size: stat.size, sha: '', url: `file://${path.join(absolute, relative)}`, language, role: classifyFileRole(normalized), evidenceIds: [] })
  }
  const technologies: Technology[] = Array.from(languageCounts.entries()).sort((a, b) => b[1] - a[1]).map(([name], i) => ({ name, category: 'language', confidence: 1, evidenceIds: [`local-language-${i + 1}`] }))
  const nodes: GraphNode[] = files.filter(file => ['route', 'service', 'data-model', 'component', 'source', 'config'].includes(file.role)).slice(0, 120).map(file => ({ id: `file:${file.path}`, label: path.basename(file.path), type: (file.role === 'route' ? 'entrypoint' : file.role === 'data-model' ? 'data-model' : file.role === 'service' ? 'service' : file.role === 'component' ? 'component' : file.role === 'config' ? 'config' : 'source') as GraphNodeType, path: file.path, metadata: { language: file.language ?? 'unknown', size: file.size }, evidenceIds: [] }))
  return { project: { name: path.basename(absolute), owner: 'local', fullName: path.basename(absolute), url: `file://${absolute}`, apiUrl: '', defaultBranch: '', description: null, primaryLanguage: technologies[0]?.name ?? null, stars: 0, forks: 0, openIssues: 0, license: null, isFork: false }, files, technologies, evidence: [], flow: { steps: [], nodes: [], edges: [], notes: ['Derived from local paths; no code was executed.'] }, systemDesign: { nodes, edges: [], layers: [], notes: ['Local static analysis only; secrets, dependencies, and build outputs are excluded.'] }, interviewSeeds: [], analysis: { status: 'complete', analyzedAt: new Date().toISOString(), source: 'local-filesystem', codeExecution: false, warnings: all.length > candidates.length ? ['Some files were excluded by safety or size filters.'] : [], skippedFileCount: all.length - candidates.length, truncated: all.length > candidates.length, limits: { maxFiles: 300, maxContentFiles: 0, maxSnippetCharacters: 0, maxEvidence: 0, maxGraphNodes: 120, maxGraphEdges: 0 } } }
}
