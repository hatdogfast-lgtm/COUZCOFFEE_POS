import process from 'node:process'
import path from 'node:path'

/**
 * All configuration comes from the environment. Nothing secret is ever
 * hard-coded, and the server refuses to start in production without a real
 * signing secret rather than silently using a guessable default.
 */

const isProduction = process.env.NODE_ENV === 'production'

function required(name: string, fallback: string): string {
  const value = process.env[name]
  if (value && value.length > 0) return value
  if (isProduction) {
    throw new Error(`${name} must be set. Refusing to start with a default in production.`)
  }
  return fallback
}

export const config = {
  port: Number(process.env.POS_SERVER_PORT ?? 4000),
  host: process.env.POS_SERVER_HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.POS_DATA_DIR ?? './data'),
  jwtSecret: required('POS_JWT_SECRET', 'development-only-secret-do-not-ship'),
  /** Comma-separated list, or "*" to reflect the requesting origin. */
  allowOrigin: process.env.POS_ALLOW_ORIGIN ?? '*',
  tokenTtlMs: Number(process.env.POS_TOKEN_TTL_MS ?? 30 * 24 * 60 * 60 * 1000),
  maxPushBatch: Number(process.env.POS_MAX_PUSH_BATCH ?? 500),
  maxPullBatch: Number(process.env.POS_MAX_PULL_BATCH ?? 1000),
  isProduction,
} as const

export const databaseFile = path.join(config.dataDir, 'pos.db')
