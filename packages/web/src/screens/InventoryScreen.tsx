import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Boxes, Plus, Search, TriangleAlert, X } from 'lucide-react'
import {
  costOf,
  formatQuantity,
  type Ingredient,
  type StockClass,
} from '@pos/shared'
import { db } from '../db/database.ts'
import { stockLevels } from '../db/repo.ts'
import { Badge, Button, EmptyState } from '../components/ui/primitives.tsx'
import { useMoney, useSession } from '../app/providers.tsx'
import { IngredientSheet } from './inventory/IngredientSheet.tsx'
import { IngredientEditor } from './inventory/IngredientEditor.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Inventory.
 *
 * Sorted so that whatever is about to run out is at the top, because that is
 * the question this screen exists to answer. Everything shown here is derived
 * from the movement ledger, so it is identical on every device that has synced
 * and correct on one that has not.
 */

const CLASS_FILTERS: Array<{ value: StockClass | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Everything' },
  { value: 'INGREDIENT', label: 'Ingredients' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'RETAIL', label: 'Resale items' },
]

export function InventoryScreen() {
  const money = useMoney()
  const { can } = useSession()
  const [search, setSearch] = useState('')
  const [stockClass, setStockClass] = useState<StockClass | 'ALL'>('ALL')
  const [selected, setSelected] = useState<Ingredient | null>(null)
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null)

  const ingredients = useLiveQuery(async () => {
    const rows = await db.ingredients.toArray()
    return rows.filter((row) => row.deletedAt === null && row.active)
  }, [])

  const stock = useLiveQuery(() => stockLevels(), [], new Map<string, number>())

  const rows = useMemo(() => {
    if (!ingredients) return []
    const term = search.trim().toLowerCase()

    return ingredients
      .filter((ingredient) => {
        if (stockClass !== 'ALL' && ingredient.stockClass !== stockClass) return false
        if (!term) return true
        return (
          ingredient.name.toLowerCase().includes(term) || ingredient.sku.toLowerCase().includes(term)
        )
      })
      .map((ingredient) => {
        const onHand = stock?.get(ingredient.id) ?? 0
        const low = ingredient.trackStock && onHand <= ingredient.lowStockThresholdBase
        const out = ingredient.trackStock && onHand <= 0
        return { ingredient, onHand, low, out, value: costOf(Math.max(0, onHand), ingredient.costRate) }
      })
      // Trouble first: out of stock, then low, then alphabetical.
      .sort((a, b) => {
        if (a.out !== b.out) return a.out ? -1 : 1
        if (a.low !== b.low) return a.low ? -1 : 1
        return a.ingredient.name.localeCompare(b.ingredient.name)
      })
  }, [ingredients, stock, search, stockClass])

  const summary = useMemo(() => {
    const all = (ingredients ?? []).map((ingredient) => {
      const onHand = stock?.get(ingredient.id) ?? 0
      return {
        value: costOf(Math.max(0, onHand), ingredient.costRate),
        low: ingredient.trackStock && onHand <= ingredient.lowStockThresholdBase && onHand > 0,
        out: ingredient.trackStock && onHand <= 0,
      }
    })
    return {
      value: all.reduce((sum, entry) => sum + entry.value, 0),
      low: all.filter((entry) => entry.low).length,
      out: all.filter((entry) => entry.out).length,
    }
  }, [ingredients, stock])

  if (!ingredients) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              aria-hidden="true"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search stock"
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
          {can('inventory.adjust') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">New item</span>
            </Button>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="scroll-pane -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
            {CLASS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStockClass(filter.value)}
                className={cn(
                  'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors press no-select',
                  stockClass === filter.value
                    ? 'border-brand bg-brand text-brand-ink'
                    : 'border-line bg-surface text-ink-muted hover:text-ink',
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="hidden shrink-0 items-center gap-4 text-sm sm:flex">
            {summary.out > 0 ? (
              <span className="flex items-center gap-1.5 text-danger">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                {summary.out} out
              </span>
            ) : null}
            {summary.low > 0 ? <span className="text-warning">{summary.low} low</span> : null}
            <span className="text-ink-muted">
              Stock value <span className="tabular font-medium text-ink">{money(summary.value)}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="scroll-pane flex-1">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Boxes className="h-8 w-8" aria-hidden="true" />}
            title={search ? 'Nothing matches that search' : 'No stock items yet'}
            description={
              search ? 'Try a different word.' : 'Add the ingredients and packaging you buy in.'
            }
            action={
              can('inventory.adjust') && !search ? (
                <Button onClick={() => setEditing('new')}>Add the first item</Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(({ ingredient, onHand, low, out, value }) => (
              <li key={ingredient.id}>
                <button
                  type="button"
                  onClick={() => setSelected(ingredient)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
                >
                  <span
                    className={cn(
                      'h-9 w-1 shrink-0 rounded-full',
                      out ? 'bg-danger' : low ? 'bg-warning' : 'bg-line',
                    )}
                    aria-hidden="true"
                  />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[0.9375rem] font-medium text-ink">
                        {ingredient.name}
                      </span>
                      {out ? (
                        <Badge tone="danger">Out</Badge>
                      ) : low ? (
                        <Badge tone="warning">Low</Badge>
                      ) : null}
                    </span>
                    <span className="text-[0.8125rem] text-ink-subtle">
                      {ingredient.stockClass === 'PACKAGING'
                        ? 'Packaging'
                        : ingredient.stockClass === 'RETAIL'
                          ? 'Resale'
                          : 'Ingredient'}
                      {ingredient.sku ? ` · ${ingredient.sku}` : ''}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span
                      className={cn(
                        'tabular block text-[0.9375rem] font-medium',
                        out ? 'text-danger' : low ? 'text-warning' : 'text-ink',
                      )}
                    >
                      {ingredient.trackStock ? formatQuantity(onHand, ingredient.dimension) : 'Not tracked'}
                    </span>
                    <span className="tabular block text-[0.8125rem] text-ink-subtle">{money(value)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <IngredientSheet
        ingredient={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
        onEdit={(ingredient) => {
          setSelected(null)
          setEditing(ingredient)
        }}
      />

      <IngredientEditor
        ingredient={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
