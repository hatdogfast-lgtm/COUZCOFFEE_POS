import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChefHat, Search, TriangleAlert, X } from 'lucide-react'
import type { Product, ProductVariant } from '@pos/shared'
import { db } from '../db/database.ts'
import { costRecipe, type RecipeComponent } from '../db/recipes.ts'
import { Badge, EmptyState } from '../components/ui/primitives.tsx'
import { useMoney, useSettings } from '../app/providers.tsx'
import { RecipeEditor } from './recipes/RecipeEditor.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Recipes and margins.
 *
 * One row per sellable size, because that is the level at which both the
 * recipe and the price actually exist. The margin column is the reason anyone
 * opens this screen, so it is not hidden behind a tap.
 */

interface Row {
  product: Product
  variant: ProductVariant
  categoryName: string
  components: RecipeComponent[]
  hasRecipe: boolean
  cogs: number
  /** The price with tax taken out - what the shop actually keeps. */
  netPrice: number
  /** Tax sitting inside the shelf price, which is never profit. */
  taxInPrice: number
  margin: number
}

export function RecipesScreen() {
  const { settings } = useSettings()
  const money = useMoney()
  const [search, setSearch] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [editing, setEditing] = useState<{ product: Product; variant: ProductVariant } | null>(null)

  const data = useLiveQuery(async () => {
    const [products, variants, recipes, recipeIngredients, ingredients, categories] = await Promise.all([
      db.products.toArray(),
      db.productVariants.toArray(),
      db.recipes.toArray(),
      db.recipeIngredients.toArray(),
      db.ingredients.toArray(),
      db.categories.toArray(),
    ])

    const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
      rows.filter((row) => row.deletedAt === null)

    const ingredientsById = new Map(alive(ingredients).map((entry) => [entry.id, entry]))
    const categoryNames = new Map(alive(categories).map((entry) => [entry.id, entry.name]))
    const recipeByVariant = new Map(
      alive(recipes)
        .filter((entry) => entry.active)
        .map((entry) => [entry.variantId, entry]),
    )

    const componentsByRecipe = new Map<string, RecipeComponent[]>()
    for (const row of alive(recipeIngredients).sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = componentsByRecipe.get(row.recipeId) ?? []
      list.push({
        ingredientId: row.ingredientId,
        baseQuantity: row.baseQuantity,
        optional: row.optional,
      })
      componentsByRecipe.set(row.recipeId, list)
    }

    return {
      products: alive(products).filter((entry) => entry.active),
      variants: alive(variants).filter((entry) => entry.active),
      recipeByVariant,
      componentsByRecipe,
      ingredientsById,
      categoryNames,
    }
  }, [])

  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    const productsById = new Map(data.products.map((entry) => [entry.id, entry]))
    const term = search.trim().toLowerCase()

    return data.variants
      .flatMap((variant) => {
        const product = productsById.get(variant.productId)
        if (!product) return []

        const recipe = data.recipeByVariant.get(variant.id)
        const components = recipe ? (data.componentsByRecipe.get(recipe.id) ?? []) : []
        const breakdown = costRecipe(components, data.ingredientsById, variant.price, settings?.tax, {
          includeLabour: settings?.includeLabourInCost,
        })

        return [
          {
            product,
            variant,
            categoryName: data.categoryNames.get(product.categoryId) ?? '',
            components,
            hasRecipe: components.length > 0,
            cogs: breakdown.cogs,
            netPrice: breakdown.netPrice,
            taxInPrice: breakdown.taxInPrice,
            margin: breakdown.marginPercent,
          },
        ]
      })
      .filter((row) => {
        if (onlyMissing && row.hasRecipe) return false
        if (!term) return true
        return (
          row.product.name.toLowerCase().includes(term) ||
          row.variant.name.toLowerCase().includes(term) ||
          row.categoryName.toLowerCase().includes(term)
        )
      })
      .sort((a, b) => {
        if (a.hasRecipe !== b.hasRecipe) return a.hasRecipe ? 1 : -1
        const byProduct = a.product.sortOrder - b.product.sortOrder
        return byProduct !== 0 ? byProduct : a.variant.sortOrder - b.variant.sortOrder
      })
  }, [data, search, onlyMissing])

  const missingCount = useMemo(
    () => (data ? rows.filter((row) => !row.hasRecipe).length : 0),
    [data, rows],
  )

  if (!data) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 border-b border-line bg-surface px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products"
            className="h-11 w-full rounded-xl border border-line bg-canvas pl-10 pr-9 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-subtle hover:bg-surface-sunken"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {missingCount > 0 || onlyMissing ? (
          <button
            type="button"
            onClick={() => setOnlyMissing((value) => !value)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-[0.8125rem] transition-colors',
              onlyMissing ? 'bg-warning/20 text-warning' : 'bg-warning/10 text-warning hover:bg-warning/15',
            )}
          >
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              {onlyMissing
                ? 'Showing only sizes with no recipe.'
                : `${missingCount} ${missingCount === 1 ? 'size has' : 'sizes have'} no recipe, so nothing is deducted from stock when sold.`}
            </span>
            <span className="shrink-0 font-medium underline">{onlyMissing ? 'Show all' : 'Show them'}</span>
          </button>
        ) : null}
      </div>

      <div className="scroll-pane flex-1">
        {rows.length === 0 ? (
          <EmptyState
            icon={<ChefHat className="h-8 w-8" aria-hidden="true" />}
            title={search ? 'Nothing matches that search' : 'No products yet'}
            description={search ? 'Try a different word.' : 'Add products to build recipes for them.'}
          />
        ) : (
          <>
            {/* A table on a counter screen; stacked cards on a phone. */}
            <div className="hidden grid-cols-[1fr_7rem_7rem_7rem_7rem_5rem] gap-3 border-b border-line px-4 py-2 text-xs font-medium text-ink-muted lg:grid">
              <span>Product</span>
              <span className="text-right">Price</span>
              <span className="text-right">Net of tax</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Profit</span>
              <span className="text-right">Margin</span>
            </div>

            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.variant.id}>
                  <button
                    type="button"
                    onClick={() => setEditing({ product: row.product, variant: row.variant })}
                    className="grid w-full grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-sunken lg:grid-cols-[1fr_7rem_7rem_7rem_7rem_5rem] lg:items-center"
                  >
                    <span className="col-span-2 min-w-0 lg:col-span-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[0.9375rem] font-medium text-ink">
                          {row.product.name}
                        </span>
                        <span className="shrink-0 text-[0.8125rem] text-ink-muted">{row.variant.name}</span>
                        {!row.hasRecipe ? <Badge tone="warning">No recipe</Badge> : null}
                      </span>
                      <span className="block text-[0.8125rem] text-ink-subtle">
                        {row.categoryName}
                        {row.hasRecipe ? ` · ${row.components.length} ingredients` : ''}
                      </span>
                    </span>

                    <Cell label="Price" value={money(row.variant.price)} />
                    <Cell
                      label="Net of tax"
                      value={row.taxInPrice > 0 ? money(row.netPrice) : '—'}
                      muted
                    />
                    <Cell label="Cost" value={row.hasRecipe ? money(row.cogs) : '—'} muted />
                    <Cell
                      label="Profit"
                      value={row.hasRecipe ? money(row.netPrice - row.cogs) : '—'}
                    />
                    <span className="text-right lg:contents">
                      <span className="lg:hidden">
                        <span className="block text-[0.6875rem] text-ink-subtle">Margin</span>
                      </span>
                      <span
                        className={cn(
                          'tabular block text-right text-[0.9375rem] font-semibold',
                          !row.hasRecipe
                            ? 'text-ink-subtle'
                            : row.margin >= 60
                              ? 'text-positive'
                              : row.margin >= 40
                                ? 'text-ink'
                                : 'text-danger',
                        )}
                      >
                        {row.hasRecipe ? `${Math.round(row.margin)}%` : '—'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {editing ? (
        <RecipeEditor
          product={editing.product}
          variant={editing.variant}
          open
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}

function Cell({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <span className="text-right">
      <span className="block text-[0.6875rem] text-ink-subtle lg:hidden">{label}</span>
      <span
        className={cn('tabular block text-[0.9375rem]', muted ? 'text-ink-muted' : 'text-ink')}
      >
        {value}
      </span>
    </span>
  )
}
