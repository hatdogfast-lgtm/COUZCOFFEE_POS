import { useState } from 'react'
import { Check, Coffee, Loader2, ShieldCheck } from 'lucide-react'
import { assertPinShape, isWeakPin, PIN_LENGTH } from '@pos/shared'
import { Button, Card, Field, Input } from '../components/ui/primitives.tsx'
import { completeSetup, isSetUp, STARTER_SUMMARY } from '../db/seed.ts'
import { syncEngine } from '../sync/engine.ts'
import { cn } from '../lib/utils.ts'

type SetupMode = 'NEW' | 'JOIN'

/**
 * First run.
 *
 * The business names itself and the owner chooses their own PIN here. Nothing
 * is pre-filled with a factory default, because a till that ships knowing its
 * own password is a till anyone can open.
 */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<SetupMode>('NEW')
  const [businessName, setBusinessName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [starterMenu, setStarterMenu] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pinProblem = ((): string | null => {
    if (pin.length === 0) return null
    try {
      assertPinShape(pin)
    } catch {
      return `A PIN must be exactly ${PIN_LENGTH} digits.`
    }
    if (isWeakPin(pin)) return 'That PIN is too easy to guess. Avoid 1234 or 0000.'
    if (confirmPin.length > 0 && pin !== confirmPin) return 'The two PINs do not match.'
    return null
  })()

  const ready =
    businessName.trim().length > 0 &&
    ownerName.trim().length > 0 &&
    pin.length === PIN_LENGTH &&
    pin === confirmPin &&
    pinProblem === null

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await completeSetup({
        businessName,
        ownerName,
        pin,
        includeStarterMenu: starterMenu,
      })
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Setup could not be completed.')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full overflow-y-auto bg-canvas px-4 py-10 pad-safe-top pad-safe-bottom">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="space-y-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-brand-ink">
            <Coffee className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Set up your point of sale</h1>
          <p className="text-sm text-ink-muted">
            This takes a minute and happens entirely on this device. You can connect it to a server later.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2">
          <ModeTab active={mode === 'NEW'} onClick={() => setMode('NEW')}>
            New shop
          </ModeTab>
          <ModeTab active={mode === 'JOIN'} onClick={() => setMode('JOIN')}>
            Join an existing one
          </ModeTab>
        </div>

        {mode === 'JOIN' ? (
          <JoinExisting onDone={onDone} />
        ) : (
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <Field label="Business name" hint="Appears on receipts, reports and the app itself.">
              <Input
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="e.g. Corner Roasters"
                autoFocus
                autoComplete="organization"
                maxLength={80}
              />
            </Field>

            <Field label="Your name" hint="You will be set up as the owner, with full access.">
              <Input
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                placeholder="e.g. Alex Santos"
                autoComplete="name"
                maxLength={60}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Choose a ${PIN_LENGTH}-digit PIN`} error={pinProblem}>
                <Input
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                  inputMode="numeric"
                  type="password"
                  placeholder="••••"
                  className="tabular text-center text-lg tracking-[0.4em]"
                />
              </Field>
              <Field label="Confirm PIN">
                <Input
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                  inputMode="numeric"
                  type="password"
                  placeholder="••••"
                  className="tabular text-center text-lg tracking-[0.4em]"
                />
              </Field>
            </div>

            <button
              type="button"
              onClick={() => setStarterMenu((value) => !value)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                starterMenu ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-sunken',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                  starterMenu ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong',
                )}
              >
                {starterMenu ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              </span>
              <span className="space-y-0.5">
                <span className="block text-sm font-medium text-ink">Start with an example coffee menu</span>
                <span className="block text-[0.8125rem] text-ink-muted">
                  {STARTER_SUMMARY.products} drinks and food items across {STARTER_SUMMARY.categories} categories, with{' '}
                  {STARTER_SUMMARY.ingredients} ingredients, recipes and opening stock. Everything is editable, and you
                  can delete it all.
                </span>
              </span>
            </button>

            {error ? (
              <p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>
            ) : null}

            <Button type="submit" size="lg" full disabled={!ready || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {busy ? 'Setting up…' : 'Create my point of sale'}
            </Button>

            <p className="flex items-start gap-2 text-xs text-ink-subtle">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Your PIN is hashed before it is stored. It is never kept in readable form on this device or sent
              anywhere in readable form.
            </p>
          </form>
        </Card>
        )}
      </div>
    </div>
  )
}

function ModeTab({
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
        'rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors press',
        active ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Bringing a second till onto an existing shop.
 *
 * The device enrols, pulls the whole business down from the server, and is
 * then ready to sign in with the staff PINs that already exist. It never
 * creates a second business by accident, which is what would happen if the
 * only path on offer were the one above.
 */
function JoinExisting({ onDone }: { onDone: () => void }) {
  const [serverUrl, setServerUrl] = useState('http://localhost:4000')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function join(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await syncEngine.enrol(serverUrl, code)
      if (await isSetUp()) {
        onDone()
        return
      }
      setError(
        'This device is now enrolled, but the server has no shop set up yet. Set one up on the first till, then try again.',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The server could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-5 p-6">
      <p className="text-sm text-ink-muted">
        Point this till at the server your other devices use. It will download the menu, recipes, stock and staff.
      </p>

      <Field label="Server address" hint="The address the first till is connected to.">
        <Input
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          placeholder="http://192.168.1.10:4000"
          autoComplete="url"
        />
      </Field>

      <Field label="Enrolment code">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          type="password"
          placeholder="Enrolment code"
        />
      </Field>

      {error ? <p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p> : null}

      <Button size="lg" full onClick={() => void join()} disabled={busy || !serverUrl || !code}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {busy ? 'Connecting…' : 'Join this shop'}
      </Button>
    </Card>
  )
}
