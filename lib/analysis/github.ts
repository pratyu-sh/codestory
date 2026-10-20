const GITHUB_API_ROOT = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 8_000
const CONTENT_TIMEOUT_MS = 5_000

export interface ParsedGitHubRepository {
  owner: string
  repo: string
  canonicalUrl: string
}

export interface GitHubRepositoryResponse {
  id: number
  name: string
  full_name: string
  html_url: string
  url: string
  default_branch: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  fork: boolean
  license: { name?: string; spdx_id?: string } | null
}

export interface GitHubTreeEntry {
  path: string
  mode?: string
  type: 'blob' | 'tree' | string
  size?: number
  sha: string
  url?: string
}

export interface GitHubTreeResponse {
  sha: string
  truncated?: boolean
  tree: GitHubTreeEntry[]
}

interface GitHubContentsResponse {
  type?: string
  encoding?: string
  content?: string
  size?: number
  download_url?: string | null
}

export type FetchLike = typeof fetch

export class InvalidRepositoryUrlError extends Error {
  readonly code = 'INVALID_URL'

  constructor(message = 'Enter a public GitHub repository URL such as https://github.com/owner/repository.') {
    super(message)
    this.name = 'InvalidRepositoryUrlError'
    Object.setPrototypeOf(this, InvalidRepositoryUrlError.prototype)
  }
}

export class GitHubApiError extends Error {
  readonly status: number
  readonly rateLimited: boolean
  readonly retryAfterSeconds?: number
  readonly timeout: boolean

  constructor(
    message: string,
    options: { status?: number; rateLimited?: boolean; retryAfterSeconds?: number; timeout?: boolean } = {},
  ) {
    super(message)
    this.name = 'GitHubApiError'
    Object.setPrototypeOf(this, GitHubApiError.prototype)
    this.status = options.status ?? 502
    this.rateLimited = options.rateLimited ?? false
    this.retryAfterSeconds = options.retryAfterSeconds
    this.timeout = options.timeout ?? false
  }
}

function normaliseRepositoryName(value: string): string {
  return value.toLowerCase().endsWith('.git') ? value.slice(0, -4) : value
}

/** Return the parsed owner/repository only for a public GitHub URL shape. */
export function parseGitHubRepositoryUrl(input: string): ParsedGitHubRepository {
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > 500) {
    throw new InvalidRepositoryUrlError()
  }

  let parsed: URL
  try {
    parsed = new URL(input.trim())
  } catch {
    throw new InvalidRepositoryUrlError()
  }

  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || (parsed.port && parsed.port !== '443') || parsed.username || parsed.password) {
    throw new InvalidRepositoryUrlError()
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || parsed.search || parsed.hash) {
    throw new InvalidRepositoryUrlError()
  }

  let owner: string
  let repo: string
  try {
    owner = decodeURIComponent(segments[0])
    repo = normaliseRepositoryName(decodeURIComponent(segments[1]))
  } catch {
    throw new InvalidRepositoryUrlError()
  }

  const validName = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
  if (!validName.test(owner) || !validName.test(repo) || repo.length === 0 || repo === '.' || repo === '..') {
    throw new InvalidRepositoryUrlError()
  }

  return {
    owner,
    repo,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  }
}

export function validatePublicGitHubUrl(input: string): boolean {
  try {
    parseGitHubRepositoryUrl(input)
    return true
  } catch {
    return false
  }
}

function apiPath(path: string): string {
  return `${GITHUB_API_ROOT}${path}`
}

function getHeader(response: Response, name: string): string | null {
  try {
    return response.headers?.get(name) ?? null
  } catch {
    return null
  }
}

function parseRetryAfter(response: Response): number | undefined {
  const retryAfter = getHeader(response, 'retry-after')
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds
  }
  const resetAt = Number.parseInt(getHeader(response, 'x-ratelimit-reset') ?? '', 10)
  if (Number.isFinite(resetAt) && resetAt > 0) return Math.max(0, resetAt - Math.floor(Date.now() / 1000))
  return undefined
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: unknown }
    if (typeof payload?.message === 'string' && payload.message.length <= 240) return payload.message
  } catch {
    // Some upstream failures return an empty or non-JSON body.
  }
  return `GitHub API request failed with status ${response.status}.`
}

async function requestJson<T>(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ data: T; response: Response }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'CodeAtlas-Repository-Analyzer/1.0',
      },
      cache: 'no-store',
    })

    const failed = response.ok === false || (typeof response.status === 'number' && response.status >= 400)
    if (failed) {
      const rateLimited = response.status === 429 || (response.status === 403 && getHeader(response, 'x-ratelimit-remaining') === '0')
      throw new GitHubApiError(await readErrorMessage(response), {
        status: response.status,
        rateLimited,
        retryAfterSeconds: parseRetryAfter(response),
      })
    }

    return { data: (await response.json()) as T, response }
  } catch (error) {
    if (error instanceof GitHubApiError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubApiError('GitHub API request timed out.', { status: 504, timeout: true })
    }
    throw new GitHubApiError('Unable to reach the GitHub API.', { status: 503 })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchRepositoryMetadata(
  repository: ParsedGitHubRepository,
  fetchImpl: FetchLike = fetch,
): Promise<GitHubRepositoryResponse> {
  const { data } = await requestJson<GitHubRepositoryResponse>(
    apiPath(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`),
    fetchImpl,
  )
  return data
}

export async function fetchRepositoryTree(
  repository: ParsedGitHubRepository,
  defaultBranch: string,
  fetchImpl: FetchLike = fetch,
): Promise<GitHubTreeResponse> {
  const branch = encodeURIComponent(defaultBranch)
  const { data } = await requestJson<GitHubTreeResponse>(
    apiPath(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/git/trees/${branch}?recursive=1`),
    fetchImpl,
  )
  return data
}

function decodeBase64(value: string): string {
  return Buffer.from(value.replace(/\s/g, ''), 'base64').toString('utf8')
}

/** Fetch a single text blob through the REST contents API. No repository code is executed. */
export async function fetchRepositoryFileText(
  repository: ParsedGitHubRepository,
  defaultBranch: string,
  path: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const { data } = await requestJson<GitHubContentsResponse>(
    apiPath(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(defaultBranch)}`,
    ),
    fetchImpl,
    CONTENT_TIMEOUT_MS,
  )

  if (data.type && data.type !== 'file') return ''
  if (typeof data.content === 'string' && (data.encoding === 'base64' || !data.encoding)) {
    return data.encoding === 'base64' ? decodeBase64(data.content) : data.content
  }

  // The contents endpoint can omit content for a large blob. It is safer to
  // skip that file than to make an unbounded second request or execute it.
  return ''
}
