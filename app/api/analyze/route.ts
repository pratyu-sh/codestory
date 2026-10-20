import { NextResponse } from 'next/server'
import {
  analyzeRepository,
  GitHubApiError,
  InvalidRepositoryUrlError,
} from '../../../lib/analysis/pipeline'
import type { AnalyzeErrorBody } from '../../../lib/analysis/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorResponse(
  code: AnalyzeErrorBody['error']['code'],
  message: string,
  status: number,
  retryAfterSeconds?: number,
) {
  const body: AnalyzeErrorBody = {
    error: {
      code,
      message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  }
  const headers = retryAfterSeconds === undefined
    ? undefined
    : { 'Retry-After': String(retryAfterSeconds) }
  return NextResponse.json(body, { status, headers })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('INVALID_REQUEST', 'Request body must be valid JSON.', 400)
  }

  const input = body && typeof body === 'object'
    ? (body as Record<string, unknown>).url ?? (body as Record<string, unknown>).repoUrl ?? (body as Record<string, unknown>).repositoryUrl
    : undefined
  if (typeof input !== 'string' || input.trim().length === 0) {
    return errorResponse('INVALID_REQUEST', 'Provide a public GitHub repository URL in the "url" field.', 400)
  }

  try {
    const project = await analyzeRepository(input)
    return NextResponse.json(project)
  } catch (error) {
    if (error instanceof InvalidRepositoryUrlError) {
      return errorResponse('INVALID_URL', error.message, 400)
    }
    if (error instanceof GitHubApiError) {
      if (error.rateLimited) {
        return errorResponse(
          'RATE_LIMITED',
          'GitHub API rate limit reached. Try again after the indicated delay.',
          429,
          error.retryAfterSeconds,
        )
      }
      if (error.status === 404) {
        return errorResponse('NOT_FOUND', 'Repository not found or not publicly readable without a GitHub token.', 404)
      }
      if (error.timeout) {
        return errorResponse('UPSTREAM_TIMEOUT', 'GitHub took too long to respond. Try again shortly.', 504)
      }
      return errorResponse('GITHUB_API_ERROR', 'GitHub could not provide the repository metadata or tree.', 502)
    }
    return errorResponse('ANALYSIS_FAILED', 'The repository could not be analyzed. Try again with another public repository.', 500)
  }
}
