import type { PullResponse, PushResponse, SyncEnvelope } from '@pos/shared'

/**
 * HTTP transport to the sync server.
 *
 * Every call is written to fail cleanly: a timeout, a refused connection and a
 * server error all surface as the same kind of recoverable outcome, because
 * from the till's point of view they are the same thing - the server is not
 * reachable right now, and the work stays queued.
 */

export class TransportError extends Error {
  readonly status: number
  readonly code: string | null
  readonly retryable: boolean

  constructor(message: string, status: number, code: string | null, retryable: boolean) {
    super(message)
    this.name = 'TransportError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

export interface ServerConfig {
  url: string
  token: string | null
}

const REQUEST_TIMEOUT_MS = 20_000

async function request<T>(
  config: ServerConfig,
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  const headers = new Headers(rest.headers)
  headers.set('Content-Type', 'application/json')
  if (auth) {
    if (!config.token) {
      throw new TransportError('This device is not enrolled with the server yet.', 0, 'NOT_ENROLLED', false)
    }
    headers.set('Authorization', `Bearer ${config.token}`)
  }

  let response: Response
  try {
    response = await fetch(new URL(path, config.url).toString(), {
      ...rest,
      headers,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    throw new TransportError(
      aborted ? 'The server did not answer in time.' : 'The server could not be reached.',
      0,
      aborted ? 'TIMEOUT' : 'OFFLINE',
      true,
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let message = `The server refused the request (${response.status}).`
    let code: string | null = null
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } }
      if (body.error?.message) message = body.error.message
      if (body.error?.code) code = body.error.code
    } catch {
      // Non-JSON error body; the generic message stands.
    }
    // 5xx and 429 are worth retrying; a 4xx means this request will never work.
    const retryable = response.status >= 500 || response.status === 429
    throw new TransportError(message, response.status, code, retryable)
  }

  return (await response.json()) as T
}

export interface HealthResponse {
  ok: boolean
  version: string
  serverSeq: number
  serverTime: number
  realtimeConnections: number
}

export function health(config: ServerConfig): Promise<HealthResponse> {
  return request<HealthResponse>(config, '/api/health', { method: 'GET', auth: false })
}

export interface EnrolResponse {
  deviceId: string
  token: string
  label: string
  serverSeq: number
  serverTime: number
}

export function enrol(
  config: ServerConfig,
  body: { deviceId: string; label: string; type: string; code: string; appVersion: string },
): Promise<EnrolResponse> {
  return request<EnrolResponse>(config, '/api/devices/enrol', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(body),
  })
}

export function push(config: ServerConfig, deviceId: string, entries: SyncEnvelope[]): Promise<PushResponse> {
  return request<PushResponse>(config, '/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ deviceId, entries }),
  })
}

export function pull(config: ServerConfig, since: number, limit = 500): Promise<PullResponse> {
  return request<PullResponse>(config, `/api/sync/pull?since=${since}&limit=${limit}`, { method: 'GET' })
}

export interface SyncStatusResponse {
  serverSeq: number
  serverTime: number
  devices: Array<{
    deviceId: string
    label: string
    type: string
    active: boolean
    cursor: number
    lastSeenAt: number | null
    lastSyncAt: number | null
    connected: boolean
    behindBy: number
  }>
}

export function syncStatus(config: ServerConfig): Promise<SyncStatusResponse> {
  return request<SyncStatusResponse>(config, '/api/sync/status', { method: 'GET' })
}

/** Build the realtime URL, carrying the token where a browser can send it. */
export function realtimeUrl(config: ServerConfig): string | null {
  if (!config.token) return null
  const url = new URL('/realtime', config.url)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', config.token)
  return url.toString()
}
