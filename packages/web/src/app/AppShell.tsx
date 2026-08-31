import { useState, type ComponentType } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ChartLine, LogOut, Receipt, Settings, ShoppingCart, UtensilsCrossed, Users } from 'lucide-react'
import type { Permission } from '@pos/shared'
import { roleLabel } from '@pos/shared'
import { ConnectionBadge, ConnectionBanner } from '../components/ConnectionBadge.tsx'
import { SyncSheet } from '../screens/SyncSheet.tsx'
import { PosScreen } from '../pos/PosScreen.tsx'
import { MenuScreen } from '../screens/MenuScreen.tsx'
import { ReportsScreen } from '../screens/ReportsScreen.tsx'
import { LedgerScreen } from '../screens/LedgerScreen.tsx'
import { StaffScreen } from '../screens/StaffScreen.tsx'
import { SettingsScreen, SETTINGS_PERMISSIONS } from '../screens/SettingsScreen.tsx'
import { Button } from '../components/ui/primitives.tsx'
import { useSession, useSettings } from './providers.tsx'
import { cn } from '../lib/utils.ts'

/**
 * The frame around every screen.
 *
 * Hash routing, deliberately: it behaves identically in the browser, in an
 * installed PWA and inside the native Android shell, and it makes the Android
 * back button work without any extra handling.
 *
 * Navigation is filtered by what the signed-in person may actually do, so a
 * cashier is never shown a door they cannot open.
 */

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Any one of these is enough to reach the screen. */
  permissions: Permission[]
}

const NAV: NavItem[] = [
  { to: '/', label: 'Till', icon: ShoppingCart, permissions: ['pos.sell'] },
  { to: '/sales', label: 'Sales', icon: Receipt, permissions: ['sales.view'] },
  { to: '/menu', label: 'Menu', icon: UtensilsCrossed, permissions: ['product.view'] },
  { to: '/reports', label: 'Reports', icon: ChartLine, permissions: ['report.view', 'shift.xreading', 'planner.manage'] },
  { to: '/staff', label: 'Staff', icon: Users, permissions: ['staff.view'] },
  { to: '/settings', label: 'Settings', icon: Settings, permissions: SETTINGS_PERMISSIONS },
]

export function AppShell() {
  const { settings } = useSettings()
  const { user, signOut, can } = useSession()
  const [showSync, setShowSync] = useState(false)

  const items = NAV.filter((item) => item.permissions.some(can))
  const businessName = settings?.branding.businessName ?? 'Point of Sale'

  return (
    <HashRouter>
      <div className="flex h-full flex-col bg-canvas">
        <ConnectionBanner />

        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5 pad-safe-top">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {settings?.branding.logoDataUrl ? (
              <img src={settings.branding.logoDataUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-brand-ink">
                {businessName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{businessName}</p>
              <p className="truncate text-xs text-ink-subtle">
                {user?.name}
                {user ? ` · ${roleLabel(user.role)}` : ''}
              </p>
            </div>
          </div>

          {/* Anyone may see the status; only some roles may open what is behind it. */}
          <ConnectionBadge compact onClick={can('sync.view') ? () => setShowSync(true) : undefined} />
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut className="h-5 w-5" aria-hidden="true" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* A rail on a counter screen; the bottom bar takes over on a phone. */}
          {items.length > 1 ? (
            <nav className="hidden w-[5.5rem] shrink-0 flex-col gap-1 border-r border-line bg-surface p-2 lg:flex">
              {items.map((item) => (
                <RailLink key={item.to} item={item} />
              ))}
            </nav>
          ) : null}

          <main className="min-w-0 flex-1">
            <Routes>
              <Route path="/" element={<PosScreen />} />
              <Route
                path="/sales"
                element={can('sales.view') ? <LedgerScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/menu"
                element={can('product.view') ? <MenuScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/reports"
                element={
                  can('report.view') || can('shift.xreading') || can('planner.manage') ? (
                    <ReportsScreen />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="/staff"
                element={can('staff.view') ? <StaffScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/settings"
                element={
                  SETTINGS_PERMISSIONS.some(can) ? (
                    <SettingsScreen />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>

        {items.length > 1 ? (
          <nav className="flex shrink-0 border-t border-line bg-surface pad-safe-bottom lg:hidden">
            {items.map((item) => (
              <TabLink key={item.to} item={item} />
            ))}
          </nav>
        ) : null}

        <SyncSheet open={showSync} onClose={() => setShowSync(false)} />
      </div>
    </HashRouter>
  )
}

function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-center transition-colors no-select press',
          isActive ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="text-[0.6875rem] font-medium">{item.label}</span>
    </NavLink>
  )
}

function TabLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors no-select touch-target',
          isActive ? 'text-brand' : 'text-ink-subtle',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="text-[0.6875rem] font-medium">{item.label}</span>
    </NavLink>
  )
}
