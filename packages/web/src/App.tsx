import { useEffect, useState } from 'react'
import { SessionProvider, SettingsProvider, useSession } from './app/providers.tsx'
import { loadIdentity } from './db/identity.ts'
import { isSetUp } from './db/seed.ts'
import { runDataMigrations } from './db/migrations.ts'
import { SetupScreen } from './screens/SetupScreen.tsx'
import { LockScreen } from './screens/LockScreen.tsx'
import { AppShell } from './app/AppShell.tsx'
import { Spinner } from './components/ui/primitives.tsx'

/**
 * Application shell.
 *
 * Startup is deliberately offline-safe: the device establishes its own
 * identity, opens its local database and decides what to show, all without a
 * single network call - there is nothing else for it to reach.
 */
export default function App() {
  const [phase, setPhase] = useState<'loading' | 'setup' | 'ready'>('loading')

  useEffect(() => {
    let cancelled = false

    void (async () => {
      await loadIdentity()
      const ready = await isSetUp()
      if (cancelled) return
      setPhase(ready ? 'ready' : 'setup')
      // Data fixes run behind the first paint; none of them gate the till.
      if (ready) void runDataMigrations()
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (phase === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-ink-muted">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <SettingsProvider>
      <SessionProvider>
        {phase === 'setup' ? <SetupScreen onDone={() => setPhase('ready')} /> : <Authenticated />}
      </SessionProvider>
    </SettingsProvider>
  )
}

function Authenticated() {
  const { user } = useSession()
  return user ? <AppShell /> : <LockScreen />
}
