import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Delete, Loader2 } from 'lucide-react'
import { PIN_LENGTH, roleLabel, type User } from '@pos/shared'
import { db } from '../db/database.ts'
import { Micro } from '../components/ui/primitives.tsx'
import { ConnectionBadge } from '../components/ConnectionBadge.tsx'
import { useSession, useSettings } from '../app/providers.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Shift sign-in.
 *
 * One shared terminal, many staff. Picking a name and tapping four digits is
 * the entire flow, because a queue does not wait for a login form.
 *
 * This is a surface that is read, not worked: the shop's name in the
 * Roastery face, a menu-board list of names with hairlines, and a keypad
 * with numerals large enough to hit without looking.
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
    <div className="flex min-h-full flex-col bg-surface pad-safe-top pad-safe-bottom">
      <header className="flex items-end justify-between gap-4 border-b border-line px-5 pb-4 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          {settings?.branding.logoDataUrl ? (
            <img src={settings.branding.logoDataUrl} alt="" className="h-11 w-11 rounded-md object-cover" />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-accent font-display text-xl font-medium text-accent-ink">
              {businessName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-display text-[1.625rem] font-medium leading-none tracking-tight text-brand">
              {businessName}
            </h1>
            <Micro className="mt-1.5">Sign in to start selling</Micro>
          </div>
        </div>
        <ConnectionBadge compact />
      </header>

      <div className="flex flex-1 items-start justify-center px-5 py-6 sm:items-center">
        <div className="w-full max-w-md">
          {!selected ? (
            <div className="space-y-4">
              <div className="space-y-1">
                {/* Still a heading for the outline; the shop name above is the page's h1. */}
                <h2 className="micro block text-ink-subtle">Who is on the till?</h2>
                <p className="text-sm text-ink-muted">Choose your name to sign in.</p>
              </div>
              <ul className="border-t border-line">
                {(staff ?? []).map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(user)
                        setPin('')
                        setError(null)
                      }}
                      className="flex w-full items-baseline gap-3 border-b border-line px-1 py-3.5 text-left transition-colors press hover:bg-canvas"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-medium text-ink">{user.name}</span>
                        <Micro className="mt-0.5">{roleLabel(user.role)}</Micro>
                      </span>
                      <span className="mb-1 min-w-2 flex-1 border-b border-dotted border-line-strong" aria-hidden="true" />
                      <span className="font-display text-[0.9375rem] text-ink-subtle">
                        {user.name
                          .split(' ')
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </span>
                    </button>
                  </li>
                ))}
                {staff?.length === 0 ? (
                  <li className="py-6 text-center text-sm text-ink-muted">
                    No active staff. An owner or manager needs to add someone first.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-1 text-center">
                <h2 className="font-display text-2xl font-medium tracking-tight text-ink">{selected.name}</h2>
                <Micro>{roleLabel(selected.role)}</Micro>
              </div>

              <div className={cn('flex justify-center gap-3', error && 'animate-[fade-in_150ms]')}>
                {Array.from({ length: PIN_LENGTH }, (_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-3 w-3 rounded-full border-2 transition-colors',
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

              <div className="grid grid-cols-3 gap-2">
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
                  <span className="micro">Back</span>
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
        </div>
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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-16 items-center justify-center rounded-md border text-2xl transition-colors press no-select disabled:pointer-events-none disabled:opacity-45',
        muted
          ? 'border-transparent text-ink-muted hover:bg-canvas'
          : 'border-line bg-surface font-display font-medium text-ink hover:border-line-strong hover:bg-canvas',
      )}
    >
      {children}
    </button>
  )
}
