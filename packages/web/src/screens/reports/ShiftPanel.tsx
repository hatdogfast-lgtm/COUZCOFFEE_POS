import { useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { Banknote, ClipboardList, FileText, LockKeyhole, Play } from 'lucide-react'
import type { CashMovementType, Shift } from '@pos/shared'
import {
  buildReading,
  CASH_MOVEMENT_LABELS,
  listCashMovements,
  listReadings,
  parseReading,
  recordCashMovement,
  runXReading,
  runZReading,
  type ReadingSnapshot,
} from '../../db/readings.ts'
import { findOpenShift, openShift } from '../../pos/shift.ts'
import { Badge, Button, EmptyState, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { ReadingSheet } from './ReadingSheet.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * The shift, and the readings taken off it.
 *
 * The running figures at the top are a live X reading in all but name - they
 * are computed the same way, so nothing changes between glancing at the screen
 * and taking the reading. Closing is the one irreversible act here, so it asks
 * for the counted cash first and refuses a discrepancy that nobody explains.
 */
export function ShiftPanel() {
  const money = useMoney()
  const { user, can } = useSession()
  const [viewing, setViewing] = useState<ReadingSnapshot | null>(null)
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)

  const shift = useLiveQuery(() => findOpenShift(), [], undefined)

  const running = useLiveQuery(
    async () => (shift && user ? buildReading({ shift, type: 'X', user }) : null),
    [shift?.id, shift?.updatedAt, user?.id],
    null,
  )

  const movements = useLiveQuery(
    () => (shift ? listCashMovements(shift.id) : Promise.resolve([])),
    [shift?.id],
    [],
  )

  const history = useLiveQuery(() => listReadings(30), [], [])

  async function open(float: number): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      await openShift(user, Math.round(float))
      toast.success('Shift open.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The shift could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  async function takeX(): Promise<void> {
    if (!shift || !user || busy) return
    setBusy(true)
    try {
      setViewing(await runXReading(shift, user))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The reading could not be taken.')
    } finally {
      setBusy(false)
    }
  }

  if (shift === undefined) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {shift === null ? (
          <OpenShiftCard onOpen={open} busy={busy} allowed={can('shift.open')} />
        ) : (
          <>
            <section className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-ink">{shift.code}</h2>
                    <Badge tone="online">Open</Badge>
                  </div>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
                    Since {new Date(shift.openedAt).toLocaleString()} · float {money(shift.openingFloat)}
                  </p>
                </div>
              </div>

              {running ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <Tile label="Sales so far" value={money(running.totalSales)} lead />
                    <Tile label="Transactions" value={String(running.transactions)} />
                    <Tile label="Cups sold" value={String(running.cupsSold)} />
                    <Tile label="Snacks sold" value={String(running.snacksSold)} />
                    <Tile label="Expected in drawer" value={money(running.cash.expectedCash)} />
                  </div>

                  {running.payments.length > 0 ? (
                    <ul className="mt-3 space-y-1">
                      {running.payments.map((line) => (
                        <li key={line.key} className="flex justify-between text-[0.8125rem]">
                          <span className="text-ink-muted">
                            {line.label} <span className="text-ink-subtle">({line.count})</span>
                          </span>
                          <span className="tabular text-ink">{money(line.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {can('shift.xreading') ? (
                  <Button variant="secondary" onClick={() => void takeX()} disabled={busy}>
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Take an X reading
                  </Button>
                ) : null}
                {can('shift.zreading') || can('shift.close') ? (
                  <Button onClick={() => setClosing(true)} disabled={busy}>
                    <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                    Close with a Z reading
                  </Button>
                ) : null}
              </div>

              <p className="mt-2 text-[0.8125rem] text-ink-subtle">
                An X reading changes nothing and can be taken as often as you like. The Z reading closes the shift,
                and there is only one.
              </p>
            </section>

            {can('cash.pettycash') ? (
              <CashDrawerCard shift={shift} movements={movements} />
            ) : null}
          </>
        )}

        <section className="rounded-2xl border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-medium text-ink">Past readings</h2>
          {history.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-8 w-8" aria-hidden="true" />}
              title="No readings yet"
              description="Once you take one it is kept here, exactly as it read at the time."
            />
          ) : (
            <ul className="divide-y divide-line">
              {history.map(({ row, snapshot }) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setViewing(parseReading(row))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <Badge tone={snapshot.type === 'Z' ? 'brand' : 'neutral'}>
                          {snapshot.type} #{snapshot.sequence}
                        </Badge>
                        <span className="truncate text-[0.9375rem] text-ink">{snapshot.shiftCode}</span>
                      </span>
                      <span className="block truncate text-[0.8125rem] text-ink-subtle">
                        {new Date(snapshot.takenAt).toLocaleString()} · {snapshot.takenByName}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm text-ink">{money(snapshot.totalSales)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ReadingSheet snapshot={viewing} open={viewing !== null} onClose={() => setViewing(null)} />
      {shift ? (
        <CloseShiftSheet shift={shift} open={closing} onClose={() => setClosing(false)} onDone={setViewing} />
      ) : null}
    </div>
  )
}

function OpenShiftCard({
  onOpen,
  busy,
  allowed,
}: {
  onOpen: (float: number) => Promise<void>
  busy: boolean
  allowed: boolean
}) {
  const [float, setFloat] = useState('')

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">No shift is open</h2>
      <p className="mt-1 text-[0.8125rem] text-ink-muted">
        Count what is in the drawer before you start. That figure is what the closing count is measured against, so
        a guess here becomes a discrepancy later.
      </p>
      {allowed ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Opening float" className="min-w-[10rem] flex-1">
            <Input
              inputMode="decimal"
              value={float}
              onChange={(event) => setFloat(event.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Button onClick={() => void onOpen(Math.round(Number(float || 0) * 100))} disabled={busy}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Open the shift
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-[0.8125rem] text-ink-subtle">Your role cannot open a shift.</p>
      )}
    </section>
  )
}

const MOVEMENT_TYPES: CashMovementType[] = ['PETTY_CASH', 'CASH_DROP', 'PAY_IN', 'PAY_OUT']

function CashDrawerCard({
  shift,
  movements,
}: {
  shift: Shift
  movements: Awaited<ReturnType<typeof listCashMovements>>
}) {
  const money = useMoney()
  const { user } = useSession()
  const [type, setType] = useState<CashMovementType>('PETTY_CASH')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function record(): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      await recordCashMovement({
        shift,
        type,
        amount: Math.round(Number(amount || 0) * 100),
        reason,
        user,
      })
      setAmount('')
      setReason('')
      toast.success('Recorded.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-sm font-medium text-ink">Money in and out of the drawer</h2>
      <p className="mt-1 text-[0.8125rem] text-ink-muted">
        Anything that is not a sale. Recording it here is what keeps the closing count honest.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MOVEMENT_TYPES.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setType(entry)}
            className={cn(
              'rounded-xl border px-3 py-2 text-[0.8125rem] font-medium transition-colors press',
              type === entry ? 'border-brand bg-brand-soft text-ink' : 'border-line text-ink-muted hover:border-line-strong',
            )}
          >
            {CASH_MOVEMENT_LABELS[entry]}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Amount" className="w-32">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="What for" className="min-w-[12rem] flex-1">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Milk run, change fund…"
          />
        </Field>
        <Button variant="secondary" onClick={() => void record()} disabled={busy}>
          <Banknote className="h-4 w-4" aria-hidden="true" />
          Record
        </Button>
      </div>

      {movements.length > 0 ? (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {movements.map((movement) => (
            <li key={movement.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[0.8125rem]">
              <span className="min-w-0">
                <span className="text-ink">{CASH_MOVEMENT_LABELS[movement.type]}</span>
                <span className="block truncate text-ink-subtle">{movement.reason}</span>
              </span>
              <span className={cn('tabular shrink-0', movement.type === 'PAY_IN' ? 'text-positive' : 'text-ink')}>
                {movement.type === 'PAY_IN' ? '+' : '−'}
                {money(movement.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/**
 * Counting the drawer, then closing. The preview is the reading that will be kept.
 *
 * Exported because the till closes the day too: one close flow with two ways in
 * beats two flows that drift apart.
 */
export function CloseShiftSheet({
  shift,
  open,
  onClose,
  onDone,
}: {
  shift: Shift
  open: boolean
  onClose: () => void
  onDone: (snapshot: ReadingSnapshot) => void
}) {
  const money = useMoney()
  const { user } = useSession()
  const [counted, setCounted] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const preview = useLiveQuery(
    async () => (open && user ? buildReading({ shift, type: 'Z', user }) : null),
    [open, shift.id, user?.id],
    null,
  )

  const countedMinor = counted.trim() === '' ? null : Math.round(Number(counted) * 100)
  const expected = preview?.cash.expectedCash ?? 0
  const variance = countedMinor === null ? null : countedMinor - expected
  const needsReason = variance !== null && variance !== 0

  async function close(): Promise<void> {
    if (!user || countedMinor === null || busy) return
    setBusy(true)
    try {
      const snapshot = await runZReading({
        shift,
        user,
        countedCash: countedMinor,
        varianceReason: reason,
      })
      toast.success('Shift closed.')
      onClose()
      setCounted('')
      setReason('')
      onDone(snapshot)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The shift could not be closed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmSheet open={open} onClose={onClose} title="Close the shift" busy={busy}>
      <p className="text-[0.8125rem] text-ink-muted">
        Count the drawer and enter what is actually in it. Closing takes the Z reading, and cannot be undone.
      </p>

      <dl className="mt-4 space-y-1">
        <Line label="Sales this shift" value={money(preview?.totalSales ?? 0)} />
        <Line label="Cash sales" value={money(preview?.cash.cashSales ?? 0)} />
        <Line label="Opening float" value={money(preview?.cash.openingFloat ?? 0)} />
        <Line label="Expected in drawer" value={money(expected)} strong />
      </dl>

      <Field label="Counted cash" className="mt-4">
        <Input
          autoFocus
          inputMode="decimal"
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
          placeholder="0.00"
        />
      </Field>

      {variance !== null ? (
        <p
          className={cn(
            'mt-2 rounded-xl px-3 py-2 text-[0.8125rem]',
            variance === 0 ? 'bg-positive/10 text-positive' : 'bg-danger/10 text-danger',
          )}
        >
          {variance === 0
            ? 'The drawer balances.'
            : `${variance > 0 ? 'Over' : 'Short'} by ${money(Math.abs(variance))}.`}
        </p>
      ) : null}

      {needsReason ? (
        <Field label="Why does it not balance?" className="mt-3">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Miscount at handover, wrong change given…"
          />
        </Field>
      ) : null}

      <Button
        full
        className="mt-4"
        onClick={() => void close()}
        disabled={busy || countedMinor === null || (needsReason && reason.trim().length === 0)}
      >
        <LockKeyhole className="h-4 w-4" aria-hidden="true" />
        {busy ? 'Closing…' : 'Take the Z reading and close'}
      </Button>
    </ConfirmSheet>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[0.9375rem]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn('tabular', strong ? 'font-semibold text-ink' : 'text-ink')}>{value}</dd>
    </div>
  )
}

function Tile({ label, value, lead }: { label: string; value: string; lead?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-sunken px-3 py-2.5">
      <p className={cn('font-semibold text-ink', lead ? 'text-xl' : 'text-lg')}>{value}</p>
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
    </div>
  )
}

/** A small modal shell, so the close flow does not need its own file. */
function ConfirmSheet({
  open,
  onClose,
  title,
  busy,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  busy: boolean
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 max-h-[94dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface px-5 pb-6 pt-5 shadow-overlay animate-slide-up pad-safe-bottom sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-3xl sm:border">
          <Dialog.Title className="text-lg font-semibold text-ink">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
