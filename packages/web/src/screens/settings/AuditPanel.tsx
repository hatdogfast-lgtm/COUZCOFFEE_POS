import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { Download, ScrollText, Search, X } from 'lucide-react'
import {
  auditFacets,
  auditToCsv,
  AUDIT_GROUPS,
  DEFAULT_AUDIT_LIMIT,
  groupOf,
  humanise,
  searchAuditLog,
  type AuditEntry,
} from '../../db/audit.ts'
import { db } from '../../db/database.ts'
import { RANGE_LABELS, RANGE_PRESETS, resolveRange, type RangePreset } from '../../db/analytics.ts'
import { Badge, Button, EmptyState, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * The audit trail.
 *
 * Every consequential change writes a row here inside the same transaction as
 * the change itself, so this is not a log that can drift from what happened -
 * it is part of what happened. Nothing in the app edits or deletes a row, and
 * there is deliberately no control here that would.
 *
 * The filters are built from the entries that actually exist rather than a
 * fixed list, so an action added to the app later shows up here on its own.
 */
export function AuditPanel() {
  const { can } = useSession()
  const [preset, setPreset] = useState<RangePreset>('THIS_MONTH')
  const [text, setText] = useState('')
  const [group, setGroup] = useState<string>('')
  const [userId, setUserId] = useState<string>('')
  const [limit, setLimit] = useState(DEFAULT_AUDIT_LIMIT)
  const [viewing, setViewing] = useState<AuditEntry | null>(null)

  const range = useMemo(() => resolveRange(preset), [preset])

  const facets = useLiveQuery(() => auditFacets(), [], { actions: [], entityTypes: [] })
  const staff = useLiveQuery(() => db.users.toArray(), [], [])

  // A group is a shorthand for a set of actions, resolved against what is
  // actually present so an empty group never silently shows everything.
  const actions = useMemo(() => {
    if (!group) return []
    return facets.actions.filter((action) => groupOf(action) === group)
  }, [group, facets.actions])

  const page = useLiveQuery(
    () =>
      searchAuditLog({
        from: range.from,
        to: range.to,
        text,
        actions,
        entityTypes: [],
        userId: userId || null,
        limit,
      }),
    [range.from, range.to, text, actions.join(','), userId, limit],
  )

  const groupsPresent = useMemo(() => {
    const present = new Set(facets.actions.map(groupOf))
    return AUDIT_GROUPS.filter((entry) => present.has(entry.id))
  }, [facets.actions])

  if (!can('audit.view')) {
    return (
      <p className="px-4 py-10 text-center text-sm text-ink-muted">
        Your role cannot see the audit trail. An owner or manager can.
      </p>
    )
  }

  function exportCsv(): void {
    if (!page || page.entries.length === 0) return
    const blob = new Blob([auditToCsv(page.entries)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    toast.success(`${page.entries.length} entries exported.`)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 border-b border-line bg-surface px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search what happened, who, or why"
            className="pl-10 pr-9"
          />
          {text ? (
            <button
              type="button"
              onClick={() => setText('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-subtle hover:bg-surface-sunken"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="scroll-pane -mx-1 flex gap-2 overflow-x-auto px-1">
          {RANGE_PRESETS.map((entry) => (
            <Chip key={entry} active={preset === entry} onClick={() => setPreset(entry)}>
              {RANGE_LABELS[entry]}
            </Chip>
          ))}
        </div>

        <div className="scroll-pane -mx-1 flex gap-2 overflow-x-auto px-1">
          <Chip active={group === ''} onClick={() => setGroup('')}>
            Everything
          </Chip>
          {groupsPresent.map((entry) => (
            <Chip key={entry.id} active={group === entry.id} onClick={() => setGroup(entry.id)}>
              {entry.label}
            </Chip>
          ))}
        </div>

        {staff.length > 1 ? (
          <div className="scroll-pane -mx-1 flex gap-2 overflow-x-auto px-1">
            <Chip active={userId === ''} onClick={() => setUserId('')}>
              Anyone
            </Chip>
            {staff.map((person) => (
              <Chip key={person.id} active={userId === person.id} onClick={() => setUserId(person.id)}>
                {person.name}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      <div className="scroll-pane flex-1">
        {!page ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
        ) : page.entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-8 w-8" aria-hidden="true" />}
            title="Nothing recorded in this period"
            description="Change the dates or the filters above."
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {page.entries.map((entry) => (
                <li key={entry.log.id}>
                  <button
                    type="button"
                    onClick={() => setViewing(entry)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.9375rem] font-medium text-ink">{entry.actionLabel}</span>
                        {entry.changes.length > 0 ? (
                          <Badge>{entry.changes.length} changed</Badge>
                        ) : null}
                      </span>
                      {entry.log.reason ? (
                        <span className="block truncate text-[0.8125rem] text-ink-muted">{entry.log.reason}</span>
                      ) : null}
                      <span className="block truncate text-[0.8125rem] text-ink-subtle">
                        {entry.userName} · {new Date(entry.log.occurredAt).toLocaleString()}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="space-y-2 px-4 py-4">
              <p className="text-center text-[0.8125rem] text-ink-subtle">
                Showing {page.entries.length} of {page.total}
              </p>
              {page.hasMore ? (
                <Button variant="secondary" full onClick={() => setLimit((value) => value + DEFAULT_AUDIT_LIMIT)}>
                  Show more
                </Button>
              ) : null}
              <Button variant="ghost" full onClick={exportCsv}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Export what is shown
              </Button>
            </div>
          </>
        )}
      </div>

      <EntrySheet entry={viewing} open={viewing !== null} onClose={() => setViewing(null)} />
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors press no-select',
        active
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/** One entry in full, including exactly which fields moved and to what. */
function EntrySheet({
  entry,
  open,
  onClose,
}: {
  entry: AuditEntry | null
  open: boolean
  onClose: () => void
}) {
  const money = useMoney()
  if (!entry) return null

  // An amount is stored in minor units; showing it raw makes an owner do
  // arithmetic to read their own books.
  const display = (value: string | null, isMoney: boolean): string =>
    value !== null && isMoney ? money(Number(value)) : (value ?? "")

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[30rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:animate-slide-in-right">
          <header className="flex items-center justify-between border-b border-line px-5 py-4 pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold text-ink">
                {entry.actionLabel}
              </Dialog.Title>
              <Dialog.Description className="truncate text-sm text-ink-muted">
                {entry.userName} · {new Date(entry.log.occurredAt).toLocaleString()}
              </Dialog.Description>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 rounded-xl p-2 text-ink-muted hover:bg-surface-sunken"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          <div className="scroll-pane flex-1 space-y-4 px-5 py-4">
            {entry.log.reason ? (
              <p className="rounded-xl bg-surface-sunken px-3 py-2.5 text-[0.9375rem] text-ink">
                {entry.log.reason}
              </p>
            ) : null}

            <dl className="space-y-1 text-[0.8125rem]">
              <Row label="Record" value={entry.log.entityType} />
              <Row label="Reference" value={entry.log.entityId} mono />
              <Row label="Raw action" value={entry.log.action} mono />
            </dl>

            {entry.changes.length > 0 ? (
              <section>
                <h3 className="mb-2 border-b border-line pb-1 text-[0.8125rem] font-medium uppercase tracking-wide text-ink-subtle">
                  What changed
                </h3>
                <ul className="space-y-2">
                  {entry.changes.map((change) => (
                    <li key={change.field} className="rounded-xl border border-line px-3 py-2">
                      <p className="text-[0.8125rem] font-medium text-ink">{humanise(change.field)}</p>
                      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.8125rem]">
                        {change.before !== null ? (
                          <>
                            <span className="text-ink-subtle">From</span>
                            <span className="break-words text-danger">{display(change.before, change.money)}</span>
                          </>
                        ) : null}
                        {change.after !== null ? (
                          <>
                            <span className="text-ink-subtle">To</span>
                            <span className="break-words text-positive">{display(change.after, change.money)}</span>
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="text-[0.8125rem] text-ink-subtle">
                This entry records that something happened rather than a change from one value to another.
              </p>
            )}

            <p className="text-[0.8125rem] text-ink-subtle">
              Audit entries are written in the same transaction as the change they describe, and nothing in this app
              can edit or remove one.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className={cn('min-w-0 break-all text-right text-ink', mono ? 'font-mono text-xs' : '')}>{value}</dd>
    </div>
  )
}
