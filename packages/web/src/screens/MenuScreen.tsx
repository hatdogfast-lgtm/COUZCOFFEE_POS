import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Coffee, Plus, Search, X } from 'lucide-react'
import type { Product } from '@pos/shared'
import { db } from '../db/database.ts'
import { Badge, Button, EmptyState } from '../components/ui/primitives.tsx'
import { useMoney, useSession } from '../app/providers.tsx'
import { InventoryPanel } from './inventory/InventoryPanel.tsx'
import { RecipesPanel } from './recipes/RecipesPanel.tsx'
import { ImportPanel } from './menu/ImportPanel.tsx'
import { ProductEditor } from './menu/ProductEditor.tsx'
import { CategoriesPanel } from './menu/CategoriesPanel.tsx'
import { OptionsPanel } from './menu/OptionsPanel.tsx'
import { cn } from '../lib/utils.ts'

/**
 * The menu and what it is made of, in one place.
 *
 * Products, recipes and stock are three views of the same question - what do
 * we sell, what goes into it, and have we got any - so they sit behind tabs in
 * a single screen rather than three separate ones. Each then gets the full
 * width of the window instead of a third of the navigation.
 */

type Tab = 'PRODUCTS' | 'CATEGORIES' | 'OPTIONS' | 'RECIPES' | 'INGREDIENTS' | 'IMPORT'

export function MenuScreen() {
  const { can } = useSession()

  const tabs = useMemo(() => {
    const all: Array<{ id: Tab; label: string; allowed: boolean }> = [
      { id: 'PRODUCTS', label: 'Products', allowed: can('product.view') },
      { id: 'CATEGORIES', label: 'Categories', allowed: can('product.view') },
      { id: 'OPTIONS', label: 'Options', allowed: can('product.view') },
      { id: 'RECIPES', label: 'Recipes', allowed: can('recipe.view') },
      { id: 'INGREDIENTS', label: 'Ingredients', allowed: can('inventory.view') },
      { id: 'IMPORT', label: 'Import', allowed: can('recipe.import') || can('inventory.adjust') },
    ]
    return all.filter((entry) => entry.allowed)
  }, [can])

  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'PRODUCTS')
  const active = tabs.some((entry) => entry.id === tab) ? tab : (tabs[0]?.id ?? 'PRODUCTS')

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line bg-surface px-4 pt-2">
        <div className="scroll-pane -mx-1 flex gap-1 overflow-x-auto px-1">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                'shrink-0 border-b-2 px-3.5 pb-2.5 pt-1.5 text-sm font-medium transition-colors no-select',
                active === entry.id
                  ? 'border-brand text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {active === 'PRODUCTS' ? <ProductsPanel /> : null}
        {active === 'CATEGORIES' ? <CategoriesPanel /> : null}
        {active === 'OPTIONS' ? <OptionsPanel /> : null}
        {active === 'RECIPES' ? <RecipesPanel /> : null}
        {active === 'INGREDIENTS' ? <InventoryPanel /> : null}
        {active === 'IMPORT' ? (
          <div className="scroll-pane h-full">
            <ImportPanel />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Everything on the menu, and the way to add something new. */
function ProductsPanel() {
  const money = useMoney()
  const { can } = useSession()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)

  const data = useLiveQuery(async () => {
    const [products, variants, categories] = await Promise.all([
      db.products.toArray(),
      db.productVariants.toArray(),
      db.categories.toArray(),
    ])
    const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
      rows.filter((row) => row.deletedAt === null)

    const byProduct = new Map<string, typeof variants>()
    for (const variant of alive(variants).filter((entry) => entry.active)) {
      const list = byProduct.get(variant.productId) ?? []
      list.push(variant)
      byProduct.set(variant.productId, list)
    }
    for (const list of byProduct.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)

    return {
      products: alive(products).filter((entry) => entry.active).sort((a, b) => a.sortOrder - b.sortOrder),
      byProduct,
      categoryNames: new Map(alive(categories).map((entry) => [entry.id, entry.name])),
    }
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const term = search.trim().toLowerCase()
    return data.products.filter((product) => {
      if (!term) return true
      const category = data.categoryNames.get(product.categoryId) ?? ''
      return (
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        category.toLowerCase().includes(term)
      )
    })
  }, [data, search])

  const mayEdit = can('product.edit')

  if (!data) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search the menu"
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
        {mayEdit ? (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">New item</span>
          </Button>
        ) : null}
      </div>

      <div className="scroll-pane flex-1">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Coffee className="h-8 w-8" aria-hidden="true" />}
            title={search ? 'Nothing matches that' : 'Nothing on the menu yet'}
            description={
              search ? 'Try a different word.' : 'Add drinks, pastries and snacks — they all work the same way.'
            }
            action={mayEdit && !search ? <Button onClick={() => setEditing('new')}>Add the first one</Button> : null}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((product) => {
              const variants = data.byProduct.get(product.id) ?? []
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => mayEdit && setEditing(product)}
                    disabled={!mayEdit}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                      mayEdit ? 'hover:bg-surface-sunken' : 'cursor-default',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[0.9375rem] font-medium text-ink">{product.name}</span>
                        {!product.available ? <Badge tone="warning">Hidden</Badge> : null}
                        {variants.length === 0 ? <Badge tone="danger">No price</Badge> : null}
                      </span>
                      <span className="block truncate text-[0.8125rem] text-ink-subtle">
                        {data.categoryNames.get(product.categoryId) ?? 'Uncategorised'}
                        {variants.length > 0
                          ? ` · ${variants.map((entry) => entry.name).join(', ')}`
                          : ''}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm text-ink">
                      {variants.length === 0
                        ? '—'
                        : variants.length === 1
                          ? money(variants[0]!.price)
                          : `${money(Math.min(...variants.map((entry) => entry.price)))}–${money(Math.max(...variants.map((entry) => entry.price)))}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ProductEditor
        product={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
