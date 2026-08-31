import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from './config.ts'

/**
 * A small HTTP layer. The sync surface is half a dozen endpoints, so a
 * framework would add a dependency and a supply-chain risk without earning
 * anything back.
 */

export interface RequestContext {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  deviceId?: string
}

export type Handler = (ctx: RequestContext) => Promise<void> | void

const MAX_BODY_BYTES = 8 * 1024 * 1024

export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  const allowed =
    config.allowOrigin === '*'
      ? (origin ?? '*')
      : config.allowOrigin
          .split(',')
          .map((entry) => entry.trim())
          .find((entry) => entry === origin) ?? ''

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

/**
 * Errors are reported in language an operator can act on. The technical
 * detail still goes to the server log for whoever is administering it.
 */
export function sendError(res: ServerResponse, status: number, message: string, code?: string): void {
  sendJson(res, status, { error: { message, code: code ?? null } })
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'That request was too large to process.')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {} as T
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'The request body was not valid JSON.')
  }
}

export class HttpError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token.length > 0 ? token : null
}
