import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Receipt, Search, X } from 'lucide-react'
import { PAYMENT_METHODS, type PaymentMethod, type Sale, type SaleStatus } from '@pos/shared'
import { db } from '../db/database.ts'
import { EMPTY_FILTERS, isRefund, searchLedger, STATUS_LABELS, type LedgerFilters } from '../db/ledger.ts'
import { resolveRange, type RangePreset } from '../db/analytics.ts'
import { Badge, EmptyState } from '../components/ui/primitives.tsx'
import { useMoney } from '../app/providers.tsx'
import { SaleSheet } from './ledger/SaleSheet.tsx'
import { cn, clockTime } from '../lib/utils.ts'

/**
 * Every transaction, searchable.
 *
 * The search box takes whatever the person actually remembers - a receipt
 * number, the queue number they called out, the customer's name, or just
 * "latte" - rather than making them pick a field first.
 */

const PERIODS: Array<{ value: RangePreset | 'ALL'; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'ALL', label: 'All time' },
]

const STATUSES: Array<SaleStatus | 'ALL'> = ['ALL', 'COMPLETED', 'VOIDED', 'REFUNDED', 'PARTIALLY_REFUNDED']

function statusTone(status: SaleStatus): 'neutral' | 'danger' | 'warning' {
  if (status === 'VOIDED') return 'danger'
  if (status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED') return 'warning'
  return 'neutral'
}

export function LedgerScreen() {
  const money = useMoney()
  const [period, setPeriod] = useState<RangePreset | 'ALL'>('TODAY')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<SaleStatus | 'ALL'>('ALL')
  const [method, setMethod] = useState<PaymentMethod | 'ALL'>('ALL')
  const [selected, setSelected] = useState<Sale | null>(null)

  const filters = useMemo<LedgerFilters>(() => {
    const range = period === 'ALL' ? null : resolveRange(period)
    return {
      ...EMPTY_FILTERS,
      query,
      from: range?.from ?? null,
      to: range?.to ?? null,
      status,
      method,
    }
  }, [period, query, status, method])

  const rows = useLiveQuery(() => searchLedger(filters), [filters.query, filters.from, filters.to, filters.status, filters.method])

  // Keep the open sheet in step with the record as it changes underneath it.
  const live = useLiveQuery(async () => {
    if (!selected) return null
    return (await db.sales.get(selected.id)) ?? null
  }, [selected?.id])
  const openSale = live ?? selected

  const takings = useMemo(
    () => (rows ?? []).reduce((sum, row) => (row.sale.status === 'VOIDED' ? sum : sum + row.sale.total), 0),
    [rows],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 border-b border-line bg-surface px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Receipt, queue number, customer or item"
            className="h-11 w-full rounded-xl border border-line bg-canvas pl-10 pr-9 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-subtle hover:bg-surface-sunken"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="scroll-pane -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
          {PERIODS.map((entry) => (
            <Chip key={entry.value} active={period === entry.value} onClick={() => setPeriod(entry.value)}>
              {entry.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as SaleStatus | 'ALL')}
              className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:border-brand focus:outline-none"
            >
              {STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === 'ALL' ? 'Any status' : STATUS_LABELS[entry]}
                </option>
              ))}
            </select>

            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod | 'ALL')}
              className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:border-brand focus:outline-none"
            >
              <option value="ALL">Any payment</option>
              {PAYMENT_METHODS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === 'LOYALTY' ? 'Loyalty claim' : entry === 'GCASH' ? 'GCash' : entry.charAt(0) + entry.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <p className="text-[0.8125rem] text-ink-muted">
            {rows?.length ?? 0} {rows?.length === 1 ? 'transaction' : 'transactions'} ·{' '}
            <span className="tabular font-medium text-ink">{money(takings)}</span>
          </p>
        </div>
      </div>

      <div className="scroll-pane flex-1">
        {!rows ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-8 w-8" aria-hidden="true" />}
            title={query ? 'Nothing matches that' : 'No transactions in this period'}
            description={query ? 'Try a receipt number, a name, or an item.' : 'Sales appear here as they are rung up.'}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const refund = isRefund(row.sale)
              return (
                <li key={row.sale.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(row.sale)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[0.8125rem] text-ink">{row.sale.receiptNo}</span>
                        {row.sale.queueNo ? (
                          <span className="tabular text-xs text-ink-subtle">#{row.sale.queueNo}</span>
                        ) : null}
                        {row.sale.status !== 'COMPLETED' ? (
                          <Badge tone={statusTone(row.sale.status)}>{STATUS_LABELS[row.sale.status]}</Badge>
                        ) : null}
                        {refund ? <Badge tone="warning">Refund of {row.refundOf}</Badge> : null}
                        {row.sale.entryMode === 'LUMP_SUM' ? <Badge tone="neutral">Backfilled</Badge> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-ink-muted">{row.itemSummary}</span>
                      <span className="block text-xs text-ink-subtle">
                        {new Date(row.sale.occurredAt).toLocaleDateString()} {clockTime(row.sale.occurredAt)} ·{' '}
                        {row.cashierName}
                        {row.methods.length > 0
                          ? ` · ${row.methods.map((entry) => (entry === 'LOYALTY' ? 'Loyalty' : entry === 'GCASH' ? 'GCash' : entry.charAt(0) + entry.slice(1).toLowerCase())).join(', ')}`
                          : ''}
                      </span>
                    </span>

                    <span
                      className={cn(
                        'tabular shrink-0 text-[0.9375rem] font-medium',
                        row.sale.status === 'VOIDED'
                          ? 'text-ink-subtle line-through'
                          : row.sale.total < 0
                            ? 'text-danger'
                            : 'text-ink',
                      )}
                    >
                      {money(row.sale.total)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <SaleSheet sale={openSale ?? null} open={selected !== null} onClose={() => setSelected(null)} />
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
        'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors press no-select',
        active
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-line bg-surface text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
