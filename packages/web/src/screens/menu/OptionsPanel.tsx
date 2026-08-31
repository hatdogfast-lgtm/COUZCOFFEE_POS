import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { ListChecks, Plus, Trash2 } from 'lucide-react'
import { fromDecimal, type ModifierGroup, type ModifierOption, type ModifierSelection } from '@pos/shared'
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
  const money = useMoney()
  const { user, can } = useSession()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [selection, setSelection] = useState<ModifierSelection>('SINGLE')
  const [busy, setBusy] = useState(false)

  const groups = useLiveQuery(() => listModifierGroups(), [], undefined)
  const mayEdit = can('product.edit')

  async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      await action()
      if (done) toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
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
              money={money}
              mayEdit={mayEdit}
              busy={busy}
              onRun={run}
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
  money,
  mayEdit,
  busy,
  onRun,
  userId,
}: {
  group: ModifierGroup
  options: ModifierOption[]
  usedBy: number
  money: (amount: number) => string
  mayEdit: boolean
  busy: boolean
  onRun: (action: () => Promise<unknown>, done?: string) => Promise<void>
  userId: string
}) {
  const [optionName, setOptionName] = useState('')
  const [optionPrice, setOptionPrice] = useState('')

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
          <li key={option.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <input
              value={option.name}
              disabled={!mayEdit || busy}
              onChange={(event) =>
                void onRun(() => updateModifierOption({ option, changes: { name: event.target.value }, userId }))
              }
              className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink focus:outline-none disabled:opacity-100"
              aria-label="Option name"
            />

            <span className="tabular shrink-0 text-[0.8125rem] text-ink-muted">
              {option.priceDelta === 0 ? 'no extra charge' : `+${money(option.priceDelta)}`}
            </span>

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
                onClick={() => void onRun(() => removeModifierOption({ option, userId }))}
                className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-sunken hover:text-danger"
                aria-label={`Remove ${option.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
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
