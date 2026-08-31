import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import {
  costOf,
  costRateFromPurchase,
  fromDecimal,
  toBase,
  UNITS,
  unitDimension,
  type AuditLog,
  type Ingredient,
  type InventoryMovement,
  type StockClass,
  type Unit,
} from '@pos/shared'
import { commit, created, revise, stamp, updated } from '../../db/write.ts'
import type { PendingWrite } from '../../db/write.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Creating and editing a stock item.
 *
 * Cost is asked for the way it is actually bought — "a 1 kg bag for 850" —
 * rather than as a rate per gram. The rate is what gets stored, but nobody
 * should have to work it out on the back of an invoice.
 */

const CLASSES: Array<{ value: StockClass; label: string; blurb: string }> = [
  { value: 'INGREDIENT', label: 'Ingredient', blurb: 'Goes into a recipe' },
  { value: 'PACKAGING', label: 'Packaging', blurb: 'Cups, lids, straws' },
  { value: 'RETAIL', label: 'Resale', blurb: 'Sold as it is bought' },
]

export function IngredientEditor({
  ingredient,
  open,
  onClose,
}: {
  ingredient: Ingredient | null
  open: boolean
  onClose: () => void
}) {
  const money = useMoney()
  const { user } = useSession()

  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [stockClass, setStockClass] = useState<StockClass>('INGREDIENT')
  const [unit, setUnit] = useState<Unit>('g')
  const [purchaseQty, setPurchaseQty] = useState('1')
  const [purchaseCost, setPurchaseCost] = useState('')
  const [lowStock, setLowStock] = useState('')
  const [openingQty, setOpeningQty] = useState('')
  const [trackStock, setTrackStock] = useState(true)
  const [busy, setBusy] = useState(false)

  const editing = ingredient !== null

  useEffect(() => {
    if (!open) return
    if (ingredient) {
      setName(ingredient.name)
      setSku(ingredient.sku)
      setStockClass(ingredient.stockClass)
      setUnit(ingredient.displayUnit)
      setPurchaseQty('1')
      // Show what one display unit costs, which is what the rate means.
      setPurchaseCost(
        (costOf(toBase(1, ingredient.displayUnit), ingredient.costRate) / 100).toFixed(2),
      )
      setLowStock(
        String(ingredient.lowStockThresholdBase / toBase(1, ingredient.displayUnit) || 0),
      )
      setOpeningQty('')
      setTrackStock(ingredient.trackStock)
    } else {
      setName('')
      setSku('')
      setStockClass('INGREDIENT')
      setUnit('g')
      setPurchaseQty('1')
      setPurchaseCost('')
      setLowStock('')
      setOpeningQty('')
      setTrackStock(true)
    }
  }, [open, ingredient])

  const quantityNumber = Number(purchaseQty.replace(/[^\d.]/g, ''))
  const costNumber = Number(purchaseCost.replace(/[^\d.]/g, ''))
  const validCost = Number.isFinite(quantityNumber) && quantityNumber > 0 && Number.isFinite(costNumber)

  const costRate = validCost
    ? costRateFromPurchase(fromDecimal(costNumber), quantityNumber, unit)
    : (ingredient?.costRate ?? 0)

  const ready = name.trim().length > 0 && validCost && !busy

  async function save(): Promise<void> {
    if (!ready || !user) return
    setBusy(true)
    try {
      const now = Date.now()
      const writes: PendingWrite[] = []
      const lowBase = Number(lowStock.replace(/[^\d.]/g, ''))
      const lowStockThresholdBase =
        Number.isFinite(lowBase) && lowBase > 0 ? toBase(lowBase, unit) : 0

      if (ingredient) {
        const revised = revise(
          ingredient,
          {
            name: name.trim(),
            sku: sku.trim(),
            stockClass,
            dimension: unitDimension(unit),
            displayUnit: unit,
            costRate,
            lowStockThresholdBase,
            trackStock,
          },
          now,
        )
        writes.push(updated('ingredients', revised))

        if (ingredient.costRate !== costRate) {
          writes.push(
            created(
              'auditLogs',
              stamp<AuditLog>({
                entityType: 'ingredients',
                entityId: ingredient.id,
                action: 'COST_CHANGED',
                userId: user.id,
                before: JSON.stringify({ costRate: ingredient.costRate }),
                after: JSON.stringify({ costRate }),
                reason: 'Edited by hand',
                occurredAt: now,
              }),
            ),
          )
        }
      } else {
        const record = stamp<Ingredient>({
          name: name.trim(),
          sku: sku.trim(),
          stockClass,
          dimension: unitDimension(unit),
          displayUnit: unit,
          costRate,
          supplierId: null,
          lowStockThresholdBase,
          trackStock,
          active: true,
        })
        writes.push(created('ingredients', record))

        const opening = Number(openingQty.replace(/[^\d.]/g, ''))
        if (Number.isFinite(opening) && opening > 0) {
          writes.push(
            created(
              'inventoryMovements',
              stamp<InventoryMovement>({
                ingredientId: record.id,
                type: 'OPENING',
                baseQuantity: toBase(opening, unit),
                costRate,
                reason: 'Opening stock',
                referenceType: null,
                referenceId: null,
                shiftId: null,
                userId: user.id,
                occurredAt: now,
              }),
            ),
          )
        }

        writes.push(
          created(
            'auditLogs',
            stamp<AuditLog>({
              entityType: 'ingredients',
              entityId: record.id,
              action: 'INGREDIENT_CREATED',
              userId: user.id,
              before: null,
              after: JSON.stringify({ name: record.name }),
              reason: '',
              occurredAt: now,
            }),
          ),
        )
      }

      await commit(writes, now)
      toast.success(editing ? 'Saved.' : 'Item added.')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-3xl sm:border sm:animate-scale-in">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="text-lg font-semibold text-ink">
              {editing ? 'Edit item' : 'New stock item'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane flex-1 space-y-4 px-5 py-5">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Oat Milk"
                autoFocus
                maxLength={80}
              />
            </Field>

            <div className="space-y-1.5">
              <span className="text-[0.8125rem] font-medium text-ink-muted">What is it?</span>
              <div className="grid grid-cols-3 gap-2">
                {CLASSES.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => setStockClass(entry.value)}
                    className={cn(
                      'rounded-xl border p-2.5 text-left transition-colors press',
                      stockClass === entry.value
                        ? 'border-brand bg-brand-soft'
                        : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="block text-sm font-medium text-ink">{entry.label}</span>
                    <span className="block text-[0.6875rem] leading-tight text-ink-subtle">
                      {entry.blurb}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 rounded-2xl border border-line bg-surface-sunken p-4">
              <span className="text-[0.8125rem] font-medium text-ink-muted">How you buy it</span>
              <div className="flex items-end gap-2">
                <Field label="Quantity" className="w-24">
                  <Input
                    value={purchaseQty}
                    onChange={(event) => setPurchaseQty(event.target.value)}
                    inputMode="decimal"
                    className="tabular text-right"
                  />
                </Field>
                <Field label="Unit" className="w-24">
                  <select
                    value={unit}
                    onChange={(event) => setUnit(event.target.value as Unit)}
                    className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[0.9375rem] text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
                  >
                    {UNITS.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="costs" className="flex-1">
                  <Input
                    value={purchaseCost}
                    onChange={(event) => setPurchaseCost(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="tabular text-right"
                  />
                </Field>
              </div>
              {validCost ? (
                <p className="pt-1 text-[0.8125rem] text-ink-muted">
                  Works out at{' '}
                  <span className="tabular font-medium text-ink">
                    {money(costOf(toBase(1, unit), costRate))}
                  </span>{' '}
                  per {unit}.
                </p>
              ) : null}
            </div>

            <Field label={`Warn me below (${unit})`} hint="Leave blank for no warning.">
              <Input
                value={lowStock}
                onChange={(event) => setLowStock(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="tabular text-right"
              />
            </Field>

            {!editing ? (
              <Field label={`Opening stock (${unit})`} hint="How much you have right now. Optional.">
                <Input
                  value={openingQty}
                  onChange={(event) => setOpeningQty(event.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="tabular text-right"
                />
              </Field>
            ) : null}

            <button
              type="button"
              onClick={() => setTrackStock((value) => !value)}
              className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left"
            >
              <span>
                <span className="block text-sm font-medium text-ink">Track stock levels</span>
                <span className="block text-[0.8125rem] text-ink-subtle">
                  Turn off for things you never count, like tap water.
                </span>
              </span>
              <span
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                  trackStock ? 'bg-brand' : 'bg-line-strong',
                )}
              >
                <span
                  className={cn(
                    'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                    trackStock ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </span>
            </button>
          </div>

          <footer className="border-t border-line px-5 py-4 pad-safe-bottom">
            <Button size="lg" full onClick={() => void save()} disabled={!ready}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
