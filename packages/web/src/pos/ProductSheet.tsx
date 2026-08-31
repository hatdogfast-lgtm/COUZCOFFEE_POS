import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Minus, Plus, TriangleAlert, X } from 'lucide-react'
import type { ModifierOption, Product, SaleItemModifier } from '@pos/shared'
import { availabilityOf, type MenuData, type StockMap } from '../db/repo.ts'
import { currentUnitCost, type CartLine } from './checkout.ts'
import { Button } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings } from '../app/providers.tsx'
import { servingUnitOf } from '../db/till.ts'
import { cn } from '../lib/utils.ts'

/**
 * Choosing a size and any modifiers.
 *
 * Availability is recomputed against the live stock ledger as options change,
 * so an add-on that would exhaust an ingredient is caught here rather than
 * discovered when the barista reaches for an empty bottle.
 */
export function ProductSheet({
  product,
  menu,
  stock,
  open,
  onClose,
  onAdd,
}: {
  product: Product | null
  menu: MenuData
  stock: StockMap
  open: boolean
  onClose: () => void
  onAdd: (line: Omit<CartLine, 'id'>) => void
}) {
  const money = useMoney()
  const { settings } = useSettings()
  const { can } = useSession()

  const variants = useMemo(
    () => (product ? (menu.variantsByProduct.get(product.id) ?? []) : []),
    [product, menu],
  )

  const [variantId, setVariantId] = useState<string>('')
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [override, setOverride] = useState(false)

  // Reset to sensible defaults whenever a different product is opened.
  useEffect(() => {
    if (!open || !product) return
    const preferred = variants.find((variant) => variant.isDefault) ?? variants[0]
    setVariantId(preferred?.id ?? '')
    setQuantity(1)
    setNote('')
    setOverride(false)

    const defaults: Record<string, string[]> = {}
    for (const groupId of product.modifierGroupIds) {
      const options = menu.optionsByGroup.get(groupId) ?? []
      const fallback = options.find((option) => option.isDefault)
      defaults[groupId] = fallback ? [fallback.id] : []
    }
    setChosen(defaults)
  }, [open, product, variants, menu])

  const selectedOptionIds = useMemo(() => Object.values(chosen).flat(), [chosen])

  const availability = useMemo(
    () => (variantId ? availabilityOf(variantId, menu, stock) : null),
    [variantId, menu, stock],
  )

  const variant = variants.find((entry) => entry.id === variantId)

  const modifierLines = useMemo<SaleItemModifier[]>(() => {
    const result: SaleItemModifier[] = []
    for (const [groupId, optionIds] of Object.entries(chosen)) {
      const group = menu.groupsById.get(groupId)
      const options = menu.optionsByGroup.get(groupId) ?? []
      for (const optionId of optionIds) {
        const option = options.find((entry) => entry.id === optionId)
        if (!group || !option) continue
        // A default with no price effect is noise on a receipt.
        if (option.isDefault && option.priceDelta === 0) continue
        result.push({
          groupId,
          groupName: group.name,
          optionId: option.id,
          optionName: option.name,
          priceDelta: option.priceDelta,
        })
      }
    }
    return result
  }, [chosen, menu])

  const unitPrice = variant?.price ?? 0
  const modifiersTotal = modifierLines.reduce((sum, modifier) => sum + modifier.priceDelta, 0)
  const lineTotal = (unitPrice + modifiersTotal) * quantity

  const blocked =
    settings?.blockSaleWhenOutOfStock === true &&
    availability !== null &&
    availability.makeable !== Infinity &&
    availability.makeable < quantity &&
    !override

  const canOverride = can('pos.availability.override')

  function toggleOption(groupId: string, option: ModifierOption): void {
    const group = menu.groupsById.get(groupId)
    if (!group) return

    setChosen((current) => {
      const existing = current[groupId] ?? []
      if (group.selection === 'SINGLE') {
        return { ...current, [groupId]: existing.includes(option.id) && !group.required ? [] : [option.id] }
      }
      const next = existing.includes(option.id)
        ? existing.filter((id) => id !== option.id)
        : [...existing, option.id].slice(0, Math.max(1, group.maxSelections))
      return { ...current, [groupId]: next }
    })
  }

  function handleAdd(): void {
    if (!product || !variant) return
    const category = menu.categories.find((entry) => entry.id === product.categoryId)
    onAdd({
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      categoryName: category?.name ?? '',
      servingUnit: servingUnitOf(category),
      quantity,
      unitPrice: variant.price,
      modifiers: modifierLines,
      note: note.trim(),
      unitCogs: currentUnitCost(variant.id, selectedOptionIds, menu),
      taxable: product.taxable,
    })
    onClose()
  }

  if (!product) return null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay',
            'sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0',
            'animate-slide-up sm:animate-slide-in-right',
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold text-ink">{product.name}</Dialog.Title>
              {product.description ? (
                <Dialog.Description className="mt-0.5 line-clamp-2 text-sm text-ink-muted">
                  {product.description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane flex-1 space-y-6 px-5 py-5">
            {variants.length > 1 ? (
              <section className="space-y-2.5">
                <h3 className="text-[0.8125rem] font-medium text-ink-muted">Size</h3>
                <div className="grid grid-cols-3 gap-2">
                  {variants.map((entry) => {
                    const entryStock = availabilityOf(entry.id, menu, stock)
                    const soldOut = entryStock.outOfStock
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setVariantId(entry.id)}
                        className={cn(
                          'rounded-xl border px-3 py-3 text-center transition-colors press',
                          entry.id === variantId
                            ? 'border-brand bg-brand-soft'
                            : 'border-line bg-surface hover:border-line-strong',
                          soldOut && 'opacity-55',
                        )}
                      >
                        <span className="block text-sm font-medium text-ink">{entry.name}</span>
                        <span className="tabular block text-[0.8125rem] text-ink-muted">{money(entry.price)}</span>
                        {soldOut ? (
                          <span className="mt-1 block text-[0.6875rem] font-medium text-danger">Out of stock</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {product.modifierGroupIds.map((groupId) => {
              const group = menu.groupsById.get(groupId)
              const options = menu.optionsByGroup.get(groupId) ?? []
              if (!group || options.length === 0) return null
              const selected = chosen[groupId] ?? []

              return (
                <section key={groupId} className="space-y-2.5">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-[0.8125rem] font-medium text-ink-muted">{group.name}</h3>
                    <span className="text-xs text-ink-subtle">
                      {group.selection === 'MULTI' ? `Choose up to ${group.maxSelections}` : 'Choose one'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {options.map((option) => {
                      const active = selected.includes(option.id)
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleOption(groupId, option)}
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors press',
                            active ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong',
                          )}
                        >
                          <span className="truncate text-sm text-ink">{option.name}</span>
                          {option.priceDelta !== 0 ? (
                            <span className="tabular shrink-0 text-[0.8125rem] text-ink-muted">
                              +{money(option.priceDelta)}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}

            <section className="space-y-2">
              <h3 className="text-[0.8125rem] font-medium text-ink-muted">Note for the barista</h3>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. extra hot, no foam"
                maxLength={120}
                className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
              />
            </section>

            {availability && availability.makeable !== Infinity && availability.makeable < 6 ? (
              <div
                className={cn(
                  'flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[0.8125rem]',
                  availability.outOfStock ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning',
                )}
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  {availability.outOfStock
                    ? `Cannot be made - ${availability.limitingIngredient ?? 'an ingredient'} has run out.`
                    : `Enough stock for ${availability.makeable} more${availability.limitingIngredient ? ` (${availability.limitingIngredient} is lowest)` : ''}.`}
                </p>
              </div>
            ) : null}

            {blocked && canOverride ? (
              <button
                type="button"
                onClick={() => setOverride(true)}
                className="w-full rounded-xl border border-dashed border-line-strong px-3.5 py-3 text-[0.8125rem] text-ink-muted hover:bg-surface-sunken"
              >
                Sell anyway and let stock go negative
              </button>
            ) : null}
          </div>

          <footer className="space-y-3 border-t border-line bg-surface px-5 py-4 pad-safe-bottom">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 rounded-xl border border-line p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  disabled={quantity <= 1}
                  aria-label="Fewer"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span className="tabular w-10 text-center text-lg font-semibold text-ink">{quantity}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setQuantity((value) => value + 1)}
                  aria-label="More"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <div className="text-right">
                <p className="text-[0.8125rem] text-ink-muted">Line total</p>
                <p className="tabular text-xl font-semibold text-ink">{money(lineTotal)}</p>
              </div>
            </div>

            <Button size="lg" full onClick={handleAdd} disabled={!variant || blocked}>
              {blocked
                ? availability?.outOfStock
                  ? 'Out of stock'
                  : 'Not enough stock'
                : `Add to order`}
            </Button>
            {blocked && !canOverride ? (
              <p className="text-center text-xs text-ink-subtle">
                A supervisor can override this from their own sign-in.
              </p>
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
