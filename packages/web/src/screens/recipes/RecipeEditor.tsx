import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { Plus, Search, Trash2, X } from 'lucide-react'
import {
  costOf,
  fromDecimal,
  naturalUnit,
  toBase,
  UNITS,
  unitDimension,
  type Ingredient,
  type Product,
  type ProductVariant,
  type Unit,
} from '@pos/shared'
import { db } from '../../db/database.ts'
import {
  costRecipe,
  loadRecipeFor,
  priceForMargin,
  saveRecipe,
  updateVariantPrice,
  type RecipeComponent,
} from '../../db/recipes.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Building a recipe, with the cost of it visible the whole time.
 *
 * Quantities are typed in whatever unit suits the ingredient and stored in the
 * base unit, so a recipe written in grams and a sack bought in kilos always
 * agree. The costing panel updates on every keystroke, because the question
 * "what does that do to my margin?" should never need a save first.
 */

interface DraftComponent extends RecipeComponent {
  /** The unit the person is typing in, which is not necessarily the base. */
  unit: Unit
  quantity: number
}

export function RecipeEditor({
  product,
  variant,
  open,
  onClose,
}: {
  product: Product
  variant: ProductVariant
  open: boolean
  onClose: () => void
}) {
  const money = useMoney()
  const { settings } = useSettings()
  const { user, can } = useSession()

  const [components, setComponents] = useState<DraftComponent[]>([])
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const ingredients = useLiveQuery(async () => {
    const rows = await db.ingredients.toArray()
    return rows
      .filter((row) => row.deletedAt === null && row.active)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [], [] as Ingredient[])

  const ingredientsById = useMemo(
    () => new Map((ingredients ?? []).map((entry) => [entry.id, entry])),
    [ingredients],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoaded(false)

    void (async () => {
      const { recipe, components: saved } = await loadRecipeFor(variant.id)
      if (cancelled) return
      setComponents(
        saved.map((component) => {
          const ingredient = ingredientsById.get(component.ingredientId)
          const unit = ingredient
            ? naturalUnit(component.baseQuantity, ingredient.dimension)
            : 'g'
          return {
            ...component,
            unit,
            quantity: component.baseQuantity / toBase(1, unit),
          }
        }),
      )
      setNotes(recipe?.notes ?? '')
      setPrice((variant.price / 100).toFixed(2))
      setLoaded(true)
    })()

    return () => {
      cancelled = true
    }
  }, [open, variant.id, variant.price, ingredientsById])

  const priceMinor = useMemo(() => {
    const numeric = Number(price.replace(/[^\d.]/g, ''))
    return Number.isFinite(numeric) ? fromDecimal(numeric) : variant.price
  }, [price, variant.price])

  const breakdown = useMemo(
    () =>
      costRecipe(
        components.map((component) => ({
          ingredientId: component.ingredientId,
          baseQuantity: component.baseQuantity,
          optional: component.optional,
        })),
        ingredientsById,
        priceMinor,
        settings?.tax,
        { includeLabour: settings?.includeLabourInCost },
      ),
    [components, ingredientsById, priceMinor],
  )

  const chosen = new Set(components.map((component) => component.ingredientId))
  const searchResults = (ingredients ?? []).filter((ingredient) => {
    if (chosen.has(ingredient.id)) return false
    const term = search.trim().toLowerCase()
    if (!term) return true
    return ingredient.name.toLowerCase().includes(term) || ingredient.sku.toLowerCase().includes(term)
  })

  function addIngredient(ingredient: Ingredient): void {
    setComponents((current) => [
      ...current,
      {
        ingredientId: ingredient.id,
        unit: naturalUnit(0, ingredient.dimension),
        quantity: 0,
        baseQuantity: 0,
        optional: false,
      },
    ])
    setPicking(false)
    setSearch('')
  }

  function setQuantity(ingredientId: string, raw: string): void {
    const numeric = Number(raw.replace(/[^\d.]/g, ''))
    setComponents((current) =>
      current.map((component) =>
        component.ingredientId === ingredientId
          ? {
              ...component,
              quantity: Number.isFinite(numeric) ? numeric : 0,
              baseQuantity: Number.isFinite(numeric) ? toBase(numeric, component.unit) : 0,
            }
          : component,
      ),
    )
  }

  function setUnit(ingredientId: string, unit: Unit): void {
    setComponents((current) =>
      current.map((component) =>
        component.ingredientId === ingredientId
          ? { ...component, unit, baseQuantity: toBase(component.quantity, unit) }
          : component,
      ),
    )
  }

  function remove(ingredientId: string): void {
    setComponents((current) => current.filter((component) => component.ingredientId !== ingredientId))
  }

  const canEdit = can('recipe.edit')
  const canPrice = can('product.price')

  async function save(): Promise<void> {
    if (!user || busy) return
    const empty = components.find((component) => component.baseQuantity <= 0)
    if (empty) {
      toast.error(`Give ${ingredientsById.get(empty.ingredientId)?.name ?? 'every ingredient'} a quantity.`)
      return
    }

    setBusy(true)
    try {
      await saveRecipe({
        variant,
        components: components.map((component) => ({
          ingredientId: component.ingredientId,
          baseQuantity: component.baseQuantity,
          optional: component.optional,
        })),
        notes,
        userId: user.id,
      })

      if (canPrice && priceMinor !== variant.price) {
        await updateVariantPrice({ variant, price: priceMinor, userId: user.id })
      }

      toast.success('Recipe saved.')
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
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[32rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:animate-slide-in-right">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold text-ink">
                {product.name}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-ink-muted">{variant.name}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane flex-1 space-y-5 px-5 py-5">
            {/* Costing, kept at the top because it is the reason to be here. */}
            <section className="space-y-3 rounded-2xl border border-line bg-surface-sunken p-4">
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Cost" value={money(breakdown.cogs)} />
                <Metric label="Profit" value={money(breakdown.grossProfit)} />
                <Metric
                  label="Margin"
                  value={`${Math.round(breakdown.marginPercent)}%`}
                  tone={
                    breakdown.marginPercent >= 60
                      ? 'positive'
                      : breakdown.marginPercent >= 40
                        ? 'default'
                        : 'danger'
                  }
                />
              </div>

              <div className="flex items-baseline justify-between border-t border-line pt-3 text-[0.8125rem]">
                <span className="text-ink-muted">Ingredients</span>
                <span className="tabular text-ink">{money(breakdown.ingredientCost)}</span>
              </div>
              <div className="flex items-baseline justify-between text-[0.8125rem]">
                <span className="text-ink-muted">Packaging</span>
                <span className="tabular text-ink">{money(breakdown.packagingCost)}</span>
              </div>
              {breakdown.otherCost > 0 ? (
                <div className="flex items-baseline justify-between text-[0.8125rem]">
                  <span className="text-ink-muted">Resale items</span>
                  <span className="tabular text-ink">{money(breakdown.otherCost)}</span>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between text-[0.8125rem]">
                <span className="text-ink-muted">Markup on cost</span>
                <span className="tabular text-ink">{Math.round(breakdown.markupPercent)}%</span>
              </div>
            </section>

            <section className="space-y-2">
              <Field label="Selling price">
                <Input
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  inputMode="decimal"
                  disabled={!canPrice}
                  className="tabular text-right text-lg"
                />
              </Field>
              {canPrice && breakdown.cogs > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {[60, 65, 70, 75].map((target) => {
                    const suggestion = priceForMargin(breakdown.cogs, target)
                    return (
                      <button
                        key={target}
                        type="button"
                        onClick={() => setPrice((suggestion / 100).toFixed(2))}
                        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-brand hover:text-ink"
                      >
                        {target}% margin → <span className="tabular font-medium">{money(suggestion)}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </section>

            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-[0.8125rem] font-medium text-ink-muted">
                  What goes into it{components.length > 0 ? ` (${components.length})` : ''}
                </h3>
                {canEdit ? (
                  <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add
                  </Button>
                ) : null}
              </div>

              {!loaded ? (
                <p className="py-6 text-center text-sm text-ink-subtle">Loading…</p>
              ) : components.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
                  <p className="text-sm text-ink-muted">No recipe yet.</p>
                  <p className="mt-1 text-[0.8125rem] text-ink-subtle">
                    Without one, selling this deducts nothing from stock.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {components.map((component) => {
                    const ingredient = ingredientsById.get(component.ingredientId)
                    const cost = ingredient ? costOf(component.baseQuantity, ingredient.costRate) : 0
                    const units = ingredient
                      ? UNITS.filter((entry) => unitDimension(entry) === ingredient.dimension)
                      : []

                    return (
                      <li
                        key={component.ingredientId}
                        className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {ingredient?.name ?? 'Unknown'}
                          </span>
                          <span className="tabular block text-xs text-ink-subtle">
                            {money(cost)}
                            {breakdown.cogs > 0
                              ? ` · ${Math.round((cost / breakdown.cogs) * 100)}% of cost`
                              : ''}
                          </span>
                        </span>

                        <input
                          value={component.quantity === 0 ? '' : String(component.quantity)}
                          onChange={(event) => setQuantity(component.ingredientId, event.target.value)}
                          inputMode="decimal"
                          placeholder="0"
                          disabled={!canEdit}
                          className="tabular h-10 w-20 rounded-lg border border-line bg-surface px-2 text-right text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-60"
                        />

                        <select
                          value={component.unit}
                          onChange={(event) => setUnit(component.ingredientId, event.target.value as Unit)}
                          disabled={!canEdit}
                          className="h-10 w-16 rounded-lg border border-line bg-surface px-1.5 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-60"
                        >
                          {units.map((entry) => (
                            <option key={entry} value={entry}>
                              {entry}
                            </option>
                          ))}
                        </select>

                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => remove(component.ingredientId)}
                            className="shrink-0 rounded-lg p-2 text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                            aria-label={`Remove ${ingredient?.name ?? 'ingredient'}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {canEdit ? (
              <Field label="Method notes" hint="For whoever makes it.">
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. steam the milk to 65°C, pour over the caramel"
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
                />
              </Field>
            ) : null}
          </div>

          {canEdit || canPrice ? (
            <footer className="border-t border-line px-5 py-4 pad-safe-bottom">
              <Button size="lg" full onClick={() => void save()} disabled={busy || !loaded}>
                {busy ? 'Saving…' : 'Save recipe'}
              </Button>
            </footer>
          ) : null}

          {/* Ingredient picker, layered over the editor. */}
          {picking ? (
            <div className="absolute inset-0 z-10 flex flex-col rounded-t-3xl bg-surface sm:rounded-l-3xl sm:rounded-tr-none">
              <header className="flex items-center gap-2 border-b border-line px-5 py-4 pad-safe-top">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                    aria-hidden="true"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search ingredients"
                    autoFocus
                    className="h-11 w-full rounded-xl border border-line bg-canvas pl-10 pr-3 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setPicking(false)
                    setSearch('')
                  }}
                  aria-label="Cancel"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </Button>
              </header>

              <div className="scroll-pane flex-1">
                {searchResults.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-ink-subtle">
                    {search ? 'Nothing matches that.' : 'Everything is already in this recipe.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {searchResults.map((ingredient) => (
                      <li key={ingredient.id}>
                        <button
                          type="button"
                          onClick={() => addIngredient(ingredient)}
                          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-sunken"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-ink">
                              {ingredient.name}
                            </span>
                            <span className="block text-xs text-ink-subtle">
                              {ingredient.stockClass === 'PACKAGING'
                                ? 'Packaging'
                                : ingredient.stockClass === 'RETAIL'
                                  ? 'Resale'
                                  : 'Ingredient'}
                            </span>
                          </span>
                          <span className="tabular shrink-0 text-[0.8125rem] text-ink-muted">
                            {money(costOf(toBase(1, ingredient.displayUnit), ingredient.costRate))}/
                            {ingredient.displayUnit}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'positive' | 'danger'
}) {
  return (
    <div>
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
      <p
        className={cn(
          'tabular text-xl font-semibold',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  )
}
