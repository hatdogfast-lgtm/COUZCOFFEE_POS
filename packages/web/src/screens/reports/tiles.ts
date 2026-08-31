import type { BusinessSettings } from '@pos/shared'

/**
 * The figures the reports dashboard can show.
 *
 * Which of them a shop actually wants is a matter of taste - an owner watching
 * cups cares about a different number from one watching margin - so the list
 * lives here and the choice lives in settings. A tile with no stored answer
 * falls back to `defaultOn`, so adding a tile later shows it to everyone
 * instead of hiding it behind a setting nobody knew to turn on.
 */
export interface TileSpec {
  id: string
  label: string
  /** What the tile is, in the shop's words, for the settings screen. */
  hint: string
  defaultOn: boolean
}

export const DASHBOARD_TILES: TileSpec[] = [
  {
    id: 'cups',
    label: 'Cups sold',
    hint: 'How many drinks went out, broken down by size. Snacks are counted separately.',
    defaultOn: true,
  },
  {
    id: 'netOfTax',
    label: 'Net of tax',
    hint: 'Takings with tax taken out. Off by default — the profit figures already have tax removed.',
    defaultOn: false,
  },
  {
    id: 'cogs',
    label: 'Cost of goods',
    hint: 'What the drinks sold cost to make, at the cost they were made at.',
    defaultOn: true,
  },
  {
    id: 'grossProfit',
    label: 'Gross profit',
    hint: 'Takings less what the drinks cost to make. Rent and wages are not in this.',
    defaultOn: true,
  },
  {
    id: 'netProfit',
    label: 'Net profit',
    hint: 'What is actually left after operating expenses. Add expenses on the Profit and loss section below.',
    defaultOn: true,
  },
  {
    id: 'margin',
    label: 'Margin',
    hint: 'Gross profit as a percentage of takings, over the sales whose cost is known.',
    defaultOn: true,
  },
]

/** Whether a tile shows, taking the shop's answer if it has given one. */
export function tileEnabled(settings: BusinessSettings | null | undefined, id: string): boolean {
  const stored = settings?.dashboardTiles?.[id]
  if (typeof stored === 'boolean') return stored
  return DASHBOARD_TILES.find((tile) => tile.id === id)?.defaultOn ?? true
}
