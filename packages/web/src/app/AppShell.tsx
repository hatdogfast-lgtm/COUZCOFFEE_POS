import type { ComponentType } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ChartLine, LogOut, Receipt, Settings, ShoppingCart, UtensilsCrossed, Users } from 'lucide-react'
import type { Permission } from '@pos/shared'
import { roleLabel } from '@pos/shared'
import { PosScreen } from '../pos/PosScreen.tsx'
import { MenuScreen } from '../screens/MenuScreen.tsx'
import { ReportsScreen } from '../screens/ReportsScreen.tsx'
import { LedgerScreen } from '../screens/LedgerScreen.tsx'
import { StaffScreen } from '../screens/StaffScreen.tsx'
import { SettingsScreen, SETTINGS_PERMISSIONS } from '../screens/SettingsScreen.tsx'
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
 * cashier is never shown a door they cannot open. It sits at the bottom on a
 * phone and a tablet - where a thumb is - and moves to a rail on a laptop,
 * where a mouse has no thumb zone.
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

  const items = NAV.filter((item) => item.permissions.some(can))
  const businessName = settings?.branding.businessName ?? 'Point of Sale'

  return (
    <HashRouter>
      <div className="flex h-full flex-col bg-canvas">
        <header className="flex shrink-0 items-center gap-3 bg-chrome px-3 pb-2.5 pt-2 text-chrome-ink pad-safe-top">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {settings?.branding.logoDataUrl ? (
              <img src={settings.branding.logoDataUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">
                {businessName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-[0.8125rem] font-semibold leading-tight">{businessName}</p>
              <p className="truncate text-[0.6875rem] leading-tight text-chrome-muted">
                {user?.name}
                {user ? ` · ${roleLabel(user.role)}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-full text-chrome-muted transition-colors hover:bg-chrome-ink/10 hover:text-chrome-ink"
          >
            <LogOut className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* A rail on a laptop; the bottom bar takes over below 1024px. */}
          {items.length > 1 ? (
            <nav className="hidden w-[5rem] shrink-0 flex-col gap-0.5 border-r border-line-strong bg-surface p-1.5 lg:flex">
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
          <nav className="flex shrink-0 border-t border-line-strong bg-surface pad-safe-bottom lg:hidden">
            {items.map((item) => (
              <TabLink key={item.to} item={item} />
            ))}
          </nav>
        ) : null}
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
          'flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center transition-colors no-select press',
          isActive ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="micro">{item.label}</span>
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
          'flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 transition-colors no-select touch-target',
          isActive ? 'text-brand' : 'text-ink-subtle',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="micro text-[0.625rem]">{item.label}</span>
    </NavLink>
  )
}
