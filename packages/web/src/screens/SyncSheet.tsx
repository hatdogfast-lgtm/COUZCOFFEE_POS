import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLiveQuery } from 'dexie-react-hooks'
import { CloudOff, Link2, Link2Off, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { CONNECTION_COPY } from '@pos/shared'
import { Button, Field, Input } from '../components/ui/primitives.tsx'
import { db, META_KEYS, readMeta } from '../db/database.ts'
import { identity } from '../db/identity.ts'
import { syncEngine } from '../sync/engine.ts'
import { useSession, useSyncStatus } from '../app/providers.tsx'
import { cn, relativeTime } from '../lib/utils.ts'

/**
 * The synchronisation panel.
 *
 * Shows the truth and nothing but: what is queued, what failed, what is in
 * conflict, and when this device last spoke to the server. Connecting to a
 * server is optional - the till has been working without one all along, and
 * disconnecting never removes anything already recorded here.
 */
export function SyncSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useSyncStatus()
  const { user, can } = useSession()
  // Seeing the state of the till is one thing; changing which server it trusts,
  // or deciding which copy of a disputed record wins, is another.
  const mayManage = can('sync.manage')
  const [serverUrl, setServerUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pending = useLiveQuery(
    () => db.outbox.orderBy('createdAt').reverse().limit(8).toArray(),
    [],
    [],
  )
  const conflicts = useLiveQuery(
    () => db.conflicts.filter((conflict) => conflict.resolvedAt === null).toArray(),
    [],
    [],
  )

  useEffect(() => {
    if (!open) return
    setError(null)
    void readMeta<string>(META_KEYS.serverUrl, '').then((url) =>
      setServerUrl(url || 'http://localhost:4000'),
    )
  }, [open])

  const connected = syncEngine.isConfigured()
  const copy = CONNECTION_COPY[status.state]

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await syncEngine.enrol(serverUrl, code)
      setCode('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The server could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[28rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:animate-slide-in-right">
          <header className="flex items-center justify-between border-b border-line px-5 py-4 pad-safe-top">
            <Dialog.Title className="text-lg font-semibold text-ink">Synchronisation</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane flex-1 space-y-6 px-5 py-5">
            <section className="rounded-2xl border border-line bg-surface-sunken p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-ink">{copy.label}</p>
                  <p className="text-[0.8125rem] text-ink-muted">{copy.detail}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void syncEngine.syncNow()}
                  disabled={!connected}
                >
                  <RefreshCw className={cn('h-4 w-4', status.state === 'SYNCING' && 'animate-spin')} aria-hidden="true" />
                  Sync now
                </Button>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-center">
                <Stat label="Waiting" value={status.pendingCount} />
                <Stat label="Failed" value={status.failedCount} tone={status.failedCount > 0 ? 'warning' : undefined} />
                <Stat
                  label="Conflicts"
                  value={status.conflictCount}
                  tone={status.conflictCount > 0 ? 'danger' : undefined}
                />
              </dl>

              <p className="mt-3 text-xs text-ink-subtle">
                Last synced {relativeTime(status.lastSyncAt)} · change log position {status.cursor}
                {status.realtimeConnected ? ' · receiving live updates' : ''}
              </p>
              {status.lastError ? (
                <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{status.lastError}</p>
              ) : null}
            </section>

            <section className="space-y-3">
              <h3 className="text-[0.8125rem] font-medium text-ink-muted">This device</h3>
              <div className="rounded-xl border border-line px-4 py-3 text-sm">
                <p className="font-medium text-ink">{identity().label}</p>
                <p className="font-mono text-xs text-ink-subtle">{identity().deviceId}</p>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[0.8125rem] font-medium text-ink-muted">Central server</h3>

              {connected ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 rounded-xl border border-line px-4 py-3">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{syncEngine.serverUrl()}</p>
                      <p className="text-xs text-ink-subtle">Enrolled and syncing automatically.</p>
                    </div>
                  </div>
                  {mayManage ? (
                    <>
                      <Button variant="outline" full onClick={() => void syncEngine.forgetServer()}>
                        <Link2Off className="h-4 w-4" aria-hidden="true" />
                        Disconnect from server
                      </Button>
                      <p className="text-xs text-ink-subtle">
                        Disconnecting leaves every record on this device untouched. The till keeps working.
                      </p>
                    </>
                  ) : null}
                </div>
              ) : !mayManage ? (
                <p className="rounded-xl bg-surface-sunken px-3.5 py-3 text-[0.8125rem] text-ink-muted">
                  This till is not connected to a server. A manager or owner can connect it.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-2.5 rounded-xl bg-surface-sunken px-3.5 py-3 text-[0.8125rem] text-ink-muted">
                    <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>
                      This till is running on its own. Connect it to a server to share sales, stock and prices with
                      your other devices.
                    </p>
                  </div>
                  <Field label="Server address">
                    <Input
                      value={serverUrl}
                      onChange={(event) => setServerUrl(event.target.value)}
                      placeholder="http://192.168.1.10:4000"
                      autoComplete="url"
                    />
                  </Field>
                  <Field label="Enrolment code" hint="Set on the server. Ask whoever set it up.">
                    <Input
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Enrolment code"
                      type="password"
                    />
                  </Field>
                  {error ? (
                    <p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-[0.8125rem] text-danger">{error}</p>
                  ) : null}
                  <Button full onClick={() => void connect()} disabled={busy || !serverUrl || !code}>
                    {busy ? 'Connecting…' : 'Connect this device'}
                  </Button>
                </div>
              )}
            </section>

            {conflicts.length > 0 ? (
              <section className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-danger">
                  <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                  Needs review
                </h3>
                {conflicts.map((conflict) => (
                  <div key={conflict.id} className="space-y-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3.5">
                    <p className="text-sm text-ink">
                      A <span className="font-medium">{conflict.entity}</span> record was changed on another device
                      while this one was offline.
                    </p>
                    {mayManage ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void syncEngine.resolveKeepLocal(conflict.id, user?.id ?? '')}
                      >
                        Keep this device's
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void syncEngine.resolveKeepServer(conflict.id, user?.id ?? '')}
                      >
                        Use the server's
                      </Button>
                    </div>
                    ) : (
                      <p className="text-[0.8125rem] text-ink-muted">A manager or owner needs to settle this.</p>
                    )}
                  </div>
                ))}
              </section>
            ) : null}

            {status.failedCount > 0 ? (
              <Button variant="secondary" full onClick={() => void syncEngine.retryFailed()}>
                Retry {status.failedCount} failed record{status.failedCount === 1 ? '' : 's'}
              </Button>
            ) : null}

            {pending.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-[0.8125rem] font-medium text-ink-muted">Most recent in the queue</h3>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {pending.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{entry.entity}</span>
                        <span className="block truncate font-mono text-xs text-ink-subtle">{entry.entityId}</span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-xs',
                          entry.status === 'CONFLICT'
                            ? 'bg-danger/12 text-danger'
                            : entry.status === 'SYNC_FAILED'
                              ? 'bg-warning/12 text-warning'
                              : 'bg-surface-sunken text-ink-muted',
                        )}
                      >
                        {entry.status.replace('SYNC_', '').toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'danger' }) {
  return (
    <div>
      <dd
        className={cn(
          'tabular text-xl font-semibold',
          tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink',
        )}
      >
        {value}
      </dd>
      <dt className="text-xs text-ink-muted">{label}</dt>
    </div>
  )
}
