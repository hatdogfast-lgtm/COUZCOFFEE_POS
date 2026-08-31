import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { KeyRound, RotateCcw, TriangleAlert, X } from 'lucide-react'
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  isWeakPin,
  PIN_LENGTH,
  type RoleEntry,
  userCan,
  type Permission,
  type Role,
  type User,
} from '@pos/shared'
import {
  createStaffMember,
  isLockedOut,
  resetPermissions,
  resetPin,
  setPermission,
  unlockStaffMember,
  updateStaffMember,
} from '../../db/staff.ts'
import { listRoles, nameOf, permissionsOf } from '../../db/shopLists.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * One person's account.
 *
 * The role picks a sensible starting point; the switches below it say what this
 * particular person may do. Anything left alone follows the role, and is
 * labelled as doing so - which matters, because "off because the role says so"
 * and "off because you decided" are different facts, and only one of them
 * survives a change to what the role means.
 */
export function StaffSheet({
  person,
  open,
  onClose,
}: {
  person: User | null
  open: boolean
  onClose: () => void
}) {
  const { user: actor } = useSession()

  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('BARISTA')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [showPinReset, setShowPinReset] = useState(false)
  const [busy, setBusy] = useState(false)

  const creating = person === null

  useEffect(() => {
    if (!open) return
    setName(person?.name ?? '')
    setRole(person?.role ?? 'BARISTA')
    setCode(person?.employeeCode ?? '')
    setPin('')
    setShowPinReset(false)
  }, [open, person])

  // The shop's own roles, so one it invented can be given out like any other.
  const roles = useLiveQuery(() => listRoles(), [], [] as RoleEntry[])
  const roleDefaults = new Set<Permission>(permissionsOf(roles, role) as Permission[])
  const overrides = person?.permissionOverrides ?? {}

  async function save(): Promise<void> {
    if (!actor || busy) return
    setBusy(true)
    try {
      if (creating) {
        await createStaffMember({ name, role, pin, employeeCode: code, actorId: actor.id, allowWeak: true })
        toast.success(`${name.trim()} can now sign in.`)
        onClose()
      } else {
        await updateStaffMember({
          user: person,
          changes: { name, role, employeeCode: code },
          actorId: actor.id,
        })
        toast.success('Saved.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(permission: Permission): Promise<void> {
    if (!actor || !person) return
    const current = userCan(person.role, person.permissionOverrides, permission)
    const roleDefault = roleDefaults.has(permission)
    const next = !current
    try {
      // Matching the role again clears the override rather than pinning it, so
      // this person keeps following the role if it later changes.
      await setPermission({
        user: person,
        permission,
        granted: next === roleDefault ? undefined : next,
        actorId: actor.id,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be changed.')
    }
  }

  async function act(run: () => Promise<unknown>, done: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await run()
      toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const pinComplete = pin.length === PIN_LENGTH
  const pinIsWeak = pinComplete && isWeakPin(pin)
  const canSave = name.trim().length > 0 && (!creating || pinComplete) && !busy

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[30rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:animate-slide-in-right">
          <header className="flex items-center justify-between border-b border-line px-5 py-4 pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold text-ink">
                {creating ? 'Add someone' : person.name}
              </Dialog.Title>
              {!creating ? (
                <Dialog.Description className="text-sm text-ink-muted">
                  {nameOf(roles, person.role)}
                  {person.active ? '' : ' · inactive'}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" disabled={busy}>
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane flex-1 space-y-5 px-5 py-5">
            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus={creating} />
            </Field>

            <Field label="Staff code" hint="Optional. Shown beside their name.">
              <Input value={code} onChange={(event) => setCode(event.target.value)} maxLength={20} placeholder="e.g. B-04" />
            </Field>

            <div className="space-y-1.5">
              <span className="text-[0.8125rem] font-medium text-ink-muted">Role</span>
              <div className="grid grid-cols-2 gap-2">
                {roles.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setRole(entry.code)}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors press',
                      role === entry.code
                        ? 'border-brand bg-brand-soft text-ink'
                        : 'border-line text-ink-muted hover:text-ink',
                    )}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
              <p className="text-[0.8125rem] text-ink-subtle">
                Sets the starting point. Adjust anything below for this person only.
              </p>
            </div>

            {creating ? (
              <Field
                label={`Their ${PIN_LENGTH}-digit PIN`}
                hint="They use this to sign in. You can change it later, but never read it back."
              >
                <Input
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                  inputMode="numeric"
                  type="password"
                  placeholder="••••"
                  className="tabular text-center text-lg tracking-[0.4em]"
                />
              </Field>
            ) : null}

            {creating && pinIsWeak ? <WeakPinNotice /> : null}

            <Button full onClick={() => void save()} disabled={!canSave}>
              {busy
                ? 'Saving…'
                : creating
                  ? pinIsWeak
                    ? 'Create account anyway'
                    : 'Create account'
                  : 'Save details'}
            </Button>

            {/* Permissions only make sense once the account exists. */}
            {!creating ? (
              <>
                <section className="space-y-3 border-t border-line pt-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-ink">What they can do</h3>
                    {Object.keys(overrides).length > 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void act(
                            () => resetPermissions({ user: person, actorId: actor?.id ?? '' }),
                            'Back to the role defaults.',
                          )
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reset
                      </Button>
                    ) : null}
                  </div>

                  {PERMISSION_GROUPS.map((group) => (
                    <div key={group.title} className="space-y-1.5">
                      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle">
                        {group.title}
                      </p>
                      <ul className="divide-y divide-line rounded-xl border border-line">
                        {group.permissions.map((permission) => {
                          const allowed = userCan(person.role, person.permissionOverrides, permission)
                          const adjusted = overrides[permission] !== undefined
                          return (
                            <li key={permission} className="flex items-center gap-3 px-3.5 py-2.5">
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm text-ink">{PERMISSION_LABELS[permission]}</span>
                                <span className="block text-xs text-ink-subtle">
                                  {adjusted
                                    ? `Set for ${person.name.split(' ')[0]}`
                                    : `Follows ${nameOf(roles, person.role)}`}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => void toggle(permission)}
                                role="switch"
                                aria-checked={allowed}
                                aria-label={PERMISSION_LABELS[permission]}
                                className={cn(
                                  'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                                  allowed ? 'bg-positive' : 'bg-line-strong',
                                )}
                              >
                                <span
                                  className={cn(
                                    'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                                    allowed ? 'translate-x-5' : 'translate-x-0',
                                  )}
                                />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </section>

                <section className="space-y-2 border-t border-line pt-5">
                  <h3 className="text-sm font-medium text-ink">Account</h3>

                  {isLockedOut(person) ? (
                    <Button
                      variant="secondary"
                      full
                      onClick={() =>
                        void act(
                          () => unlockStaffMember({ user: person, actorId: actor?.id ?? '' }),
                          'Unlocked.',
                        )
                      }
                    >
                      Unlock now
                    </Button>
                  ) : null}

                  {showPinReset ? (
                    <div className="space-y-2 rounded-xl border border-line p-3">
                      <Field label="New PIN">
                        <Input
                          value={pin}
                          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                          inputMode="numeric"
                          type="password"
                          placeholder="••••"
                          className="tabular text-center text-lg tracking-[0.4em]"
                          autoFocus
                        />
                      </Field>

                      {pinIsWeak ? <WeakPinNotice /> : null}
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => setShowPinReset(false)}>
                          Cancel
                        </Button>
                        <Button
                          disabled={!pinComplete}
                          onClick={() =>
                            void act(async () => {
                              await resetPin({ user: person, pin, actorId: actor?.id ?? '', allowWeak: true })
                              setPin('')
                              setShowPinReset(false)
                            }, 'PIN changed.')
                          }
                        >
                          {pinIsWeak ? 'Set it anyway' : 'Set PIN'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="secondary" full onClick={() => setShowPinReset(true)}>
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      Change their PIN
                    </Button>
                  )}

                  <Button
                    variant={person.active ? 'outline' : 'secondary'}
                    full
                    onClick={() =>
                      void act(
                        () =>
                          updateStaffMember({
                            user: person,
                            changes: { active: !person.active },
                            actorId: actor?.id ?? '',
                          }),
                        person.active ? 'They can no longer sign in.' : 'They can sign in again.',
                      )
                    }
                    disabled={person.id === actor?.id}
                  >
                    {person.active ? 'Turn off their access' : 'Turn their access back on'}
                  </Button>

                  {person.id === actor?.id ? (
                    <p className="text-center text-xs text-ink-subtle">
                      You cannot switch off your own access.
                    </p>
                  ) : null}

                  <p className="pt-1 text-xs text-ink-subtle">
                    Accounts are switched off rather than deleted, so past sales keep pointing at who rang them up.
                  </p>
                </section>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Said, not enforced.
 *
 * An easily guessed PIN is a bad idea and the shop should hear so, but the
 * person running it is the one who decides - a rule that simply refuses only
 * teaches people to pick 1235 instead.
 */
function WeakPinNotice() {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] text-warning">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        That PIN is easy to guess. Fine on a till you keep to yourself — worth avoiding on an account that can void
        sales, change prices or restore a backup.
      </span>
    </p>
  )
}
