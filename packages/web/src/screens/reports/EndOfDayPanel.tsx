import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarCheck } from 'lucide-react'
import { buildEndOfDay, type CostLine, type SalesLine } from '../../db/endOfDay.ts'
import { EmptyState } from '../../components/ui/primitives.tsx'
import { StatTile } from '../../components/charts/Charts.tsx'
import { useMoney, useSettings } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Closing the day.
 *
 * The dashboard answers "how are we doing"; this answers "what happened today,
 * and where did it come from". Every headline is followed by the rows that add
 * up to it, so the owner can see what a total is made of rather than having to
 * trust it.
 */
export function EndOfDayPanel() {
  const money = useMoney()
  const { settings } = useSettings()
  const [iso, setIso] = useState(() => toIso(new Date()))

  const date = useMemo(() => fromIso(iso), [iso])
  const summary = useLiveQuery(() => buildEndOfDay(date), [date.getTime()])

  if (!summary) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  const taxLabel = settings?.tax.label ?? 'Tax'

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-ink">End of day</h2>
            <p className="text-[0.8125rem] text-ink-muted">{longDate(date)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIso(toIso(new Date()))}
              className="rounded-xl border border-line px-3 py-2 text-[0.8125rem] text-ink-muted transition-colors press hover:text-ink"
            >
              Today
            </button>
            <input
              type="date"
              value={iso}
              max={toIso(new Date())}
              onChange={(event) => event.target.value && setIso(event.target.value)}
              className="h-10 rounded-xl border border-line bg-canvas px-3 text-[0.9375rem] text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
            />
          </div>
        </div>

        {summary.quiet ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" aria-hidden="true" />}
            title="Nothing was rung up"
            description="No orders on this day. A closed day looks exactly like this."
          />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Total sales"
                value={money(summary.analytics.grossRevenue)}
                detail={`${summary.orders} ${summary.orders === 1 ? 'order' : 'orders'}`}
              />
              <StatTile
                label="Total cost of goods"
                value={money(summary.analytics.cogsTotal)}
                detail="What the drinks cost to make"
              />
              <StatTile
                label="Gross profit"
                value={money(summary.pnl.grossProfit)}
                detail="Before expenses"
                tone={summary.pnl.grossProfit > 0 ? 'positive' : 'default'}
              />
              <StatTile
                label="Net profit"
                value={money(summary.pnl.netProfit)}
                detail={
                  summary.pnl.totalExpenses > 0
                    ? `After ${money(summary.pnl.totalExpenses)} of expenses`
                    : 'No expenses recorded'
                }
                tone={summary.pnl.netProfit > 0 ? 'positive' : summary.pnl.netProfit < 0 ? 'danger' : 'default'}
              />
            </section>

            <p className="rounded-xl bg-surface-sunken px-4 py-3 text-[0.8125rem] text-ink-muted">
              <span className="font-medium text-ink">
                {summary.cups} {summary.cups === 1 ? 'cup' : 'cups'}
              </span>
              {summary.snacks > 0 ? (
                <>
                  {' and '}
                  <span className="font-medium text-ink">
                    {summary.snacks} {summary.snacks === 1 ? 'snack' : 'snacks'}
                  </span>
                </>
              ) : null}{' '}
              went out across {summary.orders} {summary.orders === 1 ? 'order' : 'orders'}.
            </p>

            <Section
              title="What made up the sales"
              note="Every category sold, largest first. Together these are the total sales above."
            >
              <SalesTable rows={summary.byCategory} money={money} />
            </Section>

            <Section title="Which drinks" note="The same takings again, one row per size.">
              <SalesTable rows={summary.byProduct} money={money} />
            </Section>

            <Section title="How it was paid" note="What should be in the drawer, and what in each wallet.">
              <ul className="divide-y divide-line">
                {summary.payments.map((slice) => (
                  <li key={slice.method} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="text-[0.9375rem] text-ink">{slice.label}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-[0.8125rem] text-ink-subtle">
                        {slice.count} {slice.count === 1 ? 'payment' : 'payments'}
                      </span>
                      <span className="tabular text-[0.9375rem] font-medium text-ink">{money(slice.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section
              title="What the cost of goods was"
              note="Read from the stock ledger — what actually left the shelf because something was sold."
            >
              {summary.byIngredient.length === 0 ? (
                <p className="px-4 py-3 text-[0.8125rem] text-ink-muted">
                  No stock movements on this day, so the cost above is what each sale recorded at the time rather
                  than what came off the shelf.
                </p>
              ) : (
                <CostTable rows={summary.byIngredient} money={money} />
              )}

              {summary.unexplainedCogs > 0 ? (
                <p className="border-t border-line px-4 py-2.5 text-[0.8125rem] text-ink-muted">
                  <span className="font-medium text-ink">{money(summary.unexplainedCogs)}</span> of the cost is not
                  accounted for by the ledger — a sale that recorded a cost without deducting stock, usually a
                  product with no recipe.
                </p>
              ) : null}
            </Section>

            <Section title="The bottom line" note="Where the takings ended up.">
              <dl className="divide-y divide-line">
                <Row label="Sales" value={money(summary.analytics.grossRevenue)} />
                <Row label={`Less: ${taxLabel} collected`} value={`−${money(summary.analytics.taxTotal)}`} muted />
                <Row label="Net sales" value={money(summary.pnl.netSales)} strong />
                <Row
                  label="Less: cost of ingredients and packaging"
                  value={`−${money(summary.analytics.cogsTotal)}`}
                  muted
                />
                <Row
                  label="Gross profit"
                  value={money(summary.pnl.grossProfit)}
                  strong
                  tone={summary.pnl.grossProfit > 0 ? 'positive' : summary.pnl.grossProfit < 0 ? 'danger' : undefined}
                />
                {summary.pnl.totalExpenses > 0 ? (
                  <Row label="Less: expenses" value={`−${money(summary.pnl.totalExpenses)}`} muted />
                ) : null}
                <Row
                  label="Net profit"
                  value={money(summary.pnl.netProfit)}
                  strong
                  tone={summary.pnl.netProfit > 0 ? 'positive' : summary.pnl.netProfit < 0 ? 'danger' : undefined}
                />
              </dl>
            </Section>

            {summary.uncostedSales > 0 ? (
              <p className="rounded-xl bg-surface-sunken px-4 py-3 text-[0.8125rem] text-ink-muted">
                <span className="font-medium text-ink">{money(summary.uncostedSales)}</span> of the takings was
                entered as a single figure for the day, so it counts towards sales but has no cost behind it. The
                profit above is that much more flattering than the day really was.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <p className="mt-0.5 text-[0.8125rem] text-ink-muted">{note}</p>
      </div>
      {children}
    </section>
  )
}

function SalesTable({ rows, money }: { rows: SalesLine[]; money: (amount: number) => string }) {
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-[0.8125rem] text-ink-muted">Nothing itemised on this day.</p>
  }

  return (
    <>
      <div className="hidden grid-cols-[1fr_4rem_6rem_6rem_6rem] gap-3 border-b border-line px-4 py-2 text-xs font-medium text-ink-muted sm:grid">
        <span>Item</span>
        <span className="text-right">Sold</span>
        <span className="text-right">Sales</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Profit</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li
            key={row.name}
            className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[1fr_4rem_6rem_6rem_6rem] sm:items-center"
          >
            <span className="col-span-2 min-w-0 sm:col-span-1">
              <span className="block truncate text-[0.9375rem] text-ink">{row.name}</span>
              <span className="block text-[0.6875rem] text-ink-subtle">{Math.round(row.share)}% of sales</span>
            </span>
            <Cell label="Sold" value={String(row.quantity)} />
            <Cell label="Sales" value={money(row.revenue)} />
            <Cell label="Cost" value={row.cogs > 0 ? money(row.cogs) : '—'} muted />
            <Cell label="Profit" value={money(row.profit)} />
          </li>
        ))}
      </ul>
    </>
  )
}

function CostTable({ rows, money }: { rows: CostLine[]; money: (amount: number) => string }) {
  return (
    <>
      <div className="hidden grid-cols-[1fr_7rem_6rem] gap-3 border-b border-line px-4 py-2 text-xs font-medium text-ink-muted sm:grid">
        <span>Ingredient</span>
        <span className="text-right">Used</span>
        <span className="text-right">Cost</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li
            key={row.name}
            className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[1fr_7rem_6rem] sm:items-center"
          >
            <span className="col-span-2 min-w-0 sm:col-span-1">
              <span className="block truncate text-[0.9375rem] text-ink">{row.name}</span>
              <span className="block text-[0.6875rem] text-ink-subtle">{Math.round(row.share)}% of the cost</span>
            </span>
            <Cell label="Used" value={row.used} muted />
            <Cell label="Cost" value={money(row.cost)} />
          </li>
        ))}
      </ul>
    </>
  )
}

function Cell({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <span className="text-right">
      <span className="block text-[0.6875rem] text-ink-subtle sm:hidden">{label}</span>
      <span className={cn('tabular block text-[0.9375rem]', muted ? 'text-ink-muted' : 'text-ink')}>{value}</span>
    </span>
  )
}

function Row({
  label,
  value,
  strong = false,
  muted = false,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
  /** Colour by what the number means, never by which row it sits on. */
  tone?: 'positive' | 'danger'
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className={cn('text-[0.9375rem]', strong ? 'font-medium text-ink' : muted ? 'text-ink-muted' : 'text-ink')}>
        {label}
      </dt>
      <dd
        className={cn(
          'tabular text-[0.9375rem]',
          strong ? 'font-semibold' : '',
          tone === 'positive'
            ? 'text-positive'
            : tone === 'danger'
              ? 'text-danger'
              : muted
                ? 'text-ink-muted'
                : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/** Local dates, not UTC: a shop closes on its own calendar, not Greenwich's. */
function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function fromIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
