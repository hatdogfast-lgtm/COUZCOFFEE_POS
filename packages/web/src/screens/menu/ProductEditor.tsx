import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { Archive, Plus, Trash2, X } from 'lucide-react'
import { fromDecimal, type ModifierGroup, type Product } from '@pos/shared'
import { db } from '../../db/database.ts'
import {
  archiveProduct,
  createCategory,
  createProduct,
  emptyDraft,
  listCategories,
  loadProductDraft,
  updateProduct,
  type ProductDraft,
} from '../../db/products.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Adding or editing something the shop sells.
 *
 * Drinks and food use the same form. A cookie is simply a product with one
 * size, which is why there is no separate "food" path to keep in step - and it
 * means a snack gets a recipe, a cost and a margin exactly like a latte does.
 */
export function ProductEditor({
  product,
  open,
  onClose,
}: {
  product: Product | null
  open: boolean
  onClose: () => void
}) {
  const { user, can } = useSession()

  const [draft, setDraft] = useState<ProductDraft | null>(null)
  const [newCategory, setNewCategory] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [busy, setBusy] = useState(false)

  const categories = useLiveQuery(() => listCategories(), [], [])
  const groups = useLiveQuery(async () => {
    const rows = await db.modifierGroups.toArray()
    return rows.filter((row) => row.deletedAt === null && row.active).sort((a, b) => a.sortOrder - b.sortOrder)
  }, [], [] as ModifierGroup[])

  const creating = product === null

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const next = product ? await loadProductDraft(product) : emptyDraft(categories[0]?.id ?? '')
      if (!cancelled) setDraft(next)
    })()
    return () => {
      cancelled = true
    }
  }, [open, product, categories])

  if (!draft) return null
  const current: ProductDraft = draft

  const set = (changes: Partial<ProductDraft>): void => setDraft({ ...current, ...changes })

  const setVariant = (index: number, changes: Partial<ProductDraft['variants'][number]>): void =>
    set({ variants: current.variants.map((entry, at) => (at === index ? { ...entry, ...changes } : entry)) })

  async function save(): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      if (creating) {
        await createProduct({ draft: current, userId: user.id })
        toast.success(`${current.name.trim()} is on the menu.`)
      } else {
        await updateProduct({ product, draft: current, userId: user.id })
        toast.success('Saved.')
      }
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const mayEdit = can('product.edit')

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[32rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:animate-slide-in-right">
          <header className="flex items-center justify-between border-b border-line px-5 py-4 pad-safe-top">
            <Dialog.Title className="text-lg font-semibold text-ink">
              {creating ? 'New menu item' : product.name}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" disabled={busy}>
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane flex-1 space-y-5 px-5 py-5">
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
                placeholder="e.g. Blueberry Milk, or Butter Croissant"
                maxLength={80}
                autoFocus={creating}
                disabled={!mayEdit}
              />
            </Field>

            <Field label="Description" hint="Optional. Shown when choosing options.">
              <Input
                value={draft.description}
                onChange={(event) => set({ description: event.target.value })}
                maxLength={140}
                disabled={!mayEdit}
              />
            </Field>

            <div className="space-y-1.5">
              <span className="text-[0.8125rem] font-medium text-ink-muted">Category</span>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => set({ categoryId: category.id })}
                    disabled={!mayEdit}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors press',
                      draft.categoryId === category.id
                        ? 'border-brand bg-brand text-brand-ink'
                        : 'border-line bg-surface text-ink-muted hover:text-ink',
                    )}
                  >
                    {category.name}
                  </button>
                ))}
                {mayEdit ? (
                  <button
                    type="button"
                    onClick={() => setAddingCategory(true)}
                    className="rounded-full border border-dashed border-line-strong px-3.5 py-1.5 text-sm text-ink-subtle hover:text-ink"
                  >
                    <Plus className="inline h-3.5 w-3.5" aria-hidden="true" /> New
                  </button>
                ) : null}
              </div>

              {addingCategory ? (
                <div className="flex gap-2 pt-2">
                  <Input
                    value={newCategory}
                    onChange={(event) => setNewCategory(event.target.value)}
                    placeholder="e.g. Snacks"
                    maxLength={40}
                    autoFocus
                  />
                  <Button
                    disabled={newCategory.trim().length === 0}
                    onClick={() =>
                      void createCategory({ name: newCategory, userId: user?.id ?? '' })
                        .then((category) => {
                          set({ categoryId: category.id })
                          setNewCategory('')
                          setAddingCategory(false)
                        })
                        .catch((error: unknown) =>
                          toast.error(error instanceof Error ? error.message : 'That did not work.'),
                        )
                    }
                  >
                    Add
                  </Button>
                  <Button variant="ghost" onClick={() => setAddingCategory(false)}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Sizes. A snack keeps the single default size and never sees this
                as anything more complicated than one price. */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[0.8125rem] font-medium text-ink-muted">
                  {draft.variants.length > 1 ? 'Sizes and prices' : 'Price'}
                </span>
                {mayEdit ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      set({ variants: [...draft.variants, { name: '', price: 0, isDefault: false }] })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add a size
                  </Button>
                ) : null}
              </div>

              <ul className="space-y-2">
                {draft.variants.map((variant, index) => (
                  <li key={variant.id ?? index} className="flex items-center gap-2">
                    <Input
                      value={variant.name}
                      onChange={(event) => setVariant(index, { name: event.target.value })}
                      placeholder="Size, e.g. 16oz or Regular"
                      className="flex-1"
                      maxLength={30}
                      disabled={!mayEdit}
                    />
                    <Input
                      value={variant.price === 0 ? '' : String(variant.price / 100)}
                      onChange={(event) => {
                        const parsed = Number(event.target.value.replace(/[^\d.]/g, ''))
                        setVariant(index, { price: Number.isFinite(parsed) ? fromDecimal(parsed) : 0 })
                      }}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="tabular w-28 text-right"
                      disabled={!mayEdit || !can('product.price')}
                    />
                    <button
                      type="button"
                      onClick={() => setVariant(index, { isDefault: true })}
                      disabled={!mayEdit}
                      title="Offer this size first"
                      className={cn(
                        'shrink-0 rounded-lg border px-2 py-2 text-[0.6875rem] font-medium transition-colors',
                        variant.isDefault
                          ? 'border-brand bg-brand-soft text-brand'
                          : 'border-line text-ink-subtle hover:text-ink',
                      )}
                    >
                      {variant.isDefault ? 'Default' : 'Set'}
                    </button>
                    {draft.variants.length > 1 && mayEdit ? (
                      <button
                        type="button"
                        onClick={() =>
                          set({ variants: draft.variants.filter((_, at) => at !== index) })
                        }
                        className="shrink-0 rounded-lg p-2 text-ink-subtle hover:bg-danger/10 hover:text-danger"
                        aria-label="Remove this size"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-[0.8125rem] text-ink-subtle">
                Each size carries its own price and its own recipe. For something sold as it is bought — a cookie,
                a pastry — one size is all it needs.
              </p>
            </section>

            {groups.length > 0 ? (
              <section className="space-y-2">
                <span className="text-[0.8125rem] font-medium text-ink-muted">Options offered</span>
                <div className="flex flex-wrap gap-2">
                  {groups.map((group) => {
                    const on = draft.modifierGroupIds.includes(group.id)
                    return (
                      <button
                        key={group.id}
                        type="button"
                        disabled={!mayEdit}
                        onClick={() =>
                          set({
                            modifierGroupIds: on
                              ? draft.modifierGroupIds.filter((id) => id !== group.id)
                              : [...draft.modifierGroupIds, group.id],
                          })
                        }
                        className={cn(
                          'rounded-full border px-3.5 py-1.5 text-sm transition-colors press',
                          on ? 'border-brand bg-brand-soft text-ink' : 'border-line text-ink-muted hover:text-ink',
                        )}
                      >
                        {group.name}
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <div className="space-y-3 rounded-xl border border-line p-4">
              <Row
                label="Available to sell"
                hint="Turn off to hide it from the till without deleting it."
                checked={draft.available}
                disabled={!mayEdit}
                onChange={() => set({ available: !draft.available })}
              />
              <Row
                label="Tax applies"
                hint="Leave on unless this item is specifically exempt."
                checked={draft.taxable}
                disabled={!mayEdit}
                onChange={() => set({ taxable: !draft.taxable })}
              />
            </div>

            {!creating && mayEdit ? (
              <Button
                variant="outline"
                full
                onClick={() =>
                  void archiveProduct({ product, userId: user?.id ?? '' })
                    .then(() => {
                      toast.success('Taken off the menu. Past sales are unaffected.')
                      onClose()
                    })
                    .catch(() => toast.error('That could not be done.'))
                }
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                Take off the menu
              </Button>
            ) : null}
          </div>

          {mayEdit ? (
            <footer className="border-t border-line px-5 py-4 pad-safe-bottom">
              <Button size="lg" full onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : creating ? 'Add to the menu' : 'Save changes'}
              </Button>
              {creating ? (
                <p className="pt-2 text-center text-xs text-ink-subtle">
                  You can add its recipe next, on the Recipes tab.
                </p>
              ) : null}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Row({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        <span className="block text-[0.8125rem] text-ink-subtle">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-positive' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}
