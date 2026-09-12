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

/** On the espresso header: a cream chip when all is well, a solid one when it is not. */
const CHROME_CHIP_CLASSES: Record<string, string> = {
  online: 'border-chrome-ink/20 bg-chrome-ink/10 text-chrome-ink',
  offline: 'border-chrome-ink/20 bg-chrome-ink/10 text-chrome-ink',
  pending: 'border-honey bg-honey text-honey-ink',
  warning: 'border-honey bg-honey text-honey-ink',
  danger: 'border-danger bg-danger text-danger-ink',
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

export function ConnectionBadge({
  onClick,
  compact = false,
  onChrome = false,
}: {
  onClick?: () => void
  compact?: boolean
  /** Rendered on the espresso header, where a cream chip reads and a tinted one does not. */
  onChrome?: boolean
}) {
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
        'group flex items-center gap-2 text-left transition-colors touch-target',
        onChrome ? cn('micro rounded-sm border px-2 py-1', CHROME_CHIP_CLASSES[tone]) : 'rounded-md px-3 py-2',
        onClick
          ? onChrome
            ? 'hover:opacity-90 focus-visible:ring-2 focus-visible:ring-chrome-ink/40'
            : 'hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-brand/40'
          : 'cursor-default',
      )}
      title={copy.detail}
    >
      <span
        className={cn(
          'relative flex items-center justify-center rounded-md',
          onChrome ? 'h-5 w-5 bg-transparent' : cn('h-8 w-8', TONE_CLASSES[tone]),
        )}
      >
        <Icon
          className={cn(onChrome ? 'h-3.5 w-3.5' : 'h-4 w-4', status.state === 'SYNCING' && 'animate-spin')}
          aria-hidden="true"
        />
        {status.realtimeConnected ? (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-positive ring-2',
              onChrome ? 'ring-chrome' : 'ring-surface',
            )}
            title="Receiving live updates"
          />
        ) : null}
      </span>
      {onChrome ? <span>{copy.label}</span> : null}

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
        'flex items-center gap-3 border-b border-l-2 border-line px-4 py-2.5 text-sm text-ink',
        status.state === 'CONFLICT' ? 'border-l-danger bg-danger/10' : 'border-l-honey bg-honey/15',
        status.state === 'OFFLINE' && 'border-l-line-strong bg-surface-sunken text-ink-muted',
      )}
      role="status"
    >
      <Icon
        className={cn('h-4 w-4 shrink-0', status.state === 'CONFLICT' ? 'text-danger' : 'text-warning')}
        aria-hidden="true"
      />
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
