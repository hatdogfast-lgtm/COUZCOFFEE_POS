import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { Coffee, Cookie } from 'lucide-react'
import type { Category, ServingUnit } from '@pos/shared'
import { db } from '../../db/database.ts'
import { listCategories, setServingUnit } from '../../db/products.ts'
import { servingUnitOf } from '../../db/till.ts'
import { EmptyState } from '../../components/ui/primitives.tsx'
import { useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * How each part of the menu is counted.
 *
 * A coffee shop measures its day in cups, and a pastry is not a cup. Rather
 * than tagging every product, the answer lives on the category: mark the
 * pastry shelf as pieces once, and everything filed there is counted right
 * from then on, including things added next year.
 *
 * Everything defaults to a cup, because in a coffee shop that is what most of
 * the menu is and a wrong default should be the rare case, not the common one.
 */
export function CategoriesPanel() {
  const { user, can } = useSession()
  const mayEdit = can('product.edit')

  const rows = useLiveQuery(async () => {
    const [categories, products] = await Promise.all([listCategories(), db.products.toArray()])
    const counts = new Map<string, number>()
    for (const product of products) {
      if (product.deletedAt !== null || !product.active) continue
      counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1)
    }
    return categories.map((category) => ({ category, products: counts.get(category.id) ?? 0 }))
  }, [])

  async function choose(category: Category, servingUnit: ServingUnit): Promise<void> {
    if (!user || servingUnitOf(category) === servingUnit) return
    try {
      await setServingUnit({ category, servingUnit, userId: user.id })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    }
  }

  if (!rows) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  const cups = rows.filter((row) => servingUnitOf(row.category) === 'CUP').length

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">What counts as a cup</h2>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            This decides the cup and snack counts on the cart, on every sale, and on your X and Z readings. Changing
            it affects what is counted from now on — figures already recorded keep the counts they were rung up with.
          </p>
          <p className="mt-2 text-[0.8125rem] text-ink-subtle">
            {cups} of {rows.length} {rows.length === 1 ? 'category is' : 'categories are'} counted in cups.
          </p>
        </section>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Coffee className="h-8 w-8" aria-hidden="true" />}
            title="No categories yet"
            description="Add something to the menu and its category will appear here."
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {rows.map(({ category, products }) => {
              const unit = servingUnitOf(category)
              return (
                <li key={category.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium text-ink">{category.name}</span>
                    <span className="block text-[0.8125rem] text-ink-subtle">
                      {products} {products === 1 ? 'item' : 'items'}
                    </span>
                  </span>

                  <span className="flex shrink-0 gap-1.5">
                    <Choice
                      active={unit === 'CUP'}
                      disabled={!mayEdit}
                      onClick={() => void choose(category, 'CUP')}
                      icon={<Coffee className="h-3.5 w-3.5" aria-hidden="true" />}
                      label="Cups"
                    />
                    <Choice
                      active={unit === 'PIECE'}
                      disabled={!mayEdit}
                      onClick={() => void choose(category, 'PIECE')}
                      icon={<Cookie className="h-3.5 w-3.5" aria-hidden="true" />}
                      label="Snacks"
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {!mayEdit ? (
          <p className="text-center text-[0.8125rem] text-ink-subtle">
            Your role cannot change the menu, so these are shown but not editable.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Choice({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors press disabled:opacity-50',
        active ? 'border-brand bg-brand text-brand-ink' : 'border-line text-ink-muted hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
