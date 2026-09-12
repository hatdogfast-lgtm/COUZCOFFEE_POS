import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { Boxes, ListChecks, Plus, Trash2 } from 'lucide-react'
import {
  formatQuantity,
  fromBase,
  fromDecimal,
  naturalUnit,
  toBase,
  toDecimal,
  UNITS,
  unitDimension,
  type Ingredient,
  type IngredientUsage,
  type ModifierGroup,
  type ModifierOption,
  type ModifierSelection,
  type Unit,
} from '@pos/shared'
import { db } from '../../db/database.ts'
import {
  addModifierOption,
  createModifierGroup,
  listModifierGroups,
  removeModifierGroup,
  removeModifierOption,
  updateModifierGroup,
  updateModifierOption,
} from '../../db/modifiers.ts'
import { Button, EmptyState, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * The choices a drink can be ordered with.
 *
 * A group is the question the till asks - Milk, Flavour, Add-ons - and its
 * options are the answers. Nothing here is built in: a shop writes its own
 * questions, and which drinks ask them is set per product on the Products tab.
 *
 * Removing a group takes it off every product offering it, so the till is
 * never left asking about something that no longer exists. Orders already
 * taken keep their own record of what was chosen.
 */
export function OptionsPanel() {
  const { user, can } = useSession()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [selection, setSelection] = useState<ModifierSelection>('SINGLE')
  const [busy, setBusy] = useState(false)

  const groups = useLiveQuery(() => listModifierGroups(), [], undefined)
  // Loaded once for every group, because each option says what it takes from
  // stock in terms of these.
  const ingredients = useLiveQuery(async () => {
    const rows = await db.ingredients.toArray()
    return rows
      .filter((row) => row.deletedAt === null && row.active)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [], [] as Ingredient[])
  const mayEdit = can('product.edit')

  // A save made on the way somewhere else - leaving a price box for the
  // Default toggle beside it. It must not lock the panel, or the tap that
  // caused it would land on a control disabled a moment earlier; instead
  // whatever runs next waits for it to land first.
  const settling = useRef<Promise<void>>(Promise.resolve())

  async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      await settling.current
      await action()
      if (done) toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  function settle(action: () => Promise<unknown>): void {
    if (!user) return
    settling.current = settling.current
      .then(() => action())
      .then(
        () => undefined,
        (error: unknown) => {
          toast.error(error instanceof Error ? error.message : 'That could not be saved.')
        },
      )
  }

  if (!groups) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-ink">Options offered</h2>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">
                The questions the till asks when a drink is rung up. Add whatever your shop offers — a flavour, a
                syrup, a temperature. Which drinks ask them is set on each product.
              </p>
            </div>
            {mayEdit && !adding ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New group
              </Button>
            ) : null}
          </div>

          {adding ? (
            <div className="mt-3 space-y-3 rounded-xl border border-line p-3">
              <Field label="What is the question?" hint="For example: Flavour, Milk, Temperature, Add-ons.">
                <Input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Flavour"
                  maxLength={40}
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                {(['SINGLE', 'MULTI'] as ModifierSelection[]).map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setSelection(entry)}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition-colors press',
                      selection === entry ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="block text-sm font-medium text-ink">
                      {entry === 'SINGLE' ? 'Choose one' : 'Choose any'}
                    </span>
                    <span className="block text-[0.8125rem] text-ink-subtle">
                      {entry === 'SINGLE' ? 'Like milk — one answer only' : 'Like add-ons — several at once'}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAdding(false)
                    setName('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={busy || name.trim().length === 0}
                  onClick={() =>
                    void run(
                      () => createModifierGroup({ name, selection, userId: user!.id }),
                      `"${name.trim()}" added.`,
                    ).then(() => {
                      setName('')
                      setAdding(false)
                    })
                  }
                >
                  Add the group
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        {groups.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="h-8 w-8" aria-hidden="true" />}
            title="No options yet"
            description="Add a group and the till will start asking for it on the drinks you choose."
          />
        ) : (
          groups.map(({ group, options, usedBy }) => (
            <GroupCard
              key={group.id}
              group={group}
              options={options}
              usedBy={usedBy}
              ingredients={ingredients}
              mayEdit={mayEdit}
              busy={busy}
              onRun={run}
              onSettle={settle}
              userId={user?.id ?? ''}
            />
          ))
        )}
      </div>
    </div>
  )
}

function GroupCard({
  group,
  options,
  usedBy,
  ingredients,
  mayEdit,
  busy,
  onRun,
  onSettle,
  userId,
}: {
  group: ModifierGroup
  options: ModifierOption[]
  usedBy: number
  ingredients: Ingredient[]
  mayEdit: boolean
  busy: boolean
  onRun: (action: () => Promise<unknown>, done?: string) => Promise<void>
  onSettle: (action: () => Promise<unknown>) => void
  userId: string
}) {
  const [optionName, setOptionName] = useState('')
  const [optionPrice, setOptionPrice] = useState('')
  // The option whose stock editor is open, if any.
  const [stockFor, setStockFor] = useState<string | null>(null)

  const ingredientsById = useMemo(
    () => new Map(ingredients.map((entry) => [entry.id, entry])),
    [ingredients],
  )

  return (
    <section className={cn('rounded-2xl border bg-surface', group.active ? 'border-line' : 'border-line opacity-60')}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <input
            value={group.name}
            disabled={!mayEdit || busy}
            onChange={(event) =>
              void onRun(() => updateModifierGroup({ group, changes: { name: event.target.value }, userId }))
            }
            className="w-full bg-transparent text-[0.9375rem] font-medium text-ink focus:outline-none disabled:opacity-100"
            aria-label="Group name"
          />
          <p className="text-[0.8125rem] text-ink-subtle">
            {group.selection === 'SINGLE' ? 'Choose one' : 'Choose any'} · {options.length}{' '}
            {options.length === 1 ? 'option' : 'options'} · offered on {usedBy}{' '}
            {usedBy === 1 ? 'product' : 'products'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Toggle
            label="Required"
            on={group.required}
            disabled={!mayEdit || busy}
            onClick={() => void onRun(() => updateModifierGroup({ group, changes: { required: !group.required }, userId }))}
          />
          <Toggle
            label={group.active ? 'On' : 'Off'}
            on={group.active}
            disabled={!mayEdit || busy}
            onClick={() => void onRun(() => updateModifierGroup({ group, changes: { active: !group.active }, userId }))}
          />
          {mayEdit ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Remove "${group.name}"? It will be taken off ${usedBy} product(s).`)) return
                void onRun(() => removeModifierGroup({ group, userId }), `"${group.name}" removed.`)
              }}
              className="rounded-lg p-2 text-ink-subtle hover:bg-surface-sunken hover:text-danger"
              aria-label={`Remove ${group.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <ul className="divide-y divide-line">
        {options.map((option) => (
          <li key={option.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <input
                  value={option.name}
                  disabled={!mayEdit || busy}
                  onChange={(event) =>
                    void onRun(() => updateModifierOption({ option, changes: { name: event.target.value }, userId }))
                  }
                  className="w-full bg-transparent text-[0.9375rem] text-ink focus:outline-none disabled:opacity-100"
                  aria-label="Option name"
                />
                <p
                  className={cn(
                    'text-[0.75rem]',
                    (option.consumption ?? []).length === 0 ? 'text-ink-subtle' : 'text-ink-muted',
                  )}
                >
                  {describeConsumption(option.consumption ?? [], ingredientsById)}
                </p>
              </div>

              <ExtraCharge option={option} mayEdit={mayEdit} busy={busy} onSettle={onSettle} userId={userId} />

              {group.selection === 'SINGLE' ? (
                <Toggle
                  label="Default"
                  on={option.isDefault}
                  disabled={!mayEdit || busy}
                  onClick={() =>
                    void onRun(() =>
                      updateModifierOption({ option, changes: { isDefault: !option.isDefault }, userId }),
                    )
                  }
                />
              ) : null}

              {mayEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStockFor((current) => (current === option.id ? null : option.id))}
                  aria-expanded={stockFor === option.id}
                  className={cn(
                    'rounded-lg p-1.5 hover:bg-surface-sunken hover:text-ink',
                    stockFor === option.id ? 'text-ink' : 'text-ink-subtle',
                  )}
                  aria-label={`Stock used by ${option.name}`}
                >
                  <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}

              {mayEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRun(() => removeModifierOption({ option, userId }))}
                  className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-sunken hover:text-danger"
                  aria-label={`Remove ${option.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {mayEdit && stockFor === option.id ? (
              <StockEditor
                option={option}
                ingredients={ingredients}
                ingredientsById={ingredientsById}
                busy={busy}
                onRun={onRun}
                userId={userId}
                onClose={() => setStockFor(null)}
              />
            ) : null}
          </li>
        ))}
      </ul>

      {mayEdit ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3">
          <Field label="Add an option" className="min-w-[10rem] flex-1">
            <Input
              value={optionName}
              onChange={(event) => setOptionName(event.target.value)}
              placeholder="Vanilla"
              maxLength={40}
              className="h-10"
            />
          </Field>
          <Field label="Extra charge" className="w-28">
            <Input
              value={optionPrice}
              onChange={(event) => setOptionPrice(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="h-10 text-right"
            />
          </Field>
          <Button
            variant="secondary"
            disabled={busy || optionName.trim().length === 0}
            onClick={() =>
              void onRun(() =>
                addModifierOption({
                  group,
                  name: optionName,
                  priceDelta: fromDecimal(Number(optionPrice || 0)),
                  userId,
                }),
              ).then(() => {
                setOptionName('')
                setOptionPrice('')
              })
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/** "Takes 10 g Strawberry Jam, 3 g Beans from stock", or that it takes nothing. */
function describeConsumption(consumption: IngredientUsage[], ingredientsById: Map<string, Ingredient>): string {
  if (consumption.length === 0) return 'Not taken from stock'
  const parts = consumption.map((entry) => {
    const ingredient = ingredientsById.get(entry.ingredientId)
    return ingredient
      ? `${formatQuantity(entry.baseQuantity, ingredient.dimension)} ${ingredient.name}`
      : 'an ingredient no longer in stock'
  })
  return `Takes ${parts.join(', ')} from stock`
}

const priceText = (priceDelta: number): string => toDecimal(priceDelta).toFixed(2)

/**
 * The extra charge, typed as money and saved when the person leaves the box
 * rather than per keystroke - half a number is not a price.
 *
 * Someone who cannot edit sees it as plain text, not a box they cannot use.
 * The save is settled rather than run: leaving the box is usually the first
 * half of a tap on the control beside it, and that tap must still land.
 */
function ExtraCharge({
  option,
  mayEdit,
  busy,
  onSettle,
  userId,
}: {
  option: ModifierOption
  mayEdit: boolean
  busy: boolean
  onSettle: (action: () => Promise<unknown>) => void
  userId: string
}) {
  const money = useMoney()
  const [value, setValue] = useState(() => priceText(option.priceDelta))

  // Another till may have changed it underneath us.
  useEffect(() => {
    setValue(priceText(option.priceDelta))
  }, [option.priceDelta])

  function save(): void {
    const numeric = Number(value || 0)
    if (!Number.isFinite(numeric)) {
      setValue(priceText(option.priceDelta))
      return
    }
    const priceDelta = fromDecimal(numeric)
    if (priceDelta === option.priceDelta) {
      setValue(priceText(priceDelta))
      return
    }
    onSettle(() => updateModifierOption({ option, changes: { priceDelta }, userId }))
  }

  if (!mayEdit) {
    return (
      <span className="tabular shrink-0 text-[0.8125rem] text-ink-muted">
        {option.priceDelta === 0 ? 'no extra charge' : `+${money(option.priceDelta)}`}
      </span>
    )
  }

  return (
    <Input
      value={value}
      disabled={busy}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      inputMode="decimal"
      className="tabular h-8 w-24 text-right disabled:opacity-100"
      aria-label="Extra charge"
    />
  )
}

interface StockLine {
  ingredientId: string
  /** What the person typed, in the unit beside it. */
  quantity: string
  unit: Unit
}

/**
 * What choosing this option takes off the shelf.
 *
 * Typed in whatever unit suits the ingredient and stored in base units, the
 * same as a recipe, so the till and the stock ledger never disagree.
 */
function StockEditor({
  option,
  ingredients,
  ingredientsById,
  busy,
  onRun,
  userId,
  onClose,
}: {
  option: ModifierOption
  ingredients: Ingredient[]
  ingredientsById: Map<string, Ingredient>
  busy: boolean
  onRun: (action: () => Promise<unknown>, done?: string) => Promise<void>
  userId: string
  onClose: () => void
}) {
  const [lines, setLines] = useState<StockLine[]>(() =>
    (option.consumption ?? []).map((entry) => {
      const ingredient = ingredientsById.get(entry.ingredientId)
      const unit: Unit = ingredient ? naturalUnit(entry.baseQuantity, ingredient.dimension) : 'g'
      return { ingredientId: entry.ingredientId, quantity: String(fromBase(entry.baseQuantity, unit)), unit }
    }),
  )

  function setLine(index: number, changes: Partial<StockLine>): void {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...changes } : line)))
  }

  function add(): void {
    const first = ingredients[0]
    if (!first) return
    setLines((current) => [
      ...current,
      { ingredientId: first.id, quantity: '', unit: naturalUnit(0, first.dimension) },
    ])
  }

  function save(): void {
    const consumption: IngredientUsage[] = []
    for (const line of lines) {
      const quantity = Number(line.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast.error('Every line needs a quantity.')
        return
      }
      consumption.push({ ingredientId: line.ingredientId, baseQuantity: toBase(quantity, line.unit) })
    }
    // Closed from inside the action so a refused save leaves the lines to fix.
    void onRun(async () => {
      await updateModifierOption({ option, changes: { consumption }, userId })
      onClose()
    }, 'Saved.')
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line bg-surface-sunken p-3">
      <p className="text-[0.8125rem] text-ink-muted">What choosing "{option.name}" takes from stock.</p>

      {lines.length === 0 ? (
        <p className="text-[0.8125rem] text-ink-subtle">Nothing yet.</p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, index) => {
            const ingredient = ingredientsById.get(line.ingredientId)
            const units = ingredient ? UNITS.filter((entry) => unitDimension(entry) === ingredient.dimension) : [line.unit]
            return (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <select
                  value={line.ingredientId}
                  disabled={busy}
                  onChange={(event) => {
                    const next = ingredientsById.get(event.target.value)
                    if (!next) return
                    setLine(index, { ingredientId: next.id, unit: naturalUnit(0, next.dimension) })
                  }}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand focus:outline-none"
                  aria-label="Ingredient"
                >
                  {!ingredient ? <option value={line.ingredientId}>Unknown ingredient</option> : null}
                  {ingredients.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <Input
                  value={line.quantity}
                  disabled={busy}
                  onChange={(event) => setLine(index, { quantity: event.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  className="tabular h-10 w-24 text-right"
                  aria-label="Quantity"
                />
                <select
                  value={line.unit}
                  disabled={busy}
                  onChange={(event) => setLine(index, { unit: event.target.value as Unit })}
                  className="h-10 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand focus:outline-none"
                  aria-label="Unit"
                >
                  {units.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setLines((current) => current.filter((_, at) => at !== index))}
                  className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface hover:text-danger"
                  aria-label="Remove this line"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={busy || ingredients.length === 0} onClick={add}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add an ingredient
        </Button>
        <span className="flex-1" />
        <Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}

function Toggle({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string
  on: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'rounded-lg border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors press disabled:opacity-50',
        on ? 'border-brand bg-brand text-brand-ink' : 'border-line text-ink-subtle hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}
