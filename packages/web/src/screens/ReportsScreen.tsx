import { useMemo, useState } from 'react'
import { useSession } from '../app/providers.tsx'
import { DashboardScreen } from './DashboardScreen.tsx'
import { EndOfDayPanel } from './reports/EndOfDayPanel.tsx'
import { ShiftPanel } from './reports/ShiftPanel.tsx'
import { PlannerPanel } from './reports/PlannerPanel.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Reports, in one place.
 *
 * The dashboard says what happened over a period, end of day says what happened
 * on one day and what it was made of, the shift tab says what is in the drawer
 * right now, and the planner says what was supposed to happen. They are four
 * questions about the same money, so they sit behind tabs rather than four
 * separate entries in the navigation.
 */

type Tab = 'DASHBOARD' | 'END_OF_DAY' | 'SHIFT' | 'PLANNER'

export function ReportsScreen() {
  const { can } = useSession()

  const tabs = useMemo(() => {
    const all: Array<{ id: Tab; label: string; allowed: boolean }> = [
      { id: 'DASHBOARD', label: 'Dashboard', allowed: can('report.view') },
      // Same permission as the dashboard, which already shows cost and margin -
      // a second rule here would only be a different answer to the same question.
      { id: 'END_OF_DAY', label: 'End of day', allowed: can('report.view') },
      { id: 'SHIFT', label: 'Shift', allowed: can('shift.xreading') || can('shift.zreading') || can('shift.open') },
      { id: 'PLANNER', label: 'Planner', allowed: can('planner.manage') },
    ]
    return all.filter((entry) => entry.allowed)
  }, [can])

  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'DASHBOARD')
  const active = tabs.some((entry) => entry.id === tab) ? tab : (tabs[0]?.id ?? 'DASHBOARD')

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
        {active === 'DASHBOARD' ? <DashboardScreen /> : null}
        {active === 'END_OF_DAY' ? <EndOfDayPanel /> : null}
        {active === 'SHIFT' ? <ShiftPanel /> : null}
        {active === 'PLANNER' ? <PlannerPanel /> : null}
      </div>
    </div>
  )
}
