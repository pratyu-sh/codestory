import {
  fetchRepositoryFileText,
  fetchRepositoryMetadata,
  fetchRepositoryTree,
  GitHubApiError,
  parseGitHubRepositoryUrl,
  type FetchLike,
  type GitHubRepositoryResponse,
  type GitHubTreeEntry,
} from './github'
import {
  basename,
  classifyFileRole,
  getLanguageForPath,
  isIgnoredDependencyOrGeneratedPath,
  isManifestPath,
  isSecretLikePath,
  isTextLikePath,
  normalizePath,
  pathPriority,
} from './rules'
import type {
  AnalysisLimits,
  Evidence,
  EvidenceConfidence,
  EvidenceKind,
  FileRole,
  FlowModel,
  FlowStep,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeType,
  InterviewSeed,
  ProjectFile,
  ProjectModel,
  SystemDesignLayer,
  Technology,
  TechnologyCategory,
} from './types'

export const ANALYSIS_LIMITS: AnalysisLimits = {
  maxFiles: 300,
  maxContentFiles: 48,
  maxSnippetCharacters: 1_800,
  maxEvidence: 320,
  maxGraphNodes: 120,
  maxGraphEdges: 220,
}

const MAX_TREE_ENTRIES = 5_000
const MAX_FILE_BYTES = 100_000
const MAX_STORED_CONTENT_CHARACTERS = 100_000

interface InternalFile {
  path: string
  size: number
  sha: string
  url: string
  language: string | null
  role: FileRole
  evidenceIds: string[]
  treeEntry: GitHubTreeEntry
}

interface EvidenceInput {
  kind: EvidenceKind
  path?: string
  quote?: string
  description: string
  confidence: EvidenceConfidence
}

interface TechnologyRule {
  name: string
  category: TechnologyCategory
  dependencies?: string[]
  path?: RegExp
  snippet?: RegExp
}

export interface AnalysisOptions {
  fetchImpl?: FetchLike
  limits?: Partial<AnalysisLimits>
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function capText(value: string, max: number): string {
  const compact = value.replace(/\u0000/g, '').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function sanitiseEvidenceQuote(value: string): string {
  return capText(value, 240).replace(
    /((?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|authorization|private[_-]?key)\s*[:=]\s*)(["']?)[^\s"',;}]+/gi,
    '$1$2[redacted]',
  )
}

function confidenceForEvidence(value: EvidenceConfidence): number {
  return value === 'high' ? 0.95 : value === 'medium' ? 0.75 : 0.5
}

function lineNumber(text: string, quote?: string): number | undefined {
  if (!quote) return undefined
  const index = text.indexOf(quote)
  return index < 0 ? undefined : text.slice(0, index).split('\n').length
}

function firstMatchingLine(text: string, pattern: RegExp): string | undefined {
  const flags = pattern.flags.replace('g', '')
  const linePattern = new RegExp(pattern.source, flags)
  return text.split('\n').find(line => linePattern.test(line))
}

function createProjectInfo(repository: { owner: string; repo: string; canonicalUrl: string }, metadata: GitHubRepositoryResponse) {
  return {
    name: safeString(metadata.name, repository.repo),
    owner: repository.owner,
    fullName: safeString(metadata.full_name, `${repository.owner}/${repository.repo}`),
    url: safeString(metadata.html_url, repository.canonicalUrl),
    apiUrl: safeString(metadata.url, `https://api.github.com/repos/${repository.owner}/${repository.repo}`),
    defaultBranch: safeString(metadata.default_branch),
    description: metadata.description ? capText(metadata.description, 500) : null,
    primaryLanguage: metadata.language ? capText(metadata.language, 80) : null,
    stars: finiteNumber(metadata.stargazers_count),
    forks: finiteNumber(metadata.forks_count),
    openIssues: finiteNumber(metadata.open_issues_count),
    license: metadata.license?.spdx_id && metadata.license.spdx_id !== 'NOASSERTION'
      ? metadata.license.spdx_id
      : metadata.license?.name ?? null,
    isFork: metadata.fork === true,
  }
}

function addUnique(values: string[], value: string | undefined): void {
  if (value && !values.includes(value)) values.push(value)
}

function roleToNodeType(role: FileRole): GraphNodeType | null {
  switch (role) {
    case 'route': return 'entrypoint'
    case 'service': return 'service'
    case 'data-model': return 'data-model'
    case 'component': return 'component'
    case 'config':
    case 'manifest': return 'config'
    case 'source': return 'source'
    default: return null
  }
}

function roleToFlowKind(role: FileRole): FlowStep['kind'] | null {
  switch (role) {
    case 'route': return 'entrypoint'
    case 'service': return 'service'
    case 'data-model': return 'data-model'
    case 'component': return 'component'
    case 'source': return 'source'
    default: return null
  }
}

function makeEdgeId(from: string, to: string, type: GraphEdgeType): string {
  return `edge:${type}:${from}->${to}`
}

function normaliseRelativePath(sourcePath: string, importPath: string): string {
  const sourceParts = normalizePath(sourcePath).split('/')
  sourceParts.pop()
  const parts = [...sourceParts, ...importPath.split('/')]
  const result: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') result.pop()
    else result.push(part)
  }
  return result.join('/')
}

function resolveImportedFile(sourcePath: string, importPath: string, files: Map<string, InternalFile>): InternalFile | undefined {
  if (!importPath.startsWith('.')) return undefined
  const base = normaliseRelativePath(sourcePath, importPath)
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.json']
  for (const extension of extensions) {
    const exact = files.get(`${base}${extension}`)
    if (exact) return exact
  }
  for (const extension of extensions.slice(1)) {
    const indexFile = files.get(`${base}/index${extension}`)
    if (indexFile) return indexFile
  }
  return undefined
}

function importReferences(text: string): Array<{ value: string; line: string }> {
  const references: Array<{ value: string; line: string }> = []
  const pattern = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(|\bexport\s+[^;\n]*?\sfrom\s*)['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const value = match[1]
    const start = match.index ?? 0
    const lineStart = text.lastIndexOf('\n', start) + 1
    const lineEnd = text.indexOf('\n', start)
    references.push({ value, line: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim() })
    if (references.length >= 80) break
  }
  return references
}

function createInterviewSeeds(
  files: InternalFile[],
  technologies: Technology[],
  evidence: Evidence[],
): InterviewSeed[] {
  const seeds: InterviewSeed[] = []
  const add = (seed: InterviewSeed) => {
    if (seeds.length < 8) seeds.push(seed)
  }
  const evidenceForPath = (path: string | undefined): string[] => {
    if (!path) return []
    return files.find(file => file.path === path)?.evidenceIds.slice(0, 3) ?? []
  }

  const route = files.find(file => file.role === 'route')
  if (route) {
    add({
      id: 'interview-route',
      category: 'backend',
      question: `How would you validate, secure, and make ${route.path} resilient to retries?`,
      whyItMatters: 'An API entrypoint is the boundary where untrusted input becomes application work.',
      expectedSignals: ['input validation', 'authentication or authorization', 'idempotency', 'error handling'],
      evidenceIds: evidenceForPath(route.path),
    })
  }

  const service = files.find(file => file.role === 'service')
  if (service) {
    add({
      id: 'interview-service',
      category: 'architecture',
      question: `What responsibility should remain in ${service.path}, and what should be delegated to callers or adapters?`,
      whyItMatters: 'Service boundaries reveal how the repository separates transport concerns from domain behavior.',
      expectedSignals: ['single responsibility', 'dependency boundaries', 'testability', 'failure propagation'],
      evidenceIds: evidenceForPath(service.path),
    })
  }

  const model = files.find(file => file.role === 'data-model')
  if (model) {
    add({
      id: 'interview-data',
      category: 'data',
      question: `How would you evolve the data represented by ${model.path} without breaking existing clients?`,
      whyItMatters: 'Data models and migrations define the persistence contract of the application.',
      expectedSignals: ['backward-compatible migrations', 'constraints and indexes', 'rollout strategy', 'transaction boundaries'],
      evidenceIds: evidenceForPath(model.path),
    })
  }

  const framework = technologies.find(technology => technology.category === 'framework')
  if (framework) {
    add({
      id: 'interview-framework',
      category: 'architecture',
      question: `What trade-offs does ${framework.name} introduce for this repository's request and rendering model?`,
      whyItMatters: 'The dominant framework shapes routing, deployment, observability, and team conventions.',
      expectedSignals: ['runtime boundaries', 'caching or rendering', 'deployment implications', 'operational trade-offs'],
      evidenceIds: framework.evidenceIds.slice(0, 3),
    })
  }

  const language = technologies.find(technology => technology.category === 'language')
  if (language) {
    add({
      id: 'interview-language',
      category: 'backend',
      question: `Which ${language.name} conventions would you enforce when adding a new feature here?`,
      whyItMatters: 'Language conventions affect correctness, maintainability, and the cost of onboarding.',
      expectedSignals: ['typing or contracts', 'error handling', 'module boundaries', 'testing conventions'],
      evidenceIds: language.evidenceIds.slice(0, 3),
    })
  }

  if (seeds.length === 0) {
    const fallbackEvidence = evidence.slice(0, 2).map(item => item.id)
    add({
      id: 'interview-repository',
      category: 'operations',
      question: 'What additional evidence would you collect before making a production architecture decision about this repository?',
      whyItMatters: 'A path-only or empty analysis should be treated as a starting point rather than a complete architecture review.',
      expectedSignals: ['runtime telemetry', 'deployment configuration', 'test coverage', 'dependency and security review'],
      evidenceIds: fallbackEvidence,
    })
  }

  return seeds
}

const TECHNOLOGY_RULES: TechnologyRule[] = [
  { name: 'Node.js', category: 'runtime', dependencies: ['node'], path: /(^|\/)package\.json$/i, snippet: /process\.env|require\s*\(/i },
  { name: 'Next.js', category: 'framework', dependencies: ['next'], path: /(^|\/)(?:next\.config\.[^/]+|app\/layout\.[^/]+|pages\/api\/)/i },
  { name: 'React', category: 'framework', dependencies: ['react', 'react-dom'], path: /\.(?:tsx|jsx)$/i, snippet: /from\s+['"]react['"]|useState\s*\(/i },
  { name: 'Vue', category: 'framework', dependencies: ['vue', '@vue/cli'], path: /\.vue$/i, snippet: /createApp\s*\(/i },
  { name: 'Angular', category: 'framework', dependencies: ['@angular/core'], path: /(^|\/)angular\.json$/i, snippet: /@Component\s*\(/i },
  { name: 'Svelte', category: 'framework', dependencies: ['svelte'], path: /\.svelte$/i, snippet: /<script\s+context=['"]module/i },
  { name: 'Express', category: 'framework', dependencies: ['express'], snippet: /from\s+['"]express['"]|require\s*\(\s*['"]express['"]/i },
  { name: 'Fastify', category: 'framework', dependencies: ['fastify'], snippet: /from\s+['"]fastify['"]|require\s*\(\s*['"]fastify['"]/i },
  { name: 'NestJS', category: 'framework', dependencies: ['@nestjs/core'], path: /(^|\/)nest-cli\.json$/i, snippet: /@(?:Controller|Injectable)\s*\(/i },
  { name: 'Django', category: 'framework', dependencies: ['django'], path: /(^|\/)(?:manage\.py|settings\.py)$/i, snippet: /django\.urls|django\.db/i },
  { name: 'Flask', category: 'framework', dependencies: ['flask'], snippet: /from\s+flask\s+import|Flask\s*\(/i },
  { name: 'FastAPI', category: 'framework', dependencies: ['fastapi'], snippet: /from\s+fastapi\s+import|FastAPI\s*\(/i },
  { name: 'Ruby on Rails', category: 'framework', dependencies: ['rails'], path: /(^|\/)(?:config\/routes\.rb|bin\/rails)$/i, snippet: /Rails\.application/i },
  { name: 'Spring Boot', category: 'framework', dependencies: ['spring-boot'], snippet: /@(?:RestController|SpringBootApplication)\b/i },
  { name: 'ASP.NET', category: 'framework', dependencies: ['microsoft.aspnetcore.app'], path: /\.csproj$/i, snippet: /Map(?:Get|Post|Put|Delete)\s*\(/i },
  { name: 'Prisma', category: 'orm', dependencies: ['prisma', '@prisma/client'], path: /\.prisma$/i, snippet: /PrismaClient\b/i },
  { name: 'Drizzle', category: 'orm', dependencies: ['drizzle-orm'], path: /drizzle\.config\.[^/]+$/i, snippet: /drizzle\(/i },
  { name: 'TypeORM', category: 'orm', dependencies: ['typeorm'], snippet: /(?:TypeOrmModule|@Entity\b|createConnection\b)/i },
  { name: 'Sequelize', category: 'orm', dependencies: ['sequelize'], snippet: /Sequelize\s*\(/i },
  { name: 'Mongoose', category: 'orm', dependencies: ['mongoose'], snippet: /mongoose\.model|Schema\s*\(/i },
  { name: 'SQLAlchemy', category: 'orm', dependencies: ['sqlalchemy'], snippet: /from\s+sqlalchemy|declarative_base\s*\(/i },
  { name: 'PostgreSQL', category: 'database', dependencies: ['pg', 'postgres', 'psycopg2', 'psycopg'], snippet: /postgres(?:ql)?|\bpg_\w+/i },
  { name: 'MySQL', category: 'database', dependencies: ['mysql', 'mysql2'], snippet: /mysql/i },
  { name: 'MongoDB', category: 'database', dependencies: ['mongodb'], snippet: /mongodb|MongoClient/i },
  { name: 'Redis', category: 'database', dependencies: ['redis', 'ioredis'], snippet: /(?:redis|ioredis)/i },
  { name: 'Tailwind CSS', category: 'build', dependencies: ['tailwindcss'], path: /(^|\/)tailwind\.config\.[^/]+$/i, snippet: /@tailwind\s+(?:base|components|utilities)/i },
  { name: 'Vite', category: 'build', dependencies: ['vite'], path: /(^|\/)vite\.config\.[^/]+$/i, snippet: /import\.meta\.env/i },
  { name: 'Webpack', category: 'build', dependencies: ['webpack'], path: /(^|\/)webpack\.config\.[^/]+$/i, snippet: /module\.exports\s*=/i },
  { name: 'Docker', category: 'infrastructure', path: /(^|\/)(?:dockerfile|docker-compose\.(?:yml|yaml))$/i },
  { name: 'GitHub Actions', category: 'infrastructure', path: /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i },
  { name: 'Jest', category: 'testing', dependencies: ['jest'], path: /(^|\/)jest\.config\.[^/]+$/i, snippet: /\bdescribe\s*\(|\bit\s*\(/i },
  { name: 'Vitest', category: 'testing', dependencies: ['vitest'], snippet: /from\s+['"]vitest['"]/i },
  { name: 'Playwright', category: 'testing', dependencies: ['@playwright/test'], path: /playwright\.config\.[^/]+$/i, snippet: /from\s+['"]@playwright\/test['"]/i },
  { name: 'Cypress', category: 'testing', dependencies: ['cypress'], path: /(^|\/)cypress\.(?:config\.)?[^/]+$/i, snippet: /cy\.visit\s*\(/i },
  { name: 'Stripe', category: 'service', dependencies: ['stripe'], snippet: /stripe|Stripe\s*\(/i },
  { name: 'AWS', category: 'service', dependencies: ['aws-sdk', '@aws-sdk/client-s3'], snippet: /@aws-sdk|aws-sdk/i },
]

export async function analyzeRepository(input: string, options: AnalysisOptions = {}): Promise<ProjectModel> {
  const repository = parseGitHubRepositoryUrl(input)
  const fetchImpl = options.fetchImpl ?? fetch
  const limits: AnalysisLimits = { ...ANALYSIS_LIMITS, ...options.limits }
  const warnings: string[] = []
  const addWarning = (warning: string) => {
    if (!warnings.includes(warning)) warnings.push(warning)
  }
  const metadata = await fetchRepositoryMetadata(repository, fetchImpl)
  const project = createProjectInfo(repository, metadata)

  let treeEntries: GitHubTreeEntry[] = []
  let treeWasTruncated = false
  if (!project.defaultBranch) {
    addWarning('The repository has no default branch and appears to be empty.')
  } else {
    try {
      const tree = await fetchRepositoryTree(repository, project.defaultBranch, fetchImpl)
      treeEntries = Array.isArray(tree.tree) ? tree.tree : []
      treeWasTruncated = tree.truncated === true
      if (treeWasTruncated) addWarning('GitHub returned a truncated repository tree; only the available paths were analyzed.')
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 409) {
        addWarning('The repository has no readable Git tree and appears to be empty.')
      } else {
        throw error
      }
    }
  }

  const rawFileEntries = treeEntries.filter(entry => entry && entry.type === 'blob' && typeof entry.path === 'string')
  if (rawFileEntries.length > MAX_TREE_ENTRIES) {
    treeWasTruncated = true
    addWarning(`The repository contains more than ${MAX_TREE_ENTRIES.toLocaleString()} tree entries; analysis is limited to a representative subset.`)
  }

  let skippedFileCount = Math.max(0, rawFileEntries.length - Math.min(rawFileEntries.length, MAX_TREE_ENTRIES))
  const candidates: InternalFile[] = []
  for (const entry of rawFileEntries.slice(0, MAX_TREE_ENTRIES)) {
    const path = normalizePath(entry.path)
    const size = finiteNumber(entry.size)
    if (isSecretLikePath(path) || isIgnoredDependencyOrGeneratedPath(path) || !isTextLikePath(path)) {
      skippedFileCount += 1
      continue
    }
    candidates.push({
      path,
      size,
      sha: safeString(entry.sha),
      url: safeString(entry.url, `${project.url}/blob/${encodeURIComponent(project.defaultBranch)}/${path}`),
      language: getLanguageForPath(path),
      role: classifyFileRole(path),
      evidenceIds: [],
      treeEntry: entry,
    })
  }

  const orderedCandidates = candidates
    .sort((a, b) => pathPriority(b.path) - pathPriority(a.path) || a.path.localeCompare(b.path))
  const selectedFiles = orderedCandidates.slice(0, limits.maxFiles)
  skippedFileCount += Math.max(0, candidates.length - selectedFiles.length)
  if (candidates.length > selectedFiles.length) {
    treeWasTruncated = true
    addWarning(`Only ${limits.maxFiles} files are included in the bounded analysis payload.`)
  }
  if (selectedFiles.length === 0) addWarning('No analyzable text files were found in the repository tree.')

  const snippets = new Map<string, string>()
  const contents = new Map<string, string>()
  let contentFetchFailed = false
  let rateLimitDuringContentFetch = false
  const contentCandidates = selectedFiles
    .filter(file => file.size <= MAX_FILE_BYTES && file.role !== 'documentation' && file.role !== 'test' && (file.role !== 'other' || pathPriority(file.path) >= 50))
    .slice(0, limits.maxContentFiles)

  for (const file of contentCandidates) {
    try {
      const text = await fetchRepositoryFileText(repository, project.defaultBranch, file.path, fetchImpl)
      if (!text) continue
      const bounded = text.slice(0, MAX_STORED_CONTENT_CHARACTERS)
      contents.set(file.path, bounded)
      snippets.set(file.path, bounded.slice(0, limits.maxSnippetCharacters))
      file.role = classifyFileRole(file.path, snippets.get(file.path))
    } catch (error) {
      contentFetchFailed = true
      if (error instanceof GitHubApiError && error.rateLimited) {
        rateLimitDuringContentFetch = true
        addWarning('GitHub rate limits prevented fetching some file snippets; path and tree evidence is still available.')
        break
      }
    }
  }

  if (contentFetchFailed && !rateLimitDuringContentFetch) {
    addWarning('Some file snippets could not be fetched; the analysis is based on partial evidence.')
  }
  if (selectedFiles.length > 0 && snippets.size === 0) addWarning('No text snippets were available; detected relationships are path-based.')

  // Refresh roles after snippets were collected, then make the file map used by
  // all later stages. The analyzer only reads text; it never interprets it.
  for (const file of selectedFiles) {
    file.role = classifyFileRole(file.path, snippets.get(file.path) ?? '')
  }
  const fileMap = new Map(selectedFiles.map(file => [file.path, file]))

  const evidence: Evidence[] = []
  const evidenceByKey = new Map<string, string>()
  const addEvidence = (inputEvidence: EvidenceInput): string | undefined => {
    const rawQuote = inputEvidence.quote
    const quote = rawQuote ? sanitiseEvidenceQuote(rawQuote) : undefined
    const key = [inputEvidence.kind, inputEvidence.path ?? '', inputEvidence.description, quote ?? ''].join('|')
    const existing = evidenceByKey.get(key)
    if (existing) return existing
    if (evidence.length >= limits.maxEvidence) return undefined
    const id = `evidence-${String(evidence.length + 1).padStart(3, '0')}`
    evidence.push({
      id,
      kind: inputEvidence.kind,
      path: inputEvidence.path,
      line: inputEvidence.path && rawQuote ? lineNumber(contents.get(inputEvidence.path) ?? snippets.get(inputEvidence.path) ?? '', rawQuote) : undefined,
      quote,
      description: capText(inputEvidence.description, 240),
      confidence: inputEvidence.confidence,
    })
    evidenceByKey.set(key, id)
    return id
  }

  addEvidence({
    kind: 'metadata',
    description: `Repository metadata and default branch were read from the public GitHub REST API (${project.defaultBranch || 'no branch'}).`,
    confidence: 'high',
  })
  addEvidence({
    kind: 'tree',
    description: `The recursive default-branch tree contained ${rawFileEntries.length.toLocaleString()} file entries before filtering.`,
    confidence: 'high',
  })

  for (const file of selectedFiles) {
    if (file.role === 'other' || file.role === 'documentation' || file.role === 'test') continue
    const evidenceId = addEvidence({
      kind: snippets.has(file.path) ? 'snippet' : 'path',
      path: file.path,
      description: `Detected a ${file.role} file from its repository path${snippets.has(file.path) ? ' and text snippet' : ''}.`,
      confidence: snippets.has(file.path) ? 'high' : 'medium',
    })
    addUnique(file.evidenceIds, evidenceId)
  }

  const packageDependencies = new Map<string, { file: InternalFile; text: string }>()
  for (const file of selectedFiles.filter(item => isManifestPath(item.path))) {
    const text = contents.get(file.path) ?? snippets.get(file.path) ?? ''
    if (!text) continue
    if (basename(file.path).toLowerCase() === 'package.json') {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          const values = parsed[section]
          if (!values || typeof values !== 'object') continue
          for (const name of Object.keys(values as Record<string, unknown>)) {
            packageDependencies.set(name.toLowerCase(), { file, text })
          }
        }
      } catch {
        addWarning('A package manifest could not be parsed completely; text and path heuristics were retained.')
      }
    }
    for (const rule of TECHNOLOGY_RULES) {
      for (const dependency of rule.dependencies ?? []) {
        if (new RegExp(`(?:^|["'\\s])${dependency.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:["'\\s:]|$)`, 'i').test(text)) {
          packageDependencies.set(dependency.toLowerCase(), { file, text })
        }
      }
    }
  }

  const technologiesByName = new Map<string, Technology>()
  const addTechnology = (
    name: string,
    category: TechnologyCategory,
    inputEvidence: EvidenceInput,
  ): void => {
    const evidenceId = addEvidence(inputEvidence)
    if (!evidenceId) return
    const key = name.toLowerCase()
    const existing = technologiesByName.get(key)
    if (existing) {
      addUnique(existing.evidenceIds, evidenceId)
      existing.confidence = Math.max(existing.confidence, confidenceForEvidence(inputEvidence.confidence))
      return
    }
    technologiesByName.set(key, {
      name,
      category,
      confidence: confidenceForEvidence(inputEvidence.confidence),
      evidenceIds: [evidenceId],
    })
  }

  const languageFiles = new Map<string, InternalFile[]>()
  for (const file of selectedFiles) {
    if (!file.language || file.role === 'documentation' || file.role === 'test') continue
    const list = languageFiles.get(file.language) ?? []
    list.push(file)
    languageFiles.set(file.language, list)
  }
  for (const [language, files] of Array.from(languageFiles.entries()).sort((a, b) => b[1].length - a[1].length)) {
    const source = files[0]
    addTechnology(language, 'language', {
      kind: 'path',
      path: source.path,
      description: `${language} is used by ${files.length} analyzed file${files.length === 1 ? '' : 's'}.`,
      confidence: 'high',
    })
  }

  const findPathEvidence = (pattern: RegExp): { file: InternalFile; quote?: string } | undefined => {
    const file = selectedFiles.find(candidate => pattern.test(candidate.path))
    return file ? { file } : undefined
  }
  const findSnippetEvidence = (pattern: RegExp): { file: InternalFile; quote: string } | undefined => {
    for (const candidate of selectedFiles) {
      const text = snippets.get(candidate.path)
      if (!text) continue
      const quote = firstMatchingLine(text, pattern)
      if (quote) return { file: candidate, quote }
    }
    return undefined
  }

  for (const rule of TECHNOLOGY_RULES) {
    let match: { file: InternalFile; quote?: string; confidence: EvidenceConfidence; kind: EvidenceKind } | undefined
    const dependencyMatch = (rule.dependencies ?? [])
      .map(dependency => packageDependencies.get(dependency.toLowerCase()))
      .find(Boolean)
    if (dependencyMatch) {
      const dependency = (rule.dependencies ?? []).find(name => packageDependencies.has(name.toLowerCase())) ?? rule.name
      match = {
        file: dependencyMatch.file,
        quote: firstMatchingLine(dependencyMatch.text, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) ?? `${dependency} dependency`,
        confidence: 'high',
        kind: 'manifest',
      }
    } else if (rule.path) {
      const pathMatch = findPathEvidence(rule.path)
      if (pathMatch) match = { file: pathMatch.file, confidence: 'high', kind: 'path' }
    }
    if (!match && rule.snippet) {
      const snippetMatch = findSnippetEvidence(rule.snippet)
      if (snippetMatch) match = { file: snippetMatch.file, quote: snippetMatch.quote, confidence: 'medium', kind: 'snippet' }
    }
    if (match) {
      addTechnology(rule.name, rule.category, {
        kind: match.kind,
        path: match.file.path,
        quote: match.quote,
        description: `${rule.name} was detected from ${match.kind === 'manifest' ? 'a dependency manifest' : match.kind === 'path' ? 'a repository path' : 'a source snippet'}.`,
        confidence: match.confidence,
      })
    }
  }

  const technologies = Array.from(technologiesByName.values())
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .slice(0, 60)

  // Build a bounded graph from files with meaningful roles and detected
  // technologies. Every node and edge carries the evidence that supports it.
  const graphNodes: GraphNode[] = []
  const graphEdges: GraphEdge[] = []
  const graphNodeByPath = new Map<string, GraphNode>()
  const graphNodeById = new Map<string, GraphNode>()
  const graphEdgeKeys = new Set<string>()
  const graphFiles = selectedFiles
    .filter(file => roleToNodeType(file.role) !== null)
    .sort((a, b) => pathPriority(b.path) - pathPriority(a.path) || a.path.localeCompare(b.path))
  const maxFileNodes = Math.max(0, limits.maxGraphNodes - technologies.length)
  for (const file of graphFiles.slice(0, maxFileNodes)) {
    const type = roleToNodeType(file.role)
    if (!type) continue
    const node: GraphNode = {
      id: `file:${file.path}`,
      label: basename(file.path),
      type,
      path: file.path,
      metadata: { language: file.language ?? 'unknown', size: file.size },
      evidenceIds: file.evidenceIds.slice(0, 6),
    }
    graphNodes.push(node)
    graphNodeByPath.set(file.path, node)
    graphNodeById.set(node.id, node)
  }
  for (const technology of technologies.slice(0, Math.max(0, limits.maxGraphNodes - graphNodes.length))) {
    const node: GraphNode = {
      id: `technology:${technology.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: technology.name,
      type: 'technology',
      metadata: { category: technology.category, confidence: technology.confidence },
      evidenceIds: technology.evidenceIds.slice(0, 6),
    }
    graphNodes.push(node)
    graphNodeById.set(node.id, node)
  }

  const addGraphEdge = (from: string, to: string, type: GraphEdgeType, verified: boolean, edgeEvidenceIds: string[]) => {
    if (!graphNodeById.has(from) || !graphNodeById.has(to) || from === to || edgeEvidenceIds.length === 0 || graphEdges.length >= limits.maxGraphEdges) return
    const key = `${from}|${to}|${type}`
    if (graphEdgeKeys.has(key)) return
    graphEdgeKeys.add(key)
    graphEdges.push({ id: makeEdgeId(from, to, type), from, to, type, verified, evidenceIds: edgeEvidenceIds.slice(0, 6) })
  }

  for (const source of selectedFiles) {
    const sourceNode = graphNodeByPath.get(source.path)
    const text = contents.get(source.path) ?? snippets.get(source.path)
    if (!sourceNode || !text) continue
    for (const reference of importReferences(text)) {
      const target = resolveImportedFile(source.path, reference.value, fileMap)
      if (!target) continue
      const targetNode = graphNodeByPath.get(target.path)
      if (!targetNode) continue
      const evidenceId = addEvidence({
        kind: 'import',
        path: source.path,
        quote: reference.line,
        description: `${source.path} imports ${target.path}.`,
        confidence: 'high',
      })
      addGraphEdge(sourceNode.id, targetNode.id, 'imports', true, evidenceId ? [evidenceId] : [])
    }
  }

  const routeFiles = selectedFiles.filter(file => file.role === 'route' && graphNodeByPath.has(file.path))
  const serviceFiles = selectedFiles.filter(file => file.role === 'service' && graphNodeByPath.has(file.path))
  const modelFiles = selectedFiles.filter(file => file.role === 'data-model' && graphNodeByPath.has(file.path))
  const hasEdge = (from: string, to: string) => graphEdges.some(edge => edge.from === from && edge.to === to)
  for (const route of routeFiles.slice(0, 12)) {
    const routeNode = graphNodeByPath.get(route.path)
    if (!routeNode) continue
    for (const service of serviceFiles.slice(0, 2)) {
      const serviceNode = graphNodeByPath.get(service.path)
      if (!serviceNode || hasEdge(routeNode.id, serviceNode.id)) continue
      const evidenceId = addEvidence({
        kind: 'inference',
        path: route.path,
        description: `The route and service roles suggest a request hand-off from ${route.path} to ${service.path}; no repository code was executed.`,
        confidence: 'low',
      })
      addGraphEdge(routeNode.id, serviceNode.id, 'inferred-flow', false, evidenceId ? [evidenceId] : [])
    }
  }
  for (const service of serviceFiles.slice(0, 12)) {
    const serviceNode = graphNodeByPath.get(service.path)
    if (!serviceNode) continue
    for (const model of modelFiles.slice(0, 2)) {
      const modelNode = graphNodeByPath.get(model.path)
      if (!modelNode || hasEdge(serviceNode.id, modelNode.id)) continue
      const evidenceId = addEvidence({
        kind: 'inference',
        path: service.path,
        description: `The service and data-model roles suggest persistence through ${model.path}; this is a path-based inference.`,
        confidence: 'low',
      })
      addGraphEdge(serviceNode.id, modelNode.id, 'inferred-flow', false, evidenceId ? [evidenceId] : [])
    }
  }

  for (const technology of technologies) {
    const technologyNode = graphNodeById.get(`technology:${technology.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
    if (!technologyNode) continue
    for (const evidenceId of technology.evidenceIds.slice(0, 3)) {
      const supportingEvidence = evidence.find(item => item.id === evidenceId)
      const fileNode = supportingEvidence?.path ? graphNodeByPath.get(supportingEvidence.path) : undefined
      if (fileNode) addGraphEdge(fileNode.id, technologyNode.id, 'uses', true, [evidenceId])
    }
  }

  const graphFileNodes = graphNodes.filter(node => node.type !== 'technology')
  const flowNodeCandidates = graphFileNodes
    .filter(node => node.type === 'entrypoint' || node.type === 'service' || node.type === 'data-model' || node.type === 'component' || node.type === 'source')
    .sort((a, b) => {
      const order = (type: GraphNodeType) => type === 'entrypoint' ? 0 : type === 'service' ? 1 : type === 'data-model' ? 2 : type === 'component' ? 3 : 4
      return order(a.type) - order(b.type) || (a.path ?? '').localeCompare(b.path ?? '')
    })
    .slice(0, 20)
  const flowNodeIds = new Set(flowNodeCandidates.map(node => node.id))
  const flowSteps: FlowStep[] = flowNodeCandidates.map((node, index) => ({
    id: node.id,
    order: index + 1,
    label: node.label,
    kind: roleToFlowKind(fileMap.get(node.path ?? '')?.role ?? 'source') ?? 'source',
    path: node.path,
    evidenceIds: node.evidenceIds,
  }))
  const flowEdges = graphEdges.filter(edge => flowNodeIds.has(edge.from) && flowNodeIds.has(edge.to)).slice(0, 80)
  const flowNotes: string[] = []
  if (flowEdges.some(edge => !edge.verified)) flowNotes.push('Some flow edges are inferred from file roles and paths rather than verified runtime calls.')
  if (!routeFiles.length) flowNotes.push('No conventional route or controller entrypoint was detected in the bounded file sample.')
  if (!snippets.size) flowNotes.push('Flow is path-based because no file snippets were available.')

  const layer = (id: string, label: string, types: GraphNodeType[]): SystemDesignLayer => ({
    id,
    label,
    nodeIds: graphNodes.filter(node => types.includes(node.type)).map(node => node.id).slice(0, 80),
  })
  const layers = [
    layer('entrypoints', 'Entry points', ['entrypoint', 'component']),
    layer('services', 'Services', ['service']),
    layer('data', 'Data models', ['data-model']),
    layer('platform', 'Configuration and technologies', ['config', 'technology']),
    layer('source', 'Supporting source', ['source']),
  ].filter(item => item.nodeIds.length > 0)
  const systemNotes: string[] = ['Nodes and edges are derived from repository paths, manifests, and bounded text snippets; no code was executed.']
  if (treeWasTruncated) systemNotes.push('The repository tree exceeded the analysis limit, so this map is a representative subset.')
  if (graphEdges.some(edge => !edge.verified)) systemNotes.push('Inferred edges are explicitly marked and should be verified against implementation details.')

  const files: ProjectFile[] = selectedFiles.map(file => ({
    path: file.path,
    size: file.size,
    sha: file.sha,
    url: file.url,
    language: file.language,
    role: file.role,
    evidenceIds: file.evidenceIds.slice(0, 8),
  }))
  const technologiesWithEvidence = technologies.map(technology => ({
    ...technology,
    evidenceIds: technology.evidenceIds.slice(0, 8),
  }))
  const flow: FlowModel = { steps: flowSteps, nodes: flowSteps, edges: flowEdges, notes: flowNotes }
  const interviewSeeds = createInterviewSeeds(selectedFiles, technologiesWithEvidence, evidence)
  const status = warnings.length > 0 ? 'partial' : 'complete'

  return {
    project,
    files,
    technologies: technologiesWithEvidence,
    evidence: evidence.slice(0, limits.maxEvidence),
    flow,
    systemDesign: {
      nodes: graphNodes.slice(0, limits.maxGraphNodes),
      edges: graphEdges.slice(0, limits.maxGraphEdges),
      layers,
      notes: systemNotes,
    },
    interviewSeeds,
    analysis: {
      status,
      analyzedAt: new Date().toISOString(),
      source: 'github-rest-api',
      codeExecution: false,
      warnings: warnings.slice(0, 20),
      skippedFileCount,
      truncated: treeWasTruncated,
      limits,
    },
  }
}

export { GitHubApiError, InvalidRepositoryUrlError, parseGitHubRepositoryUrl, validatePublicGitHubUrl } from './github'
