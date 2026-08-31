import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  userCan,
  DEFAULT_CURRENCY,
  formatMoney,
  verifyPin,
  type BusinessSettings,
  type CurrencyFormat,
  type Money,
  type Permission,
  type SyncSnapshot,
  type User,
} from '@pos/shared'
import { listRoles, permissionsOf } from '../db/shopLists.ts'
import { db } from '../db/database.ts'
import { update } from '../db/write.ts'
import { syncEngine } from '../sync/engine.ts'
import { hexToRgbChannels, readableInk } from '../lib/utils.ts'

/**
 * Application-wide context: who is signed in, how the business is configured,
 * and what the sync engine is currently doing.
 */

// ------------------------------------------------------------------- sync ---

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(
    useCallback((onChange: () => void) => syncEngine.subscribe(onChange), []),
    useCallback(() => syncEngine.getSnapshot(), []),
    useCallback(() => syncEngine.getSnapshot(), []),
  )
}

// --------------------------------------------------------------- settings ---

interface SettingsContextValue {
  settings: BusinessSettings | null
  currency: CurrencyFormat
  money: (amount: Money) => string
  loading: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

/**
 * Applies the owner's branding to the document.
 *
 * Changing the business colours in Settings repaints the running application
 * immediately, because every colour in the design system resolves through
 * these variables rather than being compiled into a stylesheet.
 */
function useBranding(settings: BusinessSettings | null): void {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const { branding } = settings

    const brand = hexToRgbChannels(branding.primaryColor)
    if (brand) {
      root.style.setProperty('--brand', brand)
      root.style.setProperty('--brand-ink', readableInk(branding.primaryColor))
    }
    const accent = hexToRgbChannels(branding.secondaryColor)
    if (accent) {
      root.style.setProperty('--accent', accent)
      root.style.setProperty('--accent-ink', readableInk(branding.secondaryColor))
    }

    document.title = branding.businessName || 'Point of Sale'
  }, [settings])

  useEffect(() => {
    const theme = settings?.branding.theme ?? 'system'
    const root = document.documentElement

    const apply = (): void => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.setAttribute('data-theme', dark ? 'dark' : 'light')
      const meta = document.querySelector('meta[name="theme-color"]')
      meta?.setAttribute('content', dark ? '#0f1115' : '#f7f7f5')
    }

    apply()
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings?.branding.theme])
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useLiveQuery(async () => {
    const rows = await db.settings.toArray()
    return rows.find((row) => row.deletedAt === null) ?? null
  }, [])

  useBranding(settings ?? null)

  const value = useMemo<SettingsContextValue>(() => {
    const currency: CurrencyFormat = settings
      ? {
          code: settings.currencyCode,
          symbol: settings.currencySymbol,
          minorPerMajor: 100,
          locale: settings.locale,
        }
      : DEFAULT_CURRENCY

    return {
      settings: settings ?? null,
      currency,
      money: (amount: Money) => formatMoney(amount, currency),
      loading: settings === undefined,
    }
  }, [settings])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside SettingsProvider')
  return context
}

/** Shorthand for the very common "format this amount" call. */
export function useMoney(): (amount: Money) => string {
  return useSettings().money
}

// --------------------------------------------------------------- session ---

const LOCKOUT_THRESHOLD = 5
const LOCKOUT_MS = 60_000

export interface SignInResult {
  ok: boolean
  message?: string
}

interface SessionContextValue {
  user: User | null
  signIn: (userId: string, pin: string) => Promise<SignInResult>
  signOut: () => void
  can: (permission: Permission) => boolean
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)

  /**
   * The signed-in person is read live rather than snapshotted at sign-in.
   *
   * An owner who changes what someone may do expects it to take effect, not to
   * wait until that person next signs out. Being deactivated mid-shift ends
   * the session for the same reason.
   */
  const live = useLiveQuery(async () => {
    if (!userId) return null
    const record = await db.users.get(userId)
    if (!record || record.deletedAt !== null || !record.active) return null
    return record
  }, [userId])

  const user = userId ? (live ?? null) : null

  const setUser = useCallback((next: User | null) => setUserId(next?.id ?? null), [])

  /**
   * PIN sign-in.
   *
   * Repeated wrong PINs lock the individual staff member out briefly. A
   * four-digit PIN is only a few thousand guesses, so rate limiting - not the
   * hash alone - is what actually protects the till.
   */
  const signIn = useCallback(async (userId: string, pin: string): Promise<SignInResult> => {
    const record = await db.users.get(userId)
    if (!record || record.deletedAt !== null || !record.active) {
      return { ok: false, message: 'That staff member is no longer active.' }
    }

    if (record.lockedUntil && record.lockedUntil > Date.now()) {
      const seconds = Math.ceil((record.lockedUntil - Date.now()) / 1000)
      return { ok: false, message: `Too many attempts. Try again in ${seconds} seconds.` }
    }

    const valid = await verifyPin(pin, record.pinHash)
    if (!valid) {
      const attempts = record.failedAttempts + 1
      const locked = attempts >= LOCKOUT_THRESHOLD
      await update<User>('users', record.id, {
        failedAttempts: locked ? 0 : attempts,
        lockedUntil: locked ? Date.now() + LOCKOUT_MS : null,
      })
      return {
        ok: false,
        message: locked
          ? 'Too many incorrect attempts. This account is locked for a minute.'
          : 'That PIN was not correct.',
      }
    }

    if (record.failedAttempts !== 0 || record.lockedUntil !== null) {
      await update<User>('users', record.id, { failedAttempts: 0, lockedUntil: null })
    }
    setUser({ ...record, failedAttempts: 0, lockedUntil: null })
    return { ok: true }
  }, [])

  const signOut = useCallback(() => setUserId(null), [])

  // What this person's role may do, as the shop defines it.
  const roles = useLiveQuery(() => listRoles(true), [], [])
  const rolePermissions = useMemo(
    () => (user ? (permissionsOf(roles, user.role) as Permission[]) : undefined),
    [roles, user],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      signIn,
      signOut,
      // A person's own overrides win over what their role would allow.
      // The shop's own roles decide what a role means; a permission taken away
      // there stops working as soon as the list arrives.
      can: (permission: Permission) =>
        userCan(user?.role, user?.permissionOverrides, permission, rolePermissions),
    }),
    [user, signIn, signOut, rolePermissions],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}
