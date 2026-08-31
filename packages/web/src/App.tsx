import { useEffect, useState } from 'react'
import { SessionProvider, SettingsProvider, useSession } from './app/providers.tsx'
import { loadIdentity } from './db/identity.ts'
import { isSetUp } from './db/seed.ts'
import { runDataMigrations } from './db/migrations.ts'
import { syncEngine } from './sync/engine.ts'
import { SetupScreen } from './screens/SetupScreen.tsx'
import { LockScreen } from './screens/LockScreen.tsx'
import { AppShell } from './app/AppShell.tsx'
import { Spinner } from './components/ui/primitives.tsx'

/**
 * Application shell.
 *
 * Startup is deliberately offline-safe: the device establishes its own
 * identity, opens its local database and decides what to show, all without a
 * single network call. The sync engine is started afterwards and is free to
 * fail without affecting anything above it.
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

  /**
   * Sync starts on its own, and nothing above may prevent it.
   *
   * It used to be the last line of the effect above, after an early return for
   * a cancelled render and after two awaits that can reject. Either one left
   * the engine unstarted, and an unstarted engine shows "Offline" forever
   * while sales pile up in the outbox with nothing to explain why - the exact
   * failure this application exists to avoid. It is retried because the first
   * attempt can legitimately fail while storage is still coming up.
   */
  useEffect(() => {
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const begin = (): void => {
      void syncEngine.start().catch(() => {
        if (++attempts > 5) return
        timer = setTimeout(begin, attempts * 1000)
      })
    }
    begin()

    return () => {
      if (timer) clearTimeout(timer)
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
