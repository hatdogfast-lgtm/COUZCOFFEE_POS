import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type {
  ExpenseCategoryEntry,
  PaymentKind,
  PaymentMethodEntry,
  RoleEntry,
  ShopListEntry,
} from '@pos/shared'
import { PERMISSION_GROUPS, PERMISSION_LABELS } from '@pos/shared'
import { db } from '../../db/database.ts'
import {
  addListEntry,
  listExpenseCategories,
  listOrderTypes,
  listPaymentMethods,
  listRoles,
  removeListEntry,
  updateListEntry,
} from '../../db/shopLists.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * The lists the shop keeps.
 *
 * Payment methods, expense categories, order types and roles were all fixed
 * lists in the source until now, which meant a shop wanting to take bank
 * transfers waited for a release. They are data here, and the shop owns them.
 *
 * What cannot be undone is deletion of anything the books point at, so this
 * screen offers switching off far more readily than removing.
 */

type ListKind = 'paymentMethods' | 'expenseCategories' | 'orderTypes' | 'roles'

const TABS: Array<{ id: ListKind; label: string; note: string }> = [
  {
    id: 'paymentMethods',
    label: 'Payments',
    note: 'How customers can pay. What each one behaves like decides whether the till asks for change or a reference.',
  },
  {
    id: 'expenseCategories',
    label: 'Expenses',
    note: 'What you can file a cost under. Fixed arrives whether or not anyone buys a coffee.',
  },
  { id: 'orderTypes', label: 'Order types', note: 'Dine in, take out, or whatever else you do.' },
  { id: 'roles', label: 'Roles', note: 'What each kind of staff member may do. Individual people can still be given exceptions in Staff.' },
]

export function ListsPanel() {
  const { user, can } = useSession()
  const [tab, setTab] = useState<ListKind>('paymentMethods')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const mayEdit = can('settings.edit')
  const active = TABS.find((entry) => entry.id === tab)!

  const rows = useLiveQuery(async () => {
    switch (tab) {
      case 'paymentMethods':
        return listPaymentMethods(true)
      case 'expenseCategories':
        return listExpenseCategories(true)
      case 'orderTypes':
        return listOrderTypes(true)
      case 'roles':
        return listRoles(true)
    }
  }, [tab])

  /** How many records point at a code, so nothing in use is offered for deletion. */
  const usage = useLiveQuery(async () => {
    const counts = new Map<string, number>()
    const tally = (values: Array<string | undefined>): void => {
      for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    switch (tab) {
      case 'paymentMethods':
        tally((await db.payments.toArray()).filter((r) => r.deletedAt === null).map((r) => r.method))
        break
      case 'expenseCategories':
        tally((await db.operatingExpenses.toArray()).filter((r) => r.deletedAt === null).map((r) => r.category))
        break
      case 'orderTypes':
        tally((await db.sales.toArray()).filter((r) => r.deletedAt === null).map((r) => r.orderType))
        break
      case 'roles':
        tally((await db.users.toArray()).filter((r) => r.deletedAt === null).map((r) => r.role))
        break
    }
    return counts
  }, [tab], new Map<string, number>())

  async function act(run: () => Promise<unknown>, done = 'Saved.'): Promise<void> {
    if (busy || !mayEdit) return
    setBusy(true)
    try {
      await run()
      toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  function blankEntry(): Record<string, unknown> {
    switch (tab) {
      case 'paymentMethods':
        return { name, kind: 'EWALLET', requiresReference: true, opensDrawer: false }
      case 'expenseCategories':
        return { name, kind: 'VARIABLE' }
      case 'roles':
        return { name, permissions: [] }
      default:
        return { name }
    }
  }

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {!mayEdit ? (
          <p className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] text-warning">
            You can see these lists but not change them.
          </p>
        ) : null}

        <div className="scroll-pane -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setTab(entry.id)
                setAdding(false)
              }}
              className={cn(
                'shrink-0 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors press',
                tab === entry.id ? 'border-brand bg-brand-soft text-ink' : 'border-line text-ink-muted',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <p className="text-[0.8125rem] text-ink-muted">{active.note}</p>

        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          {!rows ? (
            <p className="px-4 py-3 text-[0.8125rem] text-ink-muted">Loading…</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <Row
                  key={row.id}
                  kind={tab}
                  entry={row}
                  usedBy={usage?.get(row.code) ?? 0}
                  disabled={!mayEdit || busy}
                  onAct={act}
                  userId={user?.id ?? ''}
                />
              ))}
            </ul>
          )}

          {mayEdit ? (
            <div className="border-t border-line p-3">
              {adding ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="What is it called?" className="min-w-[10rem] flex-1">
                    <Input
                      autoFocus
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={40}
                      className="h-10"
                    />
                  </Field>
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
                    disabled={busy || name.trim().length === 0}
                    onClick={() =>
                      void act(
                        () => addListEntry({ table: tab, entry: blankEntry() as never, userId: user?.id ?? '' }),
                        `"${name.trim()}" added.`,
                      ).then(() => {
                        setName('')
                        setAdding(false)
                      })
                    }
                  >
                    Add it
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" full onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add {active.label.toLowerCase().replace(/s$/, '')}
                </Button>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

const PAYMENT_KINDS: Array<{ value: PaymentKind; label: string; hint: string }> = [
  { value: 'CASH', label: 'Cash', hint: 'Takes tender, gives change, can open the drawer.' },
  { value: 'EWALLET', label: 'E-wallet', hint: 'Settled elsewhere. Usually needs a reference.' },
  { value: 'CARD', label: 'Card', hint: 'Settled by the terminal.' },
  { value: 'NON_CASH', label: 'Not money', hint: 'A loyalty claim or a giveaway. Counts as no revenue.' },
]

function Row({
  kind,
  entry,
  usedBy,
  disabled,
  onAct,
  userId,
}: {
  kind: ListKind
  entry: ShopListEntry
  usedBy: number
  disabled: boolean
  onAct: (run: () => Promise<unknown>, done?: string) => Promise<void>
  userId: string
}) {
  const [open, setOpen] = useState(false)

  const change = (changes: Record<string, unknown>): void => {
    void onAct(() => updateListEntry({ table: kind, entry, changes: changes as never, userId }))
  }

  return (
    <li className={cn(!entry.active && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <input
          value={entry.name}
          disabled={disabled}
          onChange={(event) => change({ name: event.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink focus:outline-none disabled:opacity-100"
          aria-label={`${entry.code} name`}
        />

        <span className="shrink-0 text-[0.6875rem] text-ink-subtle">
          {usedBy > 0 ? `used ${usedBy}×` : entry.builtIn ? 'built in' : 'yours'}
        </span>

        <button
          type="button"
          disabled={disabled}
          onClick={() => change({ active: !entry.active })}
          aria-pressed={entry.active}
          className={cn(
            'shrink-0 rounded-lg border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors press disabled:opacity-50',
            entry.active ? 'border-brand bg-brand text-brand-ink' : 'border-line text-ink-subtle',
          )}
        >
          {entry.active ? 'On' : 'Off'}
        </button>

        {kind !== 'orderTypes' ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="shrink-0 rounded-lg p-1.5 text-ink-subtle hover:bg-surface-sunken"
            aria-label={`Settings for ${entry.name}`}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </button>
        ) : null}

        {!entry.builtIn && usedBy === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!window.confirm(`Remove "${entry.name}"?`)) return
              void onAct(
                () => removeListEntry({ table: kind, entry, usedBy, userId }),
                `"${entry.name}" removed.`,
              )
            }}
            className="shrink-0 rounded-lg p-1.5 text-ink-subtle hover:bg-surface-sunken hover:text-danger"
            aria-label={`Remove ${entry.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-3 border-t border-line bg-surface-sunken/40 px-4 py-3">
          {kind === 'paymentMethods' ? (
            <PaymentOptions entry={entry as PaymentMethodEntry} disabled={disabled} onChange={change} />
          ) : null}
          {kind === 'expenseCategories' ? (
            <ExpenseOptions entry={entry as ExpenseCategoryEntry} disabled={disabled} onChange={change} />
          ) : null}
          {kind === 'roles' ? (
            <RoleOptions entry={entry as RoleEntry} disabled={disabled} onChange={change} />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function PaymentOptions({
  entry,
  disabled,
  onChange,
}: {
  entry: PaymentMethodEntry
  disabled: boolean
  onChange: (changes: Record<string, unknown>) => void
}) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-[0.8125rem] font-medium text-ink">How it behaves</p>
        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ kind: option.value })}
              className={cn(
                'rounded-xl border px-3 py-2 text-left transition-colors press disabled:opacity-50',
                entry.kind === option.value ? 'border-brand bg-brand-soft' : 'border-line',
              )}
            >
              <span className="block text-sm font-medium text-ink">{option.label}</span>
              <span className="block text-[0.6875rem] text-ink-subtle">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <Switch
        label="Needs a reference number"
        hint="The sale will not go through without one, so it can be matched against the statement."
        checked={entry.requiresReference}
        disabled={disabled}
        onChange={() => onChange({ requiresReference: !entry.requiresReference })}
      />
      <Switch
        label="Opens the cash drawer"
        checked={entry.opensDrawer}
        disabled={disabled}
        onChange={() => onChange({ opensDrawer: !entry.opensDrawer })}
      />
    </>
  )
}

function ExpenseOptions({
  entry,
  disabled,
  onChange,
}: {
  entry: ExpenseCategoryEntry
  disabled: boolean
  onChange: (changes: Record<string, unknown>) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['FIXED', 'VARIABLE'] as const).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onChange({ kind: value })}
          className={cn(
            'rounded-xl border px-3 py-2 text-left transition-colors press disabled:opacity-50',
            entry.kind === value ? 'border-brand bg-brand-soft' : 'border-line',
          )}
        >
          <span className="block text-sm font-medium text-ink">{value === 'FIXED' ? 'Fixed' : 'Variable'}</span>
          <span className="block text-[0.6875rem] text-ink-subtle">
            {value === 'FIXED' ? 'Arrives whatever you sell.' : 'Moves with how busy you are.'}
          </span>
        </button>
      ))}
    </div>
  )
}

function RoleOptions({
  entry,
  disabled,
  onChange,
}: {
  entry: RoleEntry
  disabled: boolean
  onChange: (changes: Record<string, unknown>) => void
}) {
  const held = new Set(entry.permissions)

  const toggle = (permission: string): void => {
    const next = held.has(permission)
      ? entry.permissions.filter((value) => value !== permission)
      : [...entry.permissions, permission]
    onChange({ permissions: next })
  }

  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">{group.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.permissions.map((permission) => (
              <button
                key={permission}
                type="button"
                disabled={disabled}
                onClick={() => toggle(permission)}
                className={cn(
                  'rounded-lg border px-2 py-1 text-[0.6875rem] transition-colors press disabled:opacity-50',
                  held.has(permission)
                    ? 'border-brand bg-brand-soft text-ink'
                    : 'border-line text-ink-subtle hover:text-ink',
                )}
              >
                {PERMISSION_LABELS[permission] ?? permission}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[0.8125rem] text-ink-subtle">
        Changing a role changes it for everyone who has it. One person can still be given an exception in Staff.
      </p>
    </div>
  )
}

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="block text-[0.8125rem] text-ink-subtle">{hint}</span> : null}
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
