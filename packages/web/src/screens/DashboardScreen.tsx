import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { TriangleAlert } from 'lucide-react'
import type { OperatingExpense } from '@pos/shared'
import {
  loadAnalytics,
  rankProducts,
  RANGE_LABELS,
  RANGE_PRESETS,
  resolveRange,
  type Analytics,
  type ProductRanking,
  type RangePreset,
} from '../db/analytics.ts'
import { BarList, ColumnChart, HeroFigure, StatTile, type BarRow } from '../components/charts/Charts.tsx'
import { Badge } from '../components/ui/primitives.tsx'
import { useMoney, useSettings } from '../app/providers.tsx'
import { buildProfitAndLoss, expensesIn } from '../db/expenses.ts'
import { DASHBOARD_TILES, tileEnabled } from './reports/tiles.ts'
import { ProfitAndLoss } from './reports/ProfitAndLoss.tsx'
import { cn } from '../lib/utils.ts'

/**
 * The dashboard.
 *
 * It leads with the number an owner opens the app for, and everything below it
 * exists to explain that number. Figures come from records this device already
 * holds, so it works with the internet down, and it re-reads itself whenever
 * synced sales arrive from another till - no refresh, no stale totals.
 */

/**
 * Column counts that leave no ragged last row.
 *
 * Tailwind reads class names literally, so these are spelled out rather than
 * built from the number.
 */
const TILE_COLUMNS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-3',
  6: 'lg:grid-cols-3',
}

const RANKINGS: Array<{ value: ProductRanking; label: string }> = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'quantity', label: 'Sold' },
  { value: 'profit', label: 'Profit' },
  { value: 'margin', label: 'Margin' },
]

export function DashboardScreen() {
  const money = useMoney()
  const { settings } = useSettings()
  const [preset, setPreset] = useState<RangePreset>('TODAY')
  const [ranking, setRanking] = useState<ProductRanking>('revenue')

  const range = useMemo(() => resolveRange(preset), [preset])

  const fresh = useLiveQuery(() => loadAnalytics(range), [range.from, range.to, range.granularity])

  /**
   * Hold the previous figures while the next range loads.
   *
   * Swapping in a skeleton on every filter change makes the whole page jump,
   * which reads as slower than it is. The old numbers stay, dimmed, until the
   * new ones are ready.
   */
  // Net profit needs what the shop spent as well as what it took, so the
  // expenses for the same range are read alongside the sales.
  const expenses = useLiveQuery(() => expensesIn(range), [range.from, range.to], [] as OperatingExpense[])

  const lastGood = useRef<Analytics | null>(null)
  if (fresh) lastGood.current = fresh
  const analytics = fresh ?? lastGood.current
  const settling = fresh === undefined && lastGood.current !== null

  // Money on an axis is unreadable in full; thousands are what people say.
  const compactMoney = (value: number): string => {
    const symbol = settings?.currencySymbol ?? '₱'
    const major = value / 100
    if (Math.abs(major) >= 1000) return `${symbol}${(major / 1000).toFixed(major >= 10000 ? 0 : 1)}k`
    return `${symbol}${Math.round(major)}`
  }

  const productRows = useMemo<BarRow[]>(() => {
    if (!analytics) return []
    return rankProducts(analytics.products, ranking).map((product) => ({
      key: product.key,
      label: product.name,
      sublabel: product.variantName,
      value:
        ranking === 'quantity'
          ? product.quantity
          : ranking === 'profit'
            ? product.profit
            : ranking === 'margin'
              ? product.marginPercent
              : product.revenue,
      display:
        ranking === 'quantity'
          ? `${product.quantity}`
          : ranking === 'margin'
            ? `${Math.round(product.marginPercent)}%`
            : money(ranking === 'profit' ? product.profit : product.revenue),
    }))
  }, [analytics, ranking, money])

  if (!analytics) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  const nothingYet = analytics.orders === 0

  // Both profit tiles come from the same statement as the profit and loss
  // below them, or the screen would show two different gross profits and a net
  // profit larger than its own gross.
  const pnl = buildProfitAndLoss({
    grossSales: analytics.grossRevenue,
    tax: analytics.taxTotal,
    costOfGoods: analytics.cogsTotal,
    uncostedSales: analytics.lumpSumRevenue,
    expenses,
  })

  // A backfilled day knows how many cups it sold but not which sizes, so the
  // breakdown says what it cannot account for rather than quietly not adding up.
  const sized = analytics.cupsBySize.reduce((sum, entry) => sum + entry.quantity, 0)
  const unsized = Math.max(0, analytics.cupsSold - sized)
  const cupsDetail = [
    ...analytics.cupsBySize.slice(0, 3).map((entry) => `${entry.quantity} × ${entry.size}`),
    analytics.cupsBySize.length > 3 ? `+${analytics.cupsBySize.length - 3} more sizes` : '',
    unsized > 0 ? `${unsized} not itemised` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const props: Record<string, React.ComponentProps<typeof StatTile>> = {
    cups: {
      label: 'Cups sold',
      value: nothingYet ? '—' : `${analytics.cupsSold}`,
      detail:
        analytics.snacksSold > 0
          ? `${cupsDetail || 'No sizes recorded'} · ${analytics.snacksSold} snacks`
          : cupsDetail || 'Drinks counted in cups',
      tone: 'default',
    },
    netOfTax: {
      label: 'Net of tax',
      value: money(analytics.netRevenue),
      detail: settings?.tax.enabled ? `${money(analytics.taxTotal)} ${settings.tax.label}` : 'No tax configured',
    },
    cogs: { label: 'Cost of goods', value: money(analytics.cogsTotal), detail: 'At cost when sold' },
    grossProfit: {
      label: 'Gross profit',
      value: money(pnl.grossProfit),
      detail: 'Before rent and wages',
      tone: pnl.grossProfit > 0 ? 'positive' : 'default',
    },
    netProfit: {
      label: 'Net profit',
      value: money(pnl.netProfit),
      detail: expenses.length === 0 ? 'No expenses recorded yet' : 'After operating expenses',
      tone: pnl.netProfit > 0 ? 'positive' : pnl.netProfit < 0 ? 'danger' : 'default',
    },
    // With nothing itemised to measure, margin is unknown rather than zero -
    // and "0%" in red would read as a bad margin, not a missing one.
    margin: {
      label: 'Margin',
      value: nothingYet || analytics.marginBasis <= 0 ? '—' : `${Math.round(analytics.marginPercent)}%`,
      detail:
        analytics.marginBasis <= 0 && analytics.lumpSumRevenue > 0
          ? 'No itemised sales to measure'
          : analytics.lumpSumRevenue > 0
            ? `On ${money(analytics.marginBasis)} of itemised sales`
            : analytics.discountTotal > 0
              ? `${money(analytics.discountTotal)} discounted`
              : undefined,
      tone:
        nothingYet || analytics.marginBasis <= 0
          ? 'default'
          : analytics.marginPercent >= 60
            ? 'positive'
            : analytics.marginPercent < 40
              ? 'danger'
              : 'default',
    },
  }

  const tiles = DASHBOARD_TILES.filter((tile) => tileEnabled(settings, tile.id) && props[tile.id]).map((tile) => ({
    id: tile.id,
    props: props[tile.id]!,
  }))

  return (
    <div className="scroll-pane h-full">
      {/* Filters in one row above everything they affect. */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3">
        <div className="scroll-pane -mx-1 flex gap-2 overflow-x-auto px-1">
          {RANGE_PRESETS.filter((entry) => entry !== 'CUSTOM').map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setPreset(entry)}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors press no-select',
                preset === entry
                  ? 'border-brand bg-brand text-brand-ink'
                  : 'border-line bg-surface text-ink-muted hover:text-ink',
              )}
            >
              {RANGE_LABELS[entry]}
            </button>
          ))}
        </div>
      </div>

      <div
        className={cn(
          'space-y-6 px-4 py-5 transition-opacity duration-150',
          settling && 'opacity-60',
        )}
      >
        <section className="flex flex-wrap items-end justify-between gap-4">
          <HeroFigure
            label={`Revenue · ${analytics.range.label.toLowerCase()}`}
            value={money(analytics.grossRevenue)}
            detail={
              nothingYet ? (
                'No sales in this period yet.'
              ) : (
                <>
                  {analytics.orders} {analytics.orders === 1 ? 'order' : 'orders'} ·{' '}
                  {money(analytics.averageOrder)} average · {analytics.itemsSold} items
                  {analytics.refundCount > 0 ? (
                    <span className="text-warning">
                      {' '}
                      · {money(analytics.refundedOut)} refunded over {analytics.refundCount}{' '}
                      {analytics.refundCount === 1 ? 'refund' : 'refunds'}
                    </span>
                  ) : null}
                </>
              )
            }
          />
          {analytics.voidedCount > 0 ? (
            <Badge tone="warning">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              {analytics.voidedCount} voided, excluded
            </Badge>
          ) : null}
        </section>

        <section className={cn('grid grid-cols-2 gap-3', TILE_COLUMNS[tiles.length] ?? 'lg:grid-cols-4')}>
          {tiles.map((tile) => (
            <StatTile key={tile.id} {...tile.props} />
          ))}
        </section>

        {analytics.lumpSumRevenue > 0 || analytics.loyalty.redemptions > 0 ? (
          <section className="grid gap-3 sm:grid-cols-2">
            {analytics.lumpSumRevenue > 0 ? (
              <p className="rounded-xl bg-surface-sunken px-4 py-3 text-[0.8125rem] text-ink-muted">
                <span className="font-medium text-ink">{money(analytics.lumpSumRevenue)}</span> of this comes from{' '}
                {analytics.lumpSumOrders} backfilled {analytics.lumpSumOrders === 1 ? 'day' : 'days'} entered as a
                single figure. Counted in revenue, but left out of margin — a notebook total cannot say what those
                cups cost.
              </p>
            ) : null}

            {analytics.loyalty.redemptions > 0 ? (
              <p className="rounded-xl bg-surface-sunken px-4 py-3 text-[0.8125rem] text-ink-muted">
                <span className="font-medium text-ink">{analytics.loyalty.redemptions}</span> loyalty{' '}
                {analytics.loyalty.redemptions === 1 ? 'claim' : 'claims'} —{' '}
                <span className="font-medium text-ink">{money(analytics.loyalty.valueGivenAway)}</span> given away,
                costing <span className="font-medium text-ink">{money(analytics.loyalty.cost)}</span> to make. No
                money came in, so none is counted as revenue.
              </p>
            ) : null}
          </section>
        ) : null}

        <ProfitAndLoss analytics={analytics} />

        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">
              Revenue by {analytics.range.granularity === 'HOUR' ? 'hour' : 'day'}
            </h2>
            {analytics.peak ? (
              <p className="text-[0.8125rem] text-ink-muted">
                Busiest: <span className="font-medium text-ink">{analytics.peak.label}</span> ·{' '}
                <span className="tabular">{money(analytics.peak.revenue)}</span>
              </p>
            ) : null}
          </div>
          <ColumnChart
            points={analytics.buckets.map((bucket) => ({
              label: bucket.label,
              value: bucket.revenue,
              secondary: `${bucket.orders} ${bucket.orders === 1 ? 'order' : 'orders'}`,
            }))}
            formatValue={compactMoney}
            formatExact={money}
            emptyMessage="No sales in this period."
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-ink">Top products</h2>
              <div className="flex gap-1 rounded-lg bg-surface-sunken p-0.5">
                {RANKINGS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => setRanking(entry.value)}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                      ranking === entry.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-subtle hover:text-ink',
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <BarList rows={productRows} emptyMessage="No products sold in this period." />
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-4 text-sm font-medium text-ink">Revenue by category</h2>
            <BarList
              rows={analytics.categories.map((category) => ({
                key: category.name,
                label: category.name,
                sublabel: `${category.quantity} items`,
                value: category.revenue,
                display: money(category.revenue),
              }))}
              emptyMessage="No categories sold in this period."
            />
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-4 text-sm font-medium text-ink">How people paid</h2>
            <BarList
              rows={analytics.payments.map((payment) => ({
                key: payment.method,
                label: payment.label,
                sublabel: `${payment.count} ${payment.count === 1 ? 'payment' : 'payments'}`,
                value: payment.amount,
                display: money(payment.amount),
                // Flagged with an icon and words, never colour alone.
                trailing: payment.unverified > 0 ? <Badge tone="warning">unverified</Badge> : undefined,
              }))}
              emptyMessage="No payments in this period."
            />
            {analytics.payments.some((payment) => payment.unverified > 0) ? (
              <p className="mt-3 text-[0.8125rem] text-ink-subtle">
                Unverified means the payment was taken while the till was offline and has not been confirmed with
                the provider.
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-4 text-sm font-medium text-ink">Staff</h2>
            <BarList
              rows={analytics.staff.map((row) => ({
                key: row.userId,
                label: row.name,
                sublabel: `${row.orders} ${row.orders === 1 ? 'order' : 'orders'}`,
                value: row.revenue,
                display: money(row.revenue),
              }))}
              emptyMessage="Nobody has rung anything up in this period."
            />
          </section>
        </div>
      </div>
    </div>
  )
}
