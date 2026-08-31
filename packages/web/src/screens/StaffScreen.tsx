import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { LockKeyhole, Plus, UserRound } from 'lucide-react'
import { roleLabel, type User } from '@pos/shared'
import { isLockedOut, listStaff } from '../db/staff.ts'
import { Badge, Button, EmptyState } from '../components/ui/primitives.tsx'
import { useSession } from '../app/providers.tsx'
import { StaffSheet } from './staff/StaffSheet.tsx'
import { cn } from '../lib/utils.ts'

/**
 * The people who use the till.
 *
 * Each person gets their own account and their own PIN, so the audit trail can
 * name who did what. A role sets the sensible starting point for what they may
 * do; anything beyond that is adjusted per person.
 */
export function StaffScreen() {
  const { can, user: signedIn } = useSession()
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)

  const staff = useLiveQuery(() => listStaff(), [], [] as User[])
  const mayEdit = can('staff.edit')

  // The open sheet reads the live record, not a snapshot taken when it opened,
  // so a permission switched on there is reflected the moment it is written.
  const editing =
    editingId === 'new' ? 'new' : editingId ? (staff.find((entry) => entry.id === editingId) ?? null) : null

  const setEditing = (next: User | 'new' | null): void =>
    setEditingId(next === 'new' ? 'new' : (next?.id ?? null))

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-4 py-3">
        <div>
          <p className="font-medium text-ink">Staff</p>
          <p className="text-[0.8125rem] text-ink-subtle">
            {staff.filter((entry) => entry.active).length} active
            {staff.some((entry) => !entry.active) ? ` · ${staff.filter((e) => !e.active).length} inactive` : ''}
          </p>
        </div>
        {mayEdit ? (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Add someone</span>
          </Button>
        ) : null}
      </div>

      <div className="scroll-pane flex-1">
        {staff.length === 0 ? (
          <EmptyState
            icon={<UserRound className="h-8 w-8" aria-hidden="true" />}
            title="No staff yet"
            description="Add the people who will be using the till."
          />
        ) : (
          <ul className="divide-y divide-line">
            {staff.map((person) => {
              const overrides = Object.keys(person.permissionOverrides ?? {}).length
              const locked = isLockedOut(person)
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => mayEdit && setEditing(person)}
                    disabled={!mayEdit}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                      mayEdit ? 'hover:bg-surface-sunken' : 'cursor-default',
                      !person.active && 'opacity-60',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                        person.active ? 'bg-brand-soft text-brand' : 'bg-surface-sunken text-ink-subtle',
                      )}
                    >
                      {person.name
                        .split(' ')
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[0.9375rem] font-medium text-ink">{person.name}</span>
                        {person.id === signedIn?.id ? <Badge tone="brand">You</Badge> : null}
                        {!person.active ? <Badge tone="neutral">Inactive</Badge> : null}
                        {locked ? (
                          <Badge tone="danger">
                            <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                            Locked
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block text-[0.8125rem] text-ink-subtle">
                        {roleLabel(person.role)}
                        {person.employeeCode ? ` · ${person.employeeCode}` : ''}
                        {overrides > 0
                          ? ` · ${overrides} permission${overrides === 1 ? '' : 's'} adjusted`
                          : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <StaffSheet
        person={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditingId(null)}
      />
    </div>
  )
}
