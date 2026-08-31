import { useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { useLiveQuery } from 'dexie-react-hooks'
import { LockKeyhole, Plus, Printer, X } from 'lucide-react'
import { fromDecimal, type ExpenseCategoryEntry, type Shift } from '@pos/shared'
import { buildEndOfDay, endOfShiftLines } from '../db/endOfDay.ts'
import { recordExpense } from '../db/expenses.ts'
import { listExpenseCategories, nameOf } from '../db/shopLists.ts'
import { printerConfig } from '../db/receipts.ts'
import { printLinesInBrowser } from '../print/printing.ts'
import { findOpenShift } from './shift.ts'
import { CloseShiftSheet } from '../screens/reports/ShiftPanel.tsx'
import { Button, Field, Input } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings } from '../app/providers.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Closing up, from the till.
 *
 * Everything here is worked out from what was actually rung up - nothing is
 * typed in. The lump-sum box exists for days the system never saw; a day it did
 * see should never be re-keyed by hand, because a hand-typed total is the one
 * figure nobody can check afterwards.
 *
 * Ending the day is the Z reading, the same one the Shift tab takes. There is
 * only one way to close a shift, whichever screen you start from.
 */
export function EndOfShiftSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const money = useMoney()
  const { user, can } = useSession()
  const { settings } = useSettings()
  const [closing, setClosing] = useState(false)
  const [addingExpense, setAddingExpense] = useState(false)

  const summary = useLiveQuery(() => (open ? buildEndOfDay(new Date()) : undefined), [open])
  // The shop's own categories, including any switched off, so an expense filed
  // under one that is no longer offered still reads as what it was.
  const categories = useLiveQuery(() => listExpenseCategories(true), [], [] as ExpenseCategoryEntry[])
  const shift = useLiveQuery(() => (open ? findOpenShift() : undefined), [open]) as Shift | null | undefined

  const mayClose = can('shift.zreading') || can('shift.close')

  return (
    <>
      {/* One sheet at a time: two stacked overlays double-darken the screen
          and fight over which one has the keyboard. */}
      <Sheet open={open && !closing} onClose={onClose} title="End of shift">
        {!summary ? (
          <p className="mt-4 text-sm text-ink-muted">Working it out…</p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-[0.8125rem] text-ink-muted">
              Everything below is counted from today&rsquo;s orders. Nothing here is typed in.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Tile label="Cups sold" value={String(summary.cups)} />
              <Tile label="Snacks sold" value={String(summary.snacks)} />
            </div>

            <Group title="What the cups were">
              {summary.analytics.cupsBySize.length === 0 ? (
                <Empty>No cups itemised today.</Empty>
              ) : (
                summary.analytics.cupsBySize.map((entry) => (
                  <Line key={entry.size} label={entry.size} value={`${entry.quantity}`} />
                ))
              )}
              {summary.cups > countOf(summary.analytics.cupsBySize) ? (
                <Line
                  label="Not itemised"
                  value={`${summary.cups - countOf(summary.analytics.cupsBySize)}`}
                  muted
                />
              ) : null}
            </Group>

            <Group title="What the snacks were">
              {summary.analytics.snacksByItem.length === 0 ? (
                <Empty>No snacks today.</Empty>
              ) : (
                summary.analytics.snacksByItem.map((entry) => (
                  <Line key={entry.name} label={entry.name} value={`${entry.quantity}`} />
                ))
              )}
            </Group>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-[0.8125rem] font-medium text-ink-muted">Today&rsquo;s expenses</h3>
                {!addingExpense ? (
                  <button
                    type="button"
                    onClick={() => setAddingExpense(true)}
                    className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[0.8125rem] text-ink-muted transition-colors hover:text-ink"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add an expense
                  </button>
                ) : null}
              </div>

              <dl className="divide-y divide-line rounded-xl border border-line">
                {summary.expenses.length === 0 ? (
                  <Empty>Nothing recorded yet.</Empty>
                ) : (
                  <>
                    {summary.expenses.map((expense) => (
                      <Line
                        key={expense.id}
                        label={expense.label.trim() || nameOf(categories, expense.category)}
                        hint={nameOf(categories, expense.category)}
                        value={money(expense.amount)}
                      />
                    ))}
                    <Line label="Total expenses" value={money(summary.pnl.totalExpenses)} strong />
                  </>
                )}
              </dl>

              {addingExpense && user ? (
                <AddExpense userId={user.id} onDone={() => setAddingExpense(false)} />
              ) : null}
            </div>

            <Group title="The money">
              <Line label="Total sales" value={money(summary.analytics.grossRevenue)} />
              <Line label="Cost of goods" value={`−${money(summary.analytics.cogsTotal)}`} muted />
              <Line
                label="Gross profit"
                value={money(summary.pnl.grossProfit)}
                strong
                tone={summary.pnl.grossProfit > 0 ? 'positive' : summary.pnl.grossProfit < 0 ? 'danger' : undefined}
              />
              {summary.pnl.totalExpenses > 0 ? (
                <Line label="Expenses" value={`−${money(summary.pnl.totalExpenses)}`} muted />
              ) : null}
              <Line
                label="Net profit"
                value={money(summary.pnl.netProfit)}
                strong
                tone={summary.pnl.netProfit > 0 ? 'positive' : summary.pnl.netProfit < 0 ? 'danger' : undefined}
              />
            </Group>

            {summary.payments.length > 0 ? (
              <Group title="How it was paid">
                {summary.payments.map((slice) => (
                  <Line key={slice.method} label={slice.label} value={money(slice.amount)} />
                ))}
              </Group>
            ) : null}

            <div className="space-y-2 pt-1">
              <Button
                variant="secondary"
                full
                disabled={!settings}
                onClick={() => {
                  if (!settings) return
                  const paperWidth = printerConfig(settings).paperWidth
                  printLinesInBrowser(
                    endOfShiftLines({ summary, branding: settings.branding, money, paperWidth }),
                    paperWidth,
                    // The picture, for the browser route. A thermal printer is
                    // sent dots instead, by the receipt path.
                    settings.branding.logoDataUrl,
                  )
                }}
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print this summary
              </Button>

              {shift && mayClose ? (
                <Button full onClick={() => setClosing(true)}>
                  <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                  End the day
                </Button>
              ) : null}

              {shift && !mayClose ? (
                <p className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-ink-muted">
                  You can see the figures but not close the day. A supervisor takes the Z reading.
                </p>
              ) : null}

              {shift === null ? (
                <p className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-ink-muted">
                  No shift is open, so there is nothing to close. The figures above still stand.
                </p>
              ) : null}

              <Button variant="secondary" full onClick={onClose}>
                Not yet
              </Button>
            </div>

            <p className="text-[0.8125rem] text-ink-subtle">
              Ending the day counts the drawer and takes the Z reading. It cannot be undone.
            </p>
          </div>
        )}
      </Sheet>

      {shift ? (
        <CloseShiftSheet
          shift={shift}
          open={closing}
          onClose={() => setClosing(false)}
          onDone={() => {
            setClosing(false)
            onClose()
          }}
        />
      ) : null}
    </>
  )
}

/**
 * Recording what the day cost, without leaving the till.
 *
 * Closing time is when someone actually remembers the delivery driver was paid
 * in cash. Sending them off to find the profit and loss screen is how a cost
 * ends up never recorded at all.
 */
function AddExpense({ userId, onDone }: { userId: string; onDone: () => void }) {
  const categories = useLiveQuery(() => listExpenseCategories(), [], [] as ExpenseCategoryEntry[])
  const [category, setCategory] = useState<string>('')
  const chosen = categories.find((entry) => entry.code === category) ?? categories[0]
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const value = Number(amount.replace(/[^\d.]/g, ''))
  const valid = Number.isFinite(value) && value > 0

  async function save(): Promise<void> {
    if (!valid || busy) return
    setBusy(true)
    try {
      await recordExpense({
        category: chosen?.code ?? 'OTHER',
        label: label.trim() || chosen?.name || 'Expense',
        amount: fromDecimal(value),
        kind: chosen?.kind ?? 'VARIABLE',
        staffId: null,
        note: '',
        occurredAt: Date.now(),
        userId,
      })
      toast.success('Expense recorded.')
      setLabel('')
      setAmount('')
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line p-3">
      <div className="grid grid-cols-3 gap-1.5">
        {categories.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setCategory(entry.code)}
            className={cn(
              'rounded-lg border px-2 py-1.5 text-[0.6875rem] font-medium transition-colors press',
              chosen?.code === entry.code ? 'border-brand bg-brand-soft text-ink' : 'border-line text-ink-muted',
            )}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Field label="What was it?" className="min-w-0 flex-1">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={chosen?.name ?? 'What was it?'}
            className="h-10"
            maxLength={40}
          />
        </Field>
        <Field label="How much?" className="w-28">
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="h-10 text-right"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={!valid || busy}>
          {busy ? 'Saving…' : 'Record it'}
        </Button>
      </div>
    </div>
  )
}

const countOf = (rows: Array<{ quantity: number }>): number =>
  rows.reduce((sum, row) => sum + row.quantity, 0)

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-sunken px-3.5 py-3">
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{value}</p>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[0.8125rem] font-medium text-ink-muted">{title}</h3>
      <dl className="divide-y divide-line rounded-xl border border-line">{children}</dl>
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3.5 py-2.5 text-[0.8125rem] text-ink-subtle">{children}</p>
}

function Line({
  label,
  hint,
  value,
  strong = false,
  muted = false,
  tone,
}: {
  label: string
  hint?: string
  value: string
  strong?: boolean
  muted?: boolean
  /** Colour by what the number means, never by which row it sits on. */
  tone?: 'positive' | 'danger'
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2">
      <dt className="min-w-0">
        <span className={cn('block truncate text-[0.9375rem]', strong ? 'font-medium text-ink' : 'text-ink')}>
          {label}
        </span>
        {hint ? <span className="block text-[0.6875rem] text-ink-subtle">{hint}</span> : null}
      </dt>
      <dd
        className={cn(
          'tabular shrink-0 text-[0.9375rem]',
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

function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[94dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface px-5 pb-6 pt-5 shadow-overlay animate-slide-up pad-safe-bottom sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-3xl sm:border"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Close className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-sunken" aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
