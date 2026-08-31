import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { ClipboardCheck, Pencil, Trash2, TruckIcon, X } from 'lucide-react'
import {
  costOf,
  formatQuantity,
  fromDecimal,
  toBase,
  UNITS,
  unitDimension,
  type Ingredient,
  type MovementType,
  type Unit,
} from '@pos/shared'
import { db } from '../../db/database.ts'
import { stockOnHand } from '../../db/repo.ts'
import {
  MOVEMENT_LABELS,
  receiveStock,
  recordMovement,
  recordStockCount,
} from '../../db/inventory.ts'
import { findOpenShift } from '../../pos/shift.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { cn, clockTime } from '../../lib/utils.ts'

/**
 * One stock item: what is on hand, what it is worth, and everything that has
 * happened to it.
 *
 * The history is the point. A number on its own invites the question "why is
 * it that?", and this screen answers it without anyone having to guess.
 */

type Action = 'RECEIVE' | 'WASTE' | 'ADJUST' | 'COUNT'

const ACTIONS: Array<{ value: Action; label: string; icon: typeof TruckIcon }> = [
  { value: 'RECEIVE', label: 'Delivery', icon: TruckIcon },
  { value: 'WASTE', label: 'Wastage', icon: Trash2 },
  { value: 'ADJUST', label: 'Adjust', icon: Pencil },
  { value: 'COUNT', label: 'Count', icon: ClipboardCheck },
]

const WASTE_TYPES: MovementType[] = ['WASTAGE', 'SPOILAGE', 'DAMAGE']

export function IngredientSheet({
  ingredient,
  open,
  onClose,
  onEdit,
}: {
  ingredient: Ingredient | null
  open: boolean
  onClose: () => void
  onEdit: (ingredient: Ingredient) => void
}) {
  const money = useMoney()
  const { user, can } = useSession()

  const [action, setAction] = useState<Action | null>(null)
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<Unit>('g')
  const [cost, setCost] = useState('')
  const [reason, setReason] = useState('')
  const [wasteType, setWasteType] = useState<MovementType>('WASTAGE')
  const [busy, setBusy] = useState(false)

  const onHand = useLiveQuery(
    () => (ingredient ? stockOnHand(ingredient.id) : Promise.resolve(0)),
    [ingredient?.id],
    0,
  )

  const movements = useLiveQuery(
    async () => {
      if (!ingredient) return []
      const rows = await db.inventoryMovements.where('ingredientId').equals(ingredient.id).toArray()
      return rows
        .filter((row) => row.deletedAt === null)
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .slice(0, 40)
    },
    [ingredient?.id],
    [],
  )

  const staff = useLiveQuery(async () => {
    const rows = await db.users.toArray()
    return new Map(rows.map((row) => [row.id, row.name]))
  }, [], new Map<string, string>())

  // Only units that measure the same kind of thing make sense here.
  const availableUnits = useMemo(
    () => (ingredient ? UNITS.filter((entry) => unitDimension(entry) === ingredient.dimension) : []),
    [ingredient],
  )

  useEffect(() => {
    if (!open || !ingredient) return
    setAction(null)
    setQuantity('')
    setCost('')
    setReason('')
    setWasteType('WASTAGE')
    setUnit(ingredient.displayUnit)
  }, [open, ingredient])

  if (!ingredient) return null

  const numeric = Number(quantity.replace(/[^\d.-]/g, ''))
  const validQuantity = Number.isFinite(numeric) && numeric !== 0
  const needsReason = action === 'WASTE' || action === 'ADJUST'
  const canSubmit =
    validQuantity && (!needsReason || reason.trim().length > 0) && !busy && (action !== 'COUNT' || numeric >= 0)

  const value = costOf(Math.max(0, onHand ?? 0), ingredient.costRate)
  const low = ingredient.trackStock && (onHand ?? 0) <= ingredient.lowStockThresholdBase

  async function submit(): Promise<void> {
    if (!canSubmit || !user || !ingredient) return
    setBusy(true)
    try {
      const shift = await findOpenShift()
      const shiftId = shift?.id ?? null

      if (action === 'RECEIVE') {
        const totalCost = cost.trim() ? fromDecimal(Number(cost.replace(/[^\d.]/g, ''))) : undefined
        const result = await receiveStock({
          ingredient,
          quantity: Math.abs(numeric),
          unit,
          totalCost,
          reason,
          userId: user.id,
          shiftId,
        })
        toast.success(
          result.newCostRate === ingredient.costRate
            ? 'Delivery recorded.'
            : 'Delivery recorded, and the cost has been updated.',
        )
      } else if (action === 'COUNT') {
        const result = await recordStockCount({
          ingredient,
          countedQuantity: Math.abs(numeric),
          unit,
          reason,
          userId: user.id,
          shiftId,
        })
        toast.success(
          result.difference === 0
            ? 'Counted, and it matches the records exactly.'
            : `Counted. The books were out by ${formatQuantity(Math.abs(result.difference), ingredient.dimension)}.`,
        )
      } else {
        // Wastage always removes; an adjustment goes whichever way was typed.
        const signed = action === 'WASTE' ? -Math.abs(numeric) : numeric
        await recordMovement({
          ingredient,
          type: action === 'WASTE' ? wasteType : 'MANUAL_ADJUSTMENT',
          quantity: signed,
          unit,
          reason,
          userId: user.id,
          shiftId,
        })
        toast.success(action === 'WASTE' ? 'Wastage recorded.' : 'Stock adjusted.')
      }

      setAction(null)
      setQuantity('')
      setCost('')
      setReason('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  const mayAdjust = can('inventory.adjust')
  const mayReceive = can('inventory.receive')
  const mayWaste = can('inventory.wastage')

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[30rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:animate-slide-in-right">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold text-ink">
                {ingredient.name}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-ink-muted">
                {money(costOf(toBase(1, ingredient.displayUnit), ingredient.costRate))} per{' '}
                {ingredient.displayUnit}
              </Dialog.Description>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {mayAdjust ? (
                <Button variant="ghost" size="icon" onClick={() => onEdit(ingredient)} aria-label="Edit item">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X className="h-5 w-5" aria-hidden="true" />
                </Button>
              </Dialog.Close>
            </div>
          </header>

          <div className="scroll-pane flex-1 space-y-5 px-5 py-5">
            <section className="grid grid-cols-2 gap-3">
              <div className={cn('rounded-2xl px-4 py-3', low ? 'bg-warning/10' : 'bg-surface-sunken')}>
                <p className="text-[0.8125rem] text-ink-muted">On hand</p>
                <p className={cn('tabular text-2xl font-semibold', low ? 'text-warning' : 'text-ink')}>
                  {ingredient.trackStock ? formatQuantity(onHand ?? 0, ingredient.dimension) : '—'}
                </p>
              </div>
              <div className="rounded-2xl bg-surface-sunken px-4 py-3">
                <p className="text-[0.8125rem] text-ink-muted">Value</p>
                <p className="tabular text-2xl font-semibold text-ink">{money(value)}</p>
              </div>
            </section>

            {low && ingredient.trackStock ? (
              <p className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] text-warning">
                At or below the reorder level of{' '}
                {formatQuantity(ingredient.lowStockThresholdBase, ingredient.dimension)}.
              </p>
            ) : null}

            {mayAdjust || mayReceive || mayWaste ? (
              <section className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {ACTIONS.map(({ value: entry, label, icon: Icon }) => {
                    const allowed =
                      entry === 'RECEIVE' ? mayReceive : entry === 'WASTE' ? mayWaste : mayAdjust
                    return (
                      <button
                        key={entry}
                        type="button"
                        disabled={!allowed}
                        onClick={() => setAction(action === entry ? null : entry)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors press disabled:opacity-40',
                          action === entry
                            ? 'border-brand bg-brand-soft'
                            : 'border-line hover:border-line-strong',
                        )}
                      >
                        <Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                        <span className="text-xs font-medium text-ink">{label}</span>
                      </button>
                    )
                  })}
                </div>

                {action ? (
                  <div className="space-y-4 rounded-2xl border border-line bg-surface-sunken p-4">
                    {action === 'WASTE' ? (
                      <div className="grid grid-cols-3 gap-2">
                        {WASTE_TYPES.map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setWasteType(type)}
                            className={cn(
                              'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                              wasteType === type
                                ? 'border-brand bg-brand text-brand-ink'
                                : 'border-line bg-surface text-ink-muted',
                            )}
                          >
                            {MOVEMENT_LABELS[type]}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex gap-2">
                      <Field
                        label={
                          action === 'COUNT'
                            ? 'Counted quantity'
                            : action === 'ADJUST'
                              ? 'Change (use a minus to remove)'
                              : 'Quantity'
                        }
                        className="flex-1"
                      >
                        <Input
                          value={quantity}
                          onChange={(event) => setQuantity(event.target.value)}
                          inputMode="decimal"
                          placeholder="0"
                          className="tabular text-right"
                          autoFocus
                        />
                      </Field>
                      <Field label="Unit" className="w-28">
                        <select
                          value={unit}
                          onChange={(event) => setUnit(event.target.value as Unit)}
                          className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[0.9375rem] text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
                        >
                          {availableUnits.map((entry) => (
                            <option key={entry} value={entry}>
                              {entry}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    {action === 'RECEIVE' ? (
                      <Field
                        label="What the delivery cost (optional)"
                        hint="Leave blank to keep the current cost. Entering it re-prices the stock."
                      >
                        <Input
                          value={cost}
                          onChange={(event) => setCost(event.target.value)}
                          inputMode="decimal"
                          placeholder="0.00"
                          className="tabular text-right"
                        />
                      </Field>
                    ) : null}

                    <Field
                      label={needsReason ? 'Reason' : 'Note (optional)'}
                      hint={needsReason ? 'Kept in the audit trail.' : undefined}
                    >
                      <Input
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={
                          action === 'RECEIVE'
                            ? 'e.g. supplier, invoice number'
                            : action === 'WASTE'
                              ? 'e.g. spilled, past its date'
                              : action === 'COUNT'
                                ? 'e.g. end of week count'
                                : 'e.g. correcting a mis-key'
                        }
                        maxLength={140}
                      />
                    </Field>

                    {action === 'COUNT' && validQuantity ? (
                      <p className="text-[0.8125rem] text-ink-muted">
                        The records say{' '}
                        <span className="tabular">{formatQuantity(onHand ?? 0, ingredient.dimension)}</span>. This
                        will record a difference of{' '}
                        <span className="tabular font-medium text-ink">
                          {formatQuantity(toBase(Math.abs(numeric), unit) - (onHand ?? 0), ingredient.dimension)}
                        </span>
                        .
                      </p>
                    ) : null}

                    <Button full onClick={() => void submit()} disabled={!canSubmit}>
                      {busy ? 'Saving…' : 'Record it'}
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-[0.8125rem] font-medium text-ink-muted">History</h3>
              {movements.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-subtle">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {movements.map((movement) => (
                    <li key={movement.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm text-ink">{MOVEMENT_LABELS[movement.type]}</span>
                        <span className="block truncate text-xs text-ink-subtle">
                          {new Date(movement.occurredAt).toLocaleDateString()} {clockTime(movement.occurredAt)}
                          {staff?.get(movement.userId) ? ` · ${staff.get(movement.userId)}` : ''}
                          {movement.reason ? ` · ${movement.reason}` : ''}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'tabular shrink-0 text-sm font-medium',
                          movement.baseQuantity < 0 ? 'text-danger' : 'text-positive',
                        )}
                      >
                        {movement.baseQuantity > 0 ? '+' : '−'}
                        {formatQuantity(Math.abs(movement.baseQuantity), ingredient.dimension)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
