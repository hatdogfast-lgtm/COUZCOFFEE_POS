import { describe, expect, test } from 'vitest'
import type { BusinessSettings } from '@pos/shared'
import { DASHBOARD_TILES, tileEnabled } from './tiles.ts'

/**
 * Which figures the dashboard shows.
 *
 * The thing worth guarding is what happens when the shop has said nothing: an
 * old settings row, a till that has never opened the screen, or a tile added in
 * a later version. Silence has to mean the tile's own default, not "off".
 */

const settingsWith = (dashboardTiles: Record<string, boolean>): BusinessSettings =>
  ({ dashboardTiles }) as BusinessSettings

describe('dashboard tiles', () => {
  test('falls back to the tile default when the shop has not chosen', () => {
    const blank = settingsWith({})
    for (const tile of DASHBOARD_TILES) {
      expect(tileEnabled(blank, tile.id)).toBe(tile.defaultOn)
    }
  })

  test('survives a settings row written before the field existed', () => {
    const old = {} as BusinessSettings
    expect(tileEnabled(old, 'cups')).toBe(true)
    expect(tileEnabled(null, 'cups')).toBe(true)
    expect(tileEnabled(undefined, 'netOfTax')).toBe(false)
  })

  test('a stored answer wins over the default, in both directions', () => {
    expect(tileEnabled(settingsWith({ netOfTax: true }), 'netOfTax')).toBe(true)
    expect(tileEnabled(settingsWith({ margin: false }), 'margin')).toBe(false)
  })

  test('one tile turned off leaves the others alone', () => {
    const settings = settingsWith({ margin: false })
    expect(tileEnabled(settings, 'cups')).toBe(true)
    expect(tileEnabled(settings, 'grossProfit')).toBe(true)
  })

  test('net of tax starts hidden and cups and net profit start shown', () => {
    const blank = settingsWith({})
    expect(tileEnabled(blank, 'netOfTax')).toBe(false)
    expect(tileEnabled(blank, 'cups')).toBe(true)
    expect(tileEnabled(blank, 'netProfit')).toBe(true)
  })

  test('every tile has a distinct id', () => {
    const ids = DASHBOARD_TILES.map((tile) => tile.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('an unknown tile is shown rather than silently dropped', () => {
    expect(tileEnabled(settingsWith({}), 'somethingLater')).toBe(true)
  })
})
