import { useMemo, useState } from 'react'
import type { Permission } from '@pos/shared'
import { useSession } from '../app/providers.tsx'
import { GeneralPanel } from './settings/GeneralPanel.tsx'
import { AuditPanel } from './settings/AuditPanel.tsx'
import { BackupPanel } from './settings/BackupPanel.tsx'
import { RulesPanel } from './settings/RulesPanel.tsx'
import { ListsPanel } from './settings/ListsPanel.tsx'
import { PrinterPanel } from './settings/PrinterPanel.tsx'
import { BrandingPanel } from './settings/BrandingPanel.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Setting the shop up, and looking after it.
 *
 * Configuration, the audit trail and backups are all things an owner does
 * rather than things a shift does, so they share one screen behind tabs
 * instead of taking three slots in the navigation. Each tab is gated on its
 * own permission, so a supervisor who may read the trail but not change the
 * VAT rate simply sees one tab.
 */

type Tab = 'GENERAL' | 'BRANDING' | 'RULES' | 'LISTS' | 'PRINTER' | 'AUDIT' | 'BACKUP'

/**
 * Everything that gets somebody onto this screen.
 *
 * Exported so the navigation entry and the route guard are the union of the
 * tab gates by construction. Written out twice, they drift: a permission
 * granted for a tab here would be filtered out of the navigation there, and
 * the grant would be real, audited, shown as on in the staff sheet, and
 * reach nothing.
 */
export const SETTINGS_PERMISSIONS: Permission[] = [
  'settings.view',
  'audit.view',
  'backup.run',
  'backup.restore',
]

export function SettingsScreen() {
  const { can } = useSession()

  const tabs = useMemo(() => {
    const all: Array<{ id: Tab; label: string; allowed: boolean }> = [
      { id: 'GENERAL', label: 'General', allowed: can('settings.view') },
      { id: 'BRANDING', label: 'Shop', allowed: can('settings.view') },
      { id: 'RULES', label: 'Rules', allowed: can('settings.view') },
      { id: 'LISTS', label: 'Lists', allowed: can('settings.view') },
      { id: 'PRINTER', label: 'Printer', allowed: can('settings.view') },
      { id: 'AUDIT', label: 'Audit trail', allowed: can('audit.view') },
      { id: 'BACKUP', label: 'Backup', allowed: can('backup.run') || can('backup.restore') },
    ]
    return all.filter((entry) => entry.allowed)
  }, [can])

  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'GENERAL')
  const active = tabs.some((entry) => entry.id === tab) ? tab : (tabs[0]?.id ?? 'GENERAL')

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line bg-surface px-4 pt-2">
        <div className="scroll-pane -mx-1 flex gap-1 overflow-x-auto px-1">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                'shrink-0 border-b-2 px-3.5 pb-2.5 pt-1.5 text-sm font-medium transition-colors no-select',
                active === entry.id
                  ? 'border-brand text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {active === 'GENERAL' ? <GeneralPanel /> : null}
        {active === 'BRANDING' ? <BrandingPanel /> : null}
        {active === 'RULES' ? <RulesPanel /> : null}
        {active === 'LISTS' ? <ListsPanel /> : null}
        {active === 'PRINTER' ? <PrinterPanel /> : null}
        {active === 'AUDIT' ? <AuditPanel /> : null}
        {active === 'BACKUP' ? <BackupPanel /> : null}
      </div>
    </div>
  )
}
