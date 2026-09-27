import { Search, ShoppingBag, X } from 'lucide-react'
import type { BusinessSettings, Product } from '@pos/shared'
import { availabilityOf, type MenuData, type StockMap } from '../db/repo.ts'
import { Badge, EmptyState, Money } from '../components/ui/primitives.tsx'
import { useMoney } from '../app/providers.tsx'
import { cn } from '../lib/utils.ts'

/**
 * The menu half of the till.
 *
 * Three tiles across on a phone, four on a laptop: nine items on screen at a
 * rush without scrolling. Tiles are hairline-edged, not shadowed, and the
 * price is set in the monospace face so a column of them lines up.
 *
 * One piece of copy is shortened on purpose: the sold-out chip reads "Out"
 * rather than "Sold out", because in the 3-up grid the uppercase tracked
 * badge beside a mono price does not fit at phone width.
 */

/** The shop's low-stock rule, and how fast each ingredient is going. */
export interface LowStockRule {
  settings: BusinessSettings | null | undefined
  rates: Map<string, number>
}

export function MenuGrid({
  menu,
  products,
  stock,
  lowStock,
  categoryId,
  search,
  onCategory,
  onSearch,
  onSelect,
}: {
  menu: MenuData
  products: Product[]
  stock: StockMap
  lowStock: LowStockRule
  categoryId: string
  search: string
  onCategory: (id: string) => void
  onSearch: (term: string) => void
  onSelect: (product: Product) => void
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-line px-3 pb-2.5 pt-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search the menu"
            className="h-10 w-full rounded-full border border-line-strong bg-surface pl-9 pr-9 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-subtle hover:bg-surface-sunken"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="scroll-pane -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          <CategoryChip active={categoryId === 'all'} onClick={() => onCategory('all')}>
            All
          </CategoryChip>
          {menu.categories.map((category) => (
            <CategoryChip
              key={category.id}
              active={categoryId === category.id}
              onClick={() => onCategory(category.id)}
            >
              {category.name}
            </CategoryChip>
          ))}
        </div>
      </div>

      <div className="scroll-pane flex-1 px-3 py-3">
        {products.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="h-8 w-8" aria-hidden="true" />}
            title={search ? 'Nothing matches that search' : 'No products in this category'}
            description={
              search ? 'Try a different word, or clear the search.' : 'Add products from the menu settings.'
            }
          />
        ) : (
          <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-4 lg:gap-2">
            {products.map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                menu={menu}
                stock={stock}
                lowStock={lowStock}
                onSelect={() => onSelect(product)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors press no-select',
        active
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-line-strong bg-surface text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function ProductTile({
  product,
  menu,
  stock,
  lowStock,
  onSelect,
}: {
  product: Product
  menu: MenuData
  stock: StockMap
  lowStock: LowStockRule
  onSelect: () => void
}) {
  const money = useMoney()
  const variants = menu.variantsByProduct.get(product.id) ?? []
  const cheapest = variants.reduce<number | null>(
    (lowest, variant) => (lowest === null || variant.price < lowest ? variant.price : lowest),
    null,
  )

  // A product is only truly unavailable when none of its sizes can be made.
  const availabilities = variants.map((variant) => availabilityOf(variant.id, menu, stock, [], lowStock))
  const soldOut =
    !product.available || (availabilities.length > 0 && availabilities.every((entry) => entry.outOfStock))
  const low =
    !soldOut && availabilities.some((entry) => entry.low || (entry.makeable !== Infinity && entry.makeable <= 5))

  // Out of stock only takes the tile out of reach when the shop has asked for
  // that. With the rule off the tile still wears the badge, and the sheet
  // behind it still says how short it is, but a sale goes through - which is
  // the only honest answer while the shelves have not been counted yet.
  const blocking = lowStock.settings?.blockSaleWhenOutOfStock !== false
  const blocked = !product.available || (soldOut && blocking)

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={blocked}
      className={cn(
        'flex min-h-[5.25rem] flex-col justify-between rounded-2xl border border-line bg-surface p-2.5 text-left transition-colors press no-select',
        !blocked && 'lift hover:border-brand-light',
        blocked && 'opacity-50 hover:border-line',
      )}
    >
      <div className="min-w-0">
        <p className="line-clamp-2 text-[0.8125rem] font-medium leading-tight text-ink">{product.name}</p>
        {variants.length > 1 ? (
          <p className="mt-0.5 text-[0.6875rem] text-ink-subtle">{variants.length} sizes</p>
        ) : null}
      </div>

      <div className="mt-2 flex items-end justify-between gap-1">
        <Money className="text-[0.9375rem] font-semibold text-ink">
          {cheapest !== null ? money(cheapest) : '—'}
        </Money>
        {soldOut ? <Badge tone="danger">Out</Badge> : low ? <Badge tone="warning">Low</Badge> : null}
      </div>
    </button>
  )
}
