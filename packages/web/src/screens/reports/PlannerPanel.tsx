import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, KeyRound, Lock, Plus, Save, Trash2, Unlock } from 'lucide-react'
import type { FundAllocation } from '@pos/shared'
import { newId } from '@pos/shared'
import {
  actualSalesFor,
  buildPlan,
  DEFAULT_ALLOCATIONS,
  loadTarget,
  periodKeyFor,
  periodLabel,
  plannerIsLocked,
  removePlannerPasscode,
  saveTarget,
  setPlannerPasscode,
  shiftPeriod,
  unlockPlanner,
} from '../../db/planner.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Target sales, and where the money is going before it arrives.
 *
 * The point is not the target itself but the set-asides underneath it: a month
 * that hits target and still leaves nothing for stock has not really worked.
 * Each share is a percentage, so the plan holds its shape when the target
 * moves, and both columns are shown - what the target would give, and what has
 * actually been earned so far.
 */
export function PlannerPanel() {
  const { can } = useSession()
  const locked = useLiveQuery(() => plannerIsLocked(), [], undefined)
  const [unlocked, setUnlocked] = useState(false)

  if (!can('planner.manage')) {
    return (
      <p className="px-4 py-10 text-center text-sm text-ink-muted">
        Your role cannot see the planner. An owner or manager can.
      </p>
    )
  }

  if (locked === undefined) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  if (locked && !unlocked) return <LockCard onUnlock={() => setUnlocked(true)} />

  return <Planner locked={locked} onLockAgain={() => setUnlocked(false)} />
}

/** The gate from the owner's own system, kept because a shared till is a shared screen. */
function LockCard({ onUnlock }: { onUnlock: () => void }) {
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function attempt(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (await unlockPlanner(passcode)) {
        setPasscode('')
        onUnlock()
      } else {
        setError('That passcode is not right.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="mt-3 text-base font-semibold text-ink">The planner is locked</h2>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">
          Targets and set-asides are behind a passcode of their own, so they are not readable by whoever the till is
          left open in front of.
        </p>

        <form
          className="mt-4 space-y-3 text-left"
          onSubmit={(event) => {
            event.preventDefault()
            void attempt()
          }}
        >
          <Field label="Passcode" error={error || null}>
            <Input
              autoFocus
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="••••••"
            />
          </Field>
          <Button full type="submit" disabled={busy || passcode.length === 0}>
            <Unlock className="h-4 w-4" aria-hidden="true" />
            Unlock the planner
          </Button>
        </form>
      </div>
    </div>
  )
}

function Planner({ locked, onLockAgain }: { locked: boolean; onLockAgain: () => void }) {
  const money = useMoney()
  const { user } = useSession()

  const [periodKey, setPeriodKey] = useState(() => periodKeyFor())
  const [target, setTarget] = useState('')
  const [allocations, setAllocations] = useState<FundAllocation[]>(DEFAULT_ALLOCATIONS)
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [managing, setManaging] = useState(false)

  const saved = useLiveQuery(() => loadTarget(periodKey), [periodKey], undefined)
  const actual = useLiveQuery(() => actualSalesFor(periodKey), [periodKey], { sales: 0, orders: 0 })

  // Loading a different month replaces the form; typing in it does not.
  useEffect(() => {
    if (saved === undefined) return
    setTarget(saved ? (saved.targetSales / 100).toFixed(2) : '')
    setAllocations(saved ? saved.allocations : DEFAULT_ALLOCATIONS)
    setNote(saved?.note ?? '')
    setDirty(false)
  }, [saved, periodKey])

  const targetMinor = Math.round(Number(target || 0) * 100)

  const plan = useMemo(
    () =>
      buildPlan({
        periodKey,
        targetSales: targetMinor,
        allocations,
        actualSales: actual.sales,
        orders: actual.orders,
      }),
    [periodKey, targetMinor, allocations, actual.sales, actual.orders],
  )

  function change(id: string, changes: Partial<FundAllocation>): void {
    setAllocations((rows) => rows.map((row) => (row.id === id ? { ...row, ...changes } : row)))
    setDirty(true)
  }

  async function save(): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      await saveTarget({ periodKey, targetSales: targetMinor, allocations, note, userId: user.id })
      setDirty(false)
      toast.success(`Plan saved for ${periodLabel(periodKey)}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The plan could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const over = plan.allocatedPercent > 100
  const progressPercent = Math.min(100, Math.round(plan.progress * 100))

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPeriodKey((key) => shiftPeriod(key, -1))}
              className="rounded-xl p-2 text-ink-muted hover:bg-surface-sunken"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <h2 className="min-w-[9rem] text-center text-base font-semibold text-ink">{periodLabel(periodKey)}</h2>
            <button
              type="button"
              onClick={() => setPeriodKey((key) => shiftPeriod(key, 1))}
              className="rounded-xl p-2 text-ink-muted hover:bg-surface-sunken"
              aria-label="Next month"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex gap-1">
            {locked ? (
              <Button variant="ghost" onClick={onLockAgain}>
                <Lock className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Lock</span>
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setManaging(true)}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{locked ? 'Passcode' : 'Add a passcode'}</span>
            </Button>
          </div>
        </div>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <Field label="Target sales for the month" hint="What you are aiming to take, before any costs.">
            <Input
              inputMode="decimal"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value)
                setDirty(true)
              }}
              placeholder="0.00"
            />
          </Field>

          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[0.8125rem] text-ink-muted">
                Taken so far · {plan.orders} {plan.orders === 1 ? 'order' : 'orders'}
              </p>
              <p className="tabular text-lg font-semibold text-ink">{money(plan.actualSales)}</p>
            </div>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress towards the target"
            >
              <div
                className={cn('h-full rounded-full', plan.progress >= 1 ? 'bg-positive' : 'bg-brand')}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[0.8125rem] text-ink-subtle">
              {/* With no target there is nothing to be a percentage of, so it says so. */}
              <span>{targetMinor > 0 ? `${progressPercent}% of target` : 'No target set for this month'}</span>
              <span>
                {targetMinor > 0 ? (plan.remaining > 0 ? `${money(plan.remaining)} to go` : 'Target met') : ''}
              </span>
            </div>
          </div>

          {targetMinor > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Small
                label={`Needed per day (${plan.daysInPeriod - plan.daysElapsed} left)`}
                value={money(plan.neededPerRemainingDay)}
              />
              <Small label="On track to finish at" value={money(plan.projected)} />
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h3 className="text-sm font-medium text-ink">Where the money goes</h3>
              <p className="text-[0.8125rem] text-ink-subtle">
                Each share of the target, and what it is worth on what has actually come in.
              </p>
            </div>
            <span
              className={cn(
                'tabular shrink-0 text-sm font-medium',
                over ? 'text-danger' : 'text-ink-muted',
              )}
            >
              {plan.allocatedPercent}%
            </span>
          </div>

          <ul className="divide-y divide-line">
            {allocations.map((entry) => {
              const row = plan.rows.find((candidate) => candidate.id === entry.id)
              return (
                <li key={entry.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={entry.label}
                      onChange={(event) => change(entry.id, { label: event.target.value })}
                      className="h-10 flex-1"
                      aria-label="What this is for"
                    />
                    <div className="relative w-20 shrink-0">
                      <Input
                        inputMode="decimal"
                        value={String(entry.percent)}
                        onChange={(event) => change(entry.id, { percent: Number(event.target.value) || 0 })}
                        className="h-10 pr-6 text-right"
                        aria-label={`${entry.label} share`}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.8125rem] text-ink-subtle">
                        %
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAllocations((rows) => rows.filter((candidate) => candidate.id !== entry.id))
                        setDirty(true)
                      }}
                      className="rounded-xl p-2 text-ink-subtle hover:bg-surface-sunken hover:text-danger"
                      aria-label={`Remove ${entry.label}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex justify-between text-[0.8125rem]">
                    <span className="text-ink-subtle">On target</span>
                    <span className="tabular text-ink-muted">{money(row?.planned ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-[0.8125rem]">
                    <span className="text-ink-subtle">Earned so far</span>
                    <span className="tabular font-medium text-ink">{money(row?.earned ?? 0)}</span>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
            <Button
              variant="ghost"
              onClick={() => {
                setAllocations((rows) => [...rows, { id: newId(), label: '', percent: 0 }])
                setDirty(true)
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a set-aside
            </Button>
          </div>

          <div className="border-t border-line bg-surface-sunken px-4 py-3">
            {over ? (
              <p className="text-[0.8125rem] text-danger">
                The set-asides come to {plan.allocatedPercent}% — more than the whole target. Bring them under 100%
                before saving.
              </p>
            ) : (
              <>
                <div className="flex justify-between text-[0.9375rem]">
                  <span className="text-ink-muted">Left over ({plan.unallocatedPercent}%)</span>
                  <span className="tabular font-semibold text-ink">{money(plan.unallocatedPlanned)}</span>
                </div>
                <div className="mt-0.5 flex justify-between text-[0.8125rem]">
                  <span className="text-ink-subtle">Of what has actually come in</span>
                  <span className="tabular text-ink-muted">{money(plan.unallocatedEarned)}</span>
                </div>
              </>
            )}
          </div>
        </section>

        <Field label="Note" hint="Anything about this month worth remembering later.">
          <Input
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              setDirty(true)
            }}
            placeholder="Fiesta week, aircon repair due…"
          />
        </Field>

        <Button full onClick={() => void save()} disabled={busy || over || !dirty}>
          <Save className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Saving…' : dirty ? 'Save the plan' : 'Saved'}
        </Button>

        <p className="pb-2 text-center text-[0.8125rem] text-ink-subtle">
          Targets are per month and kept, so last month's plan is still here to compare against.
        </p>
      </div>

      <PasscodeSheet
        open={managing}
        locked={locked}
        onClose={() => setManaging(false)}
      />
    </div>
  )
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-sunken px-3 py-2.5">
      <p className="tabular text-base font-semibold text-ink">{value}</p>
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
    </div>
  )
}

/** Setting, changing or removing the planner's own passcode. */
function PasscodeSheet({
  open,
  locked,
  onClose,
}: {
  open: boolean
  locked: boolean
  onClose: () => void
}) {
  const { user } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setCurrent('')
      setNext('')
    }
  }, [open])

  if (!open) return null

  async function run(action: 'SET' | 'REMOVE'): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      if (action === 'SET') {
        await setPlannerPasscode({ passcode: next, current, userId: user.id })
        toast.success('Passcode saved.')
      } else {
        await removePlannerPasscode({ current, userId: user.id })
        toast.success('Passcode removed.')
      }
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 animate-fade-in sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-3xl border-t border-line bg-surface p-5 pad-safe-bottom animate-slide-up sm:rounded-3xl sm:border">
        <h3 className="text-lg font-semibold text-ink">{locked ? 'Planner passcode' : 'Add a passcode'}</h3>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">
          It is stored scrambled, the same way a PIN is — so a passcode that is forgotten cannot be looked up, only
          replaced by someone who knows the current one.
        </p>

        <div className="mt-4 space-y-3">
          {locked ? (
            <Field label="Current passcode">
              <Input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} />
            </Field>
          ) : null}
          <Field label={locked ? 'New passcode' : 'Passcode'} hint="At least four characters.">
            <Input type="password" value={next} onChange={(event) => setNext(event.target.value)} />
          </Field>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {locked ? (
            <Button
              variant="danger"
              onClick={() => void run('REMOVE')}
              disabled={busy || current.length === 0}
            >
              Remove
            </Button>
          ) : null}
          <Button className="flex-1" onClick={() => void run('SET')} disabled={busy || next.length < 4}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
