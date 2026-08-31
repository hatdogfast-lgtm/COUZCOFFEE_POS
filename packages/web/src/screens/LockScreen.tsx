import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Delete, Loader2 } from 'lucide-react'
import { PIN_LENGTH, roleLabel, type User } from '@pos/shared'
import { db } from '../db/database.ts'
import { Button, Card } from '../components/ui/primitives.tsx'
import { ConnectionBadge } from '../components/ConnectionBadge.tsx'
import { useSession, useSettings } from '../app/providers.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Shift sign-in.
 *
 * One shared terminal, many staff. Picking a name and tapping four digits is
 * the entire flow, because a queue does not wait for a login form.
 */
export function LockScreen() {
  const { settings } = useSettings()
  const { signIn } = useSession()
  const [selected, setSelected] = useState<User | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const staff = useLiveQuery(async () => {
    const users = await db.users.toArray()
    return users
      .filter((user) => user.deletedAt === null && user.active)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  // With a single member of staff there is nothing to choose between.
  useEffect(() => {
    if (staff && staff.length === 1 && !selected) setSelected(staff[0] ?? null)
  }, [staff, selected])

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || !selected || busy) return

    let cancelled = false
    setBusy(true)
    void (async () => {
      const result = await signIn(selected.id, pin)
      if (cancelled) return
      if (!result.ok) {
        setError(result.message ?? 'That PIN was not correct.')
        setPin('')
        // A short shake, then let them try again.
        setTimeout(() => setBusy(false), 260)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pin, selected, busy, signIn])

  function press(digit: string): void {
    setError(null)
    setPin((current) => (current.length >= PIN_LENGTH ? current : current + digit))
  }

  const businessName = settings?.branding.businessName ?? 'Point of Sale'

  return (
    <div className="flex min-h-full flex-col bg-canvas pad-safe-top pad-safe-bottom">
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          {settings?.branding.logoDataUrl ? (
            <img
              src={settings.branding.logoDataUrl}
              alt=""
              className="h-9 w-9 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-brand-ink">
              {businessName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{businessName}</p>
            <p className="text-xs text-ink-subtle">Sign in to start selling</p>
          </div>
        </div>
        <ConnectionBadge compact />
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-6">
        <Card className="w-full max-w-md p-6">
          {!selected ? (
            <div className="space-y-4">
              <div className="space-y-1 text-center">
                <h1 className="text-lg font-semibold text-ink">Who is on the till?</h1>
                <p className="text-sm text-ink-muted">Choose your name to sign in.</p>
              </div>
              <div className="grid gap-2">
                {(staff ?? []).map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelected(user)
                      setPin('')
                      setError(null)
                    }}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left press hover:border-brand hover:bg-brand-soft"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-sunken text-sm font-semibold text-ink-muted">
                      {user.name
                        .split(' ')
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{user.name}</span>
                      <span className="block text-[0.8125rem] text-ink-subtle">{roleLabel(user.role)}</span>
                    </span>
                  </button>
                ))}
                {staff?.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-muted">
                    No active staff. An owner or manager needs to add someone first.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-1 text-center">
                <h1 className="text-lg font-semibold text-ink">{selected.name}</h1>
                <p className="text-sm text-ink-muted">{roleLabel(selected.role)}</p>
              </div>

              <div className={cn('flex justify-center gap-3', error && 'animate-[fade-in_150ms]')}>
                {Array.from({ length: PIN_LENGTH }, (_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-3.5 w-3.5 rounded-full border-2 transition-colors',
                      index < pin.length ? 'border-brand bg-brand' : 'border-line-strong bg-transparent',
                      error && 'border-danger',
                    )}
                  />
                ))}
              </div>

              <p
                className={cn(
                  'min-h-[1.25rem] text-center text-[0.8125rem]',
                  error ? 'text-danger' : 'text-ink-subtle',
                )}
                role="status"
              >
                {busy && !error ? 'Checking…' : (error ?? 'Enter your PIN')}
              </p>

              <div className="grid grid-cols-3 gap-2.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <PinKey key={digit} onClick={() => press(digit)} disabled={busy}>
                    {digit}
                  </PinKey>
                ))}
                <PinKey
                  onClick={() => {
                    setSelected(null)
                    setPin('')
                    setError(null)
                  }}
                  disabled={busy || (staff?.length ?? 0) <= 1}
                  muted
                >
                  <span className="text-[0.8125rem] font-medium">Back</span>
                </PinKey>
                <PinKey onClick={() => press('0')} disabled={busy}>
                  0
                </PinKey>
                <PinKey onClick={() => setPin((current) => current.slice(0, -1))} disabled={busy} muted>
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Delete className="h-5 w-5" aria-hidden="true" />
                  )}
                </PinKey>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function PinKey({
  children,
  onClick,
  disabled,
  muted = false,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  muted?: boolean
}) {
  return (
    <Button
      type="button"
      variant={muted ? 'ghost' : 'secondary'}
      onClick={onClick}
      disabled={disabled}
      className="h-16 rounded-2xl text-xl font-medium tabular"
    >
      {children}
    </Button>
  )
}
