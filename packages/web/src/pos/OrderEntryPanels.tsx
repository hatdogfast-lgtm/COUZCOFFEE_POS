import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Minus, NotebookPen, Plus } from 'lucide-react'
import { fromDecimal, type PaymentMethod } from '@pos/shared'
import { Button, Input } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings } from '../app/providers.tsx'
import { recordLumpSum } from './checkout.ts'
import { ensureShift } from './shift.ts'
import { referenceRequired } from '../db/till.ts'
import { cn } from '../lib/utils.ts'

/**
 * Entering orders that did not happen just now.
 *
 * Two different jobs sit here. Backdating an order is for one that was taken
 * while the till was unavailable and still needs its detail. A lump sum is for
 * a day that predates the system entirely, where the only surviving record is
 * a total in a notebook - so it records exactly that and nothing it would have
 * to invent.
 */

export type TimingChoice = 'NOW' | 'YESTERDAY' | 'CUSTOM'

/** A backfilled day was taken in money, so a loyalty claim has no place here. */
const LUMP_SUM_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'GCASH', label: 'GCash' },
  { value: 'MAYA', label: 'Maya' },
  { value: 'CARD', label: 'Card' },
]

function toLocalInputValue(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function yesterdayAtSameTime(now = Date.now()): number {
  return now - 24 * 60 * 60 * 1000
}

/** Choose when the order being rung up actually happened. */
export function OrderTiming({
  choice,
  customAt,
  onChoice,
  onCustomAt,
}: {
  choice: TimingChoice
  customAt: number
  onChoice: (next: TimingChoice) => void
  onCustomAt: (next: number) => void
}) {
  const options: Array<{ value: TimingChoice; label: string }> = [
    { value: 'NOW', label: 'Today (now)' },
    { value: 'YESTERDAY', label: 'Yesterday' },
    { value: 'CUSTOM', label: 'Custom' },
  ]

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        Order date and time
      </h3>

      <div className="grid grid-cols-3 gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChoice(option.value)}
            className={cn(
              'rounded-lg border px-2 py-2 text-xs font-medium transition-colors press no-select',
              choice === option.value
                ? 'border-brand bg-brand text-brand-ink'
                : 'border-line bg-surface text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {choice === 'CUSTOM' ? (
        <input
          type="datetime-local"
          value={toLocalInputValue(customAt)}
          max={toLocalInputValue(Date.now())}
          onChange={(event) => {
            const parsed = new Date(event.target.value).getTime()
            if (Number.isFinite(parsed)) onCustomAt(parsed)
          }}
          className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
        />
      ) : null}

      {choice !== 'NOW' ? (
        <p className="text-[0.8125rem] text-warning">
          This order will be recorded as happening then, not now. The time it was keyed in is kept too.
        </p>
      ) : null}
    </section>
  )
}

/**
 * Record a past day's takings as a single figure.
 *
 * Deliberately spare about what it claims: a total and a cup count, with no
 * line items and no stock movements, because a notebook total cannot tell us
 * what went into those cups. The reports keep it out of margin for the same
 * reason.
 */
export function LumpSumEntry({ defaultAt }: { defaultAt: number }) {
  const money = useMoney()
  const { settings } = useSettings()
  const { user, can } = useSession()

  const [amount, setAmount] = useState('')
  const [cups, setCups] = useState('')
  const [snacks, setSnacks] = useState('')
  const [reference, setReference] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [busy, setBusy] = useState(false)

  const amountNumber = Number(amount.replace(/[^\d.]/g, ''))
  const cupsNumber = Number(cups.replace(/[^\d]/g, '')) || 0
  const snacksNumber = Number(snacks.replace(/[^\d]/g, '')) || 0
  const needsReference = referenceRequired(settings, method)

  const step = (delta: number): void => setCups(String(Math.max(0, cupsNumber + delta)))
  const stepSnacks = (delta: number): void => setSnacks(String(Math.max(0, snacksNumber + delta)))

  const ready =
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    Number.isFinite(cupsNumber) &&
    cupsNumber >= 0 &&
    (!needsReference || reference.trim().length > 0) &&
    !busy

  // Backfilling a day's takings rewrites history, so it is its own permission
  // rather than something inherited from being able to export a report.
  if (!can('pos.backdate')) return null

  async function record(): Promise<void> {
    if (!ready || !user || !settings) return
    setBusy(true)
    try {
      const shift = await ensureShift(user)
      const sale = await recordLumpSum({
        amount: fromDecimal(amountNumber),
        cups: cupsNumber,
        snacks: snacksNumber,
        reference: reference.trim(),
        occurredAt: defaultAt,
        method,
        settings,
        cashier: user,
        shiftId: shift.id,
        note: `Takings for ${new Date(defaultAt).toLocaleDateString()}`,
      })
      toast.success(`Recorded ${money(sale.total)} for ${new Date(defaultAt).toLocaleDateString()}.`)
      setAmount('')
      setCups('')
      setSnacks('')
      setReference('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle">
        <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
        Record a past day's takings
      </h3>

      <Input
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        inputMode="decimal"
        placeholder="Sales total for the day"
        className="tabular h-10 text-right"
      />

      {/* Counted separately, because a day's cups and a day's pastries are two
          different figures and a shop that tracks one usually tracks both. */}
      <Counter
        label="Cups sold"
        value={cups}
        onValue={setCups}
        onStep={step}
        canDecrease={cupsNumber > 0}
        unit="cup"
      />
      <Counter
        label="Snacks sold"
        value={snacks}
        onValue={setSnacks}
        onStep={stepSnacks}
        canDecrease={snacksNumber > 0}
        unit="snack"
      />

      {/* How the day was taken, as buttons rather than a hidden dropdown. */}
      <div className="grid grid-cols-4 gap-1.5">
        {LUMP_SUM_METHODS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setMethod(entry.value)}
            className={cn(
              'rounded-lg border px-1 py-2 text-xs font-medium transition-colors press no-select',
              method === entry.value
                ? 'border-brand bg-brand text-brand-ink'
                : 'border-line bg-surface text-ink-muted hover:text-ink',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* Only asked for when the shop has said this method needs it, and then
          it is not optional - a wallet payment with no reference cannot be
          matched against the statement, which is the whole point of having it. */}
      {needsReference ? (
        <label className="block space-y-1">
          <span className="flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle">
            {method} reference number
            <span className="text-danger" aria-hidden="true">
              •
            </span>
            <span className="sr-only">required</span>
          </span>
          <Input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder={`Enter ${method} reference (e.g., Ref #)`}
            maxLength={40}
            className="h-10"
          />
        </label>
      ) : null}

      <Button variant="secondary" full size="sm" onClick={() => void record()} disabled={!ready}>
        {busy ? 'Recording…' : `Record ${new Date(defaultAt).toLocaleDateString()}`}
      </Button>

      <p className="text-[0.8125rem] text-ink-subtle">
        For days before this system was in use. Counts towards revenue, but is left out of margin — a notebook
        total cannot say what those cups cost to make.
      </p>
    </section>
  )
}

/** A small counter. Two of these reads better than one box holding both. */
function Counter({
  label,
  value,
  onValue,
  onStep,
  canDecrease,
  unit,
}: {
  label: string
  value: string
  onValue: (next: string) => void
  onStep: (delta: number) => void
  canDecrease: boolean
  unit: string
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-2 py-1.5">
      <span className="pl-1.5 text-[0.8125rem] text-ink-muted">{label}</span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={!canDecrease}
          className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken disabled:opacity-40"
          aria-label={`One fewer ${unit}`}
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <input
          value={value}
          onChange={(event) => onValue(event.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          placeholder="0"
          className="tabular h-8 w-14 rounded-lg border border-line bg-canvas px-1 text-center text-sm text-ink focus:border-brand focus:outline-none"
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onStep(1)}
          className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken"
          aria-label={`One more ${unit}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </span>
    </div>
  )
}
