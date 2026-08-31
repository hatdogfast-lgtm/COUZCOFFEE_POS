import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import {
  fromDecimal,
  type ExpenseCategoryEntry,
  type OperatingExpense,
  type User,
} from '@pos/shared'
import { db } from '../../db/database.ts'
import {
  buildProfitAndLoss,
  expensesIn,
  recordExpense,
  removeExpense,
} from '../../db/expenses.ts'
import { listExpenseCategories, nameOf } from '../../db/shopLists.ts'
import type { Analytics } from '../../db/analytics.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * The profit and loss statement.
 *
 * Gross profit is where most till reports stop, and it is the number that
 * flatters a coffee shop most - it has not yet paid rent or anyone's wages.
 * This carries on past it to what is actually left, which is the figure the
 * owner is really asking about.
 */
export function ProfitAndLoss({ analytics }: { analytics: Analytics }) {
  const money = useMoney()
  const { user, can } = useSession()
  const [adding, setAdding] = useState(false)

  const expenses = useLiveQuery(
    () => expensesIn(analytics.range),
    [analytics.range.from, analytics.range.to],
    [] as OperatingExpense[],
  )

  // Names for the codes the recorded expenses point at, switched-off ones
  // included: history has to stay readable.
  const categories = useLiveQuery(() => listExpenseCategories(true), [], [] as ExpenseCategoryEntry[])

  const staff = useLiveQuery(async () => {
    const rows = await db.users.toArray()
    return rows.filter((row) => row.deletedAt === null)
  }, [], [] as User[])

  const pnl = useMemo(
    () =>
      buildProfitAndLoss({
        grossSales: analytics.grossRevenue,
        tax: analytics.taxTotal,
        costOfGoods: analytics.cogsTotal,
        uncostedSales: analytics.lumpSumRevenue,
        expenses,
      }),
    [analytics, expenses],
  )

  const mayEdit = can('report.export') || can('settings.edit')

  return (
    <section className="rounded-2xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Profit and loss</h2>
          <p className="text-[0.8125rem] text-ink-subtle">{analytics.range.label}</p>
        </div>
        {mayEdit ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Record a cost
          </Button>
        ) : null}
      </header>

      <div className="space-y-1 px-4 py-4">
        <Line label="Sales" value={money(pnl.grossSales)} />
        {pnl.tax > 0 ? <Line label="Less: tax collected" value={`−${money(pnl.tax)}`} muted /> : null}
        <Line label="Net sales" value={money(pnl.netSales)} strong />

        <div className="pt-2">
          <Line label="Less: cost of ingredients and packaging" value={`−${money(pnl.costOfGoods)}`} muted />
        </div>

        <Total
          label="Gross profit"
          value={money(pnl.grossProfit)}
          detail={`${Math.round(pnl.grossMarginPercent)}% of net sales`}
          tone={pnl.grossProfit >= 0 ? 'positive' : 'danger'}
        />

        {pnl.byCategory.length > 0 ? (
          <div className="space-y-1 pt-3">
            {pnl.byCategory.map((entry) => (
              <Line
                key={entry.category}
                label={`Less: ${entry.label.toLowerCase()}`}
                value={`−${money(entry.amount)}`}
                muted
              />
            ))}
          </div>
        ) : (
          <p className="pt-3 text-[0.8125rem] text-ink-subtle">
            No running costs recorded for this period, so the figure below is still only gross profit.
          </p>
        )}

        <Total
          label="Net profit"
          value={money(pnl.netProfit)}
          detail={
            pnl.totalExpenses > 0
              ? `After ${money(pnl.totalExpenses)} of running costs`
              : 'Nothing deducted yet'
          }
          tone={pnl.netProfit > 0 ? 'positive' : pnl.netProfit < 0 ? 'danger' : 'default'}
          emphasis
        />

        {pnl.hasUncostedSales ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-3 text-[0.8125rem] text-warning">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {money(pnl.uncostedSales)} of these sales were entered as a day's takings, with no record of what
              those cups cost to make. Their revenue counts here, but the cost of ingredients line does not include
              them, so gross profit is flattered by that amount.
            </span>
          </p>
        ) : null}
      </div>

      {expenses.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <h3 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle">
            Costs recorded in this period
          </h3>
          <ul className="divide-y divide-line">
            {expenses.map((expense) => (
              <li key={expense.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{expense.label}</span>
                  <span className="block text-xs text-ink-subtle">
                    {nameOf(categories, expense.category)} · {expense.kind === 'FIXED' ? 'fixed' : 'variable'} ·{' '}
                    {new Date(expense.occurredAt).toLocaleDateString()}
                    {expense.staffId
                      ? ` · ${staff.find((entry) => entry.id === expense.staffId)?.name ?? 'staff'}`
                      : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-sm text-ink">{money(expense.amount)}</span>
                  {mayEdit ? (
                    <button
                      type="button"
                      onClick={() =>
                        void removeExpense({ expense, userId: user?.id ?? '', reason: 'Removed from reports' })
                          .then(() => toast.success('Removed.'))
                          .catch(() => toast.error('That could not be removed.'))
                      }
                      className="rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                      aria-label={`Remove ${expense.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {adding ? <ExpenseForm staff={staff} onClose={() => setAdding(false)} /> : null}
    </section>
  )
}

function Line({
  label,
  value,
  muted,
  strong,
}: {
  label: string
  value: string
  muted?: boolean
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className={cn(muted ? 'text-ink-muted' : strong ? 'font-medium text-ink' : 'text-ink')}>{label}</span>
      <span className={cn('tabular', muted ? 'text-ink-muted' : strong ? 'font-medium text-ink' : 'text-ink')}>
        {value}
      </span>
    </div>
  )
}

function Total({
  label,
  value,
  detail,
  tone,
  emphasis,
}: {
  label: string
  value: string
  detail: string
  tone: 'positive' | 'danger' | 'default'
  emphasis?: boolean
}) {
  return (
    <div className={cn('mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-2')}>
      <span>
        <span className={cn('block font-medium text-ink', emphasis && 'text-base')}>{label}</span>
        <span className="block text-[0.8125rem] text-ink-subtle">{detail}</span>
      </span>
      <span
        className={cn(
          'tabular font-semibold',
          emphasis ? 'text-2xl' : 'text-lg',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** Recording rent, wages, or anything else that leaves the bank. */
function ExpenseForm({ staff, onClose }: { staff: User[]; onClose: () => void }) {
  const { user } = useSession()
  // The shop's own categories. Switched-off ones are still readable, so an
  // expense filed under one that is no longer offered still says what it was.
  const categories = useLiveQuery(() => listExpenseCategories(), [], [] as ExpenseCategoryEntry[])
  const [category, setCategory] = useState<string>('')
  const chosen = categories.find((entry) => entry.code === category) ?? categories[0]
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [staffId, setStaffId] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)

  const numeric = Number(amount.replace(/[^\d.]/g, ''))
  const ready = Number.isFinite(numeric) && numeric > 0 && !busy

  async function save(): Promise<void> {
    if (!ready || !user) return
    setBusy(true)
    try {
      // Midday, so a date typed here lands on that day whatever the timezone.
      const at = new Date(`${date}T12:00:00`).getTime()
      await recordExpense({
        category: chosen?.code ?? 'OTHER',
        label,
        amount: fromDecimal(numeric),
        kind: chosen?.kind ?? 'VARIABLE',
        staffId: chosen?.code === 'PAYROLL' && staffId ? staffId : null,
        occurredAt: Number.isFinite(at) ? at : Date.now(),
        userId: user.id,
      })
      toast.success('Recorded.')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 border-t border-line bg-surface-sunken px-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">Record a running cost</h3>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cancel">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categories.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setCategory(entry.code)}
            className={cn(
              'rounded-lg border px-2 py-2 text-xs font-medium transition-colors press no-select',
              chosen?.code === entry.code
                ? 'border-brand bg-brand text-brand-ink'
                : 'border-line bg-surface text-ink-muted hover:text-ink',
            )}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What was it for?" hint="Optional.">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={chosen?.name ?? 'What was it?'}
            maxLength={80}
          />
        </Field>
        <Field label="Amount">
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="tabular text-right"
            autoFocus
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        {category === 'PAYROLL' ? (
          <Field label="Who for?" hint="Optional. Lets you see pay per person.">
            <select
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[0.9375rem] text-ink focus:border-brand focus:outline-none"
            >
              <option value="">Everyone</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <p className="text-[0.8125rem] text-ink-subtle">
        Recorded as {chosen?.kind === 'FIXED' ? 'fixed overhead' : 'a variable cost'} — it comes off profit
        for whichever period the date falls in.
      </p>

      <Button full onClick={() => void save()} disabled={!ready}>
        {busy ? 'Recording…' : 'Record it'}
      </Button>
    </div>
  )
}
