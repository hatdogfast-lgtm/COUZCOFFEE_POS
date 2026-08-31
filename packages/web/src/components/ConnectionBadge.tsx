import { CloudOff, Cloud, RefreshCw, TriangleAlert, CircleAlert, Wifi } from 'lucide-react'
import { CONNECTION_COPY, type ConnectionState } from '@pos/shared'
import { cn, relativeTime } from '../lib/utils.ts'
import { useSyncStatus } from '../app/providers.tsx'

/**
 * The connection indicator.
 *
 * It never lies and never hides a problem. "Offline" says plainly that work is
 * being kept on the device; a stuck queue says so rather than showing a
 * reassuring green tick. Anyone standing at the till can tell at a glance
 * whether their sales have left the building.
 */

const TONE_CLASSES: Record<string, string> = {
  online: 'bg-positive/12 text-positive',
  pending: 'bg-warning/12 text-warning',
  offline: 'bg-ink-subtle/15 text-ink-muted',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
}

const DOT_CLASSES: Record<string, string> = {
  online: 'bg-positive',
  pending: 'bg-warning',
  offline: 'bg-ink-subtle',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

function iconFor(state: ConnectionState) {
  switch (state) {
    case 'ONLINE':
      return Cloud
    case 'SYNCING':
      return RefreshCw
    case 'CONNECTING':
      return Wifi
    case 'SYNC_ERROR':
      return TriangleAlert
    case 'CONFLICT':
      return CircleAlert
    default:
      return CloudOff
  }
}

export function ConnectionBadge({ onClick, compact = false }: { onClick?: () => void; compact?: boolean }) {
  const status = useSyncStatus()
  const copy = CONNECTION_COPY[status.state]
  const Icon = iconFor(status.state)
  const tone = copy.tone

  const queued = status.pendingCount + status.failedCount

  /**
   * Without a handler this is a readout, not a control.
   *
   * Everyone should be able to see whether the till is online and how much is
   * waiting - that is operationally useful to whoever is serving. Only some
   * roles get to open the panel behind it, and a button that looks pressable
   * and does nothing is worse than plain text.
   */
  const Component = onClick ? 'button' : 'div'

  return (
    <Component
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'group flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors touch-target',
        onClick ? 'hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-brand/40' : 'cursor-default',
      )}
      title={copy.detail}
    >
      <span className={cn('relative flex h-8 w-8 items-center justify-center rounded-lg', TONE_CLASSES[tone])}>
        <Icon className={cn('h-4 w-4', status.state === 'SYNCING' && 'animate-spin')} aria-hidden="true" />
        {status.realtimeConnected ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-positive ring-2 ring-surface"
            title="Receiving live updates"
          />
        ) : null}
      </span>

      {!compact ? (
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASSES[tone])} />
            <span className="text-[0.8125rem] font-medium text-ink">{copy.label}</span>
          </span>
          <span className="block truncate text-xs text-ink-subtle">
            {queued > 0
              ? `${queued} record${queued === 1 ? '' : 's'} waiting to sync`
              : status.state === 'ONLINE'
                ? `Synced ${relativeTime(status.lastSyncAt)}`
                : copy.detail}
          </span>
        </span>
      ) : null}
    </Component>
  )
}

/**
 * A full-width banner for the states an operator must not miss.
 *
 * Deliberately silent while everything is healthy - a banner that is always
 * there is a banner nobody reads.
 */
export function ConnectionBanner() {
  const status = useSyncStatus()
  if (status.state === 'ONLINE' || status.state === 'SYNCING') return null

  const copy = CONNECTION_COPY[status.state]
  const Icon = iconFor(status.state)
  const queued = status.pendingCount + status.failedCount

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm',
        status.state === 'CONFLICT' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning',
        status.state === 'OFFLINE' && 'bg-surface-sunken text-ink-muted',
      )}
      role="status"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{copy.label}.</span>{' '}
        <span className="text-ink-muted">{copy.detail}</span>
        {queued > 0 ? (
          <span className="text-ink-muted"> {queued} record{queued === 1 ? '' : 's'} held safely on this device.</span>
        ) : null}
      </p>
    </div>
  )
}
