import type { FileRole } from './types'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.swift': 'Swift',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.c': 'C',
  '.h': 'C/C++',
  '.hpp': 'C++',
  '.dart': 'Dart',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.fs': 'F#',
  '.fsx': 'F#',
  '.scala': 'Scala',
  '.lua': 'Lua',
  '.r': 'R',
  '.sql': 'SQL',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.html': 'HTML',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.json': 'JSON',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.ps1': 'PowerShell',
}

const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bmp',
  '.class',
  '.dll',
  '.dmg',
  '.eot',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.iso',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.otf',
  '.pdf',
  '.png',
  '.so',
  '.tar',
  '.tgz',
  '.ttf',
  '.wav',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
])

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '__pycache__',
  'bin',
  'build',
  'coverage',
  'dependencies',
  'deps',
  'dist',
  'generated',
  'node_modules',
  'obj',
  'out',
  'public/build',
  'target',
  'third-party',
  'third_party',
  'vendor',
])

const SECRET_FILE_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:secret|secrets|credentials?)(?:\.|\/|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519|private[_-]?key|service[_-]?account)/i,
  /\.(?:key|pem|p12|pfx|der)$/i,
  /(?:access[_-]?token|refresh[_-]?token|client[_-]?secret)/i,
]

const MANIFEST_NAMES = new Set([
  'cargo.toml',
  'composer.json',
  'composer.lock',
  'docker-compose.yml',
  'docker-compose.yaml',
  'gemfile',
  'gemfile.lock',
  'go.mod',
  'mix.exs',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'pipfile',
  'poetry.lock',
  'pom.xml',
  'pubspec.yaml',
  'pubspec.lock',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'yarn.lock',
])

const CONFIG_NAMES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.eslintrc',
  '.eslintrc.json',
  '.gitignore',
  'angular.json',
  'dockerfile',
  'jest.config.js',
  'jest.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nuxt.config.ts',
  'playwright.config.ts',
  'postcss.config.js',
  'postcss.config.mjs',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tsconfig.json',
  'vite.config.js',
  'vite.config.ts',
  'webpack.config.js',
])

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

export function getLanguageForPath(path: string): string | null {
  const normalized = normalizePath(path)
  const basename = normalized.split('/').pop()?.toLowerCase() ?? ''
  if (basename === 'dockerfile') return 'Dockerfile'
  if (basename === 'makefile') return 'Makefile'
  if (basename === 'procfile') return 'Procfile'
  if (basename === 'gemfile') return 'Ruby'
  if (basename === 'rakefile') return 'Ruby'
  if (basename === 'go.mod') return 'Go'
  if (basename === 'cargo.toml') return 'TOML'
  const dot = basename.lastIndexOf('.')
  return dot >= 0 ? LANGUAGE_BY_EXTENSION[basename.slice(dot)] ?? null : null
}

export function isSecretLikePath(path: string): boolean {
  return SECRET_FILE_PATTERNS.some(pattern => pattern.test(normalizePath(path)))
}

export function isIgnoredDependencyOrGeneratedPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase()
  const segments = normalized.split('/')
  if (segments.some(segment => IGNORED_DIRECTORY_NAMES.has(segment))) return true
  if (normalized.includes('/public/build/')) return true
  if (segments.some(segment => segment === 'generated' || segment === '__generated__')) return true
  return false
}

export function isTextLikePath(path: string): boolean {
  const normalized = normalizePath(path)
  const basename = normalized.split('/').pop()?.toLowerCase() ?? ''
  if (isSecretLikePath(normalized) || isIgnoredDependencyOrGeneratedPath(normalized)) return false
  const dot = basename.lastIndexOf('.')
  if (dot >= 0) return !BINARY_EXTENSIONS.has(basename.slice(dot))
  return ['dockerfile', 'gemfile', 'license', 'makefile', 'procfile', 'rakefile', 'readme'].includes(basename)
}

export function isManifestPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase()
  const basename = normalized.split('/').pop() ?? ''
  return MANIFEST_NAMES.has(basename)
    || /^(?:package(?:-lock)?\.json|requirements(?:[-_.].*)?\.txt|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|[^/]+\.csproj|[^/]+\.sln|podfile|build\.sbt)$/.test(basename)
    || /(^|\/)(?:build\.gradle(?:\.kts)?|[^/]+\.csproj|[^/]+\.sln)$/.test(normalized)
}

export function isConfigPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase()
  const basename = normalized.split('/').pop() ?? ''
  return CONFIG_NAMES.has(basename) || /(^|\/)(?:\.github\/workflows\/|config\/|configs\/)/.test(normalized)
}

export function classifyFileRole(path: string, snippet = ''): FileRole {
  const normalized = normalizePath(path).toLowerCase()
  const basename = normalized.split('/').pop() ?? ''
  if (isManifestPath(normalized)) return 'manifest'
  if (isConfigPath(normalized)) return 'config'
  if (/(^|\/)(?:test|tests|__tests__|spec|specs)(\/|$)/.test(normalized) || /\.(?:test|spec)\.[^.]+$/.test(basename)) return 'test'
  if (/(^|\/)(?:app\/api|pages\/api|routes?|controllers?)(\/|$)/.test(normalized) || /(?:export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|router\.(?:get|post|put|patch|delete)|app\.(?:get|post|put|patch|delete)|@(Get|Post|Put|Patch|Delete)Mapping)\b/i.test(snippet)) {
    return 'route'
  }
  if (/(^|\/)(?:services?|use-cases?|handlers?|workers?|jobs?)(\/|$)|(?:service|handler|use-case)\.[^.]+$/.test(normalized) || /class\s+\w*(?:Service|Handler)\b/i.test(snippet)) return 'service'
  if (/(?:schema|schemas|models?|entities?|migrations?)(\/|$)|(?:schema|model|entity)\.[^.]+$|\.prisma$/.test(normalized) || /(?:\bmodel\s+\w+\s*\{|@Entity\b|Sequelize\.define|mongoose\.model)\b/i.test(snippet)) return 'data-model'
  if (/(^|\/)(?:components?|pages?|screens?|views?)(\/|$)|\/app\/.*\/page\.[^.]+$|\.(?:tsx|jsx|vue|svelte)$/.test(normalized)) return 'component'
  if (/\.(?:md|mdx|rst|txt)$/.test(basename) || /(^|\/)(?:docs?|documentation)(\/|$)/.test(normalized)) return 'documentation'
  return getLanguageForPath(normalized) ? 'source' : 'other'
}

export function basename(path: string): string {
  const normalized = normalizePath(path)
  return normalized.split('/').pop() ?? normalized
}

export function pathPriority(path: string): number {
  const normalized = normalizePath(path).toLowerCase()
  if (isManifestPath(normalized)) return 100
  if (isConfigPath(normalized)) return 90
  if (/(^|\/)(?:app\/api|pages\/api|routes?|controllers?)(\/|$)/.test(normalized)) return 85
  if (/(?:schema|schemas|models?|entities?|migrations?)(\/|$)|\.prisma$/.test(normalized)) return 80
  if (/(^|\/)(?:services?|use-cases?|handlers?)(\/|$)/.test(normalized)) return 75
  if (/(^|\/)(?:components?|pages?|screens?|views?)(\/|$)/.test(normalized)) return 65
  if (/(^|\/)(?:test|tests|__tests__|spec|specs)(\/|$)/.test(normalized)) return 35
  if (/\.(?:md|mdx|rst|txt)$/.test(normalized)) return 15
  return 50
}

export function isLikelyRoutePath(path: string): boolean {
  return classifyFileRole(path) === 'route'
}
