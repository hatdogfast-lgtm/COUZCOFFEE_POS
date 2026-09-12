# Track 1 — Visual redesign

Rebuild the appearance of all 49 `.tsx` files on a new palette, phone-portrait
first, scaling to tablet and desktop web. Behaviour does not change.

Mockups of the three candidate directions:
<https://claude.ai/code/artifact/f08ab82d-344b-47b0-a56e-11facc990df9>

---

## Decided

| | |
|---|---|
| Depth | Full redesign. Screens rebuilt on top of the existing data layer. |
| Palette | The ten colours below. Supplied by the owner. |
| Primary target | **Android phone, portrait** — plus web. Must fit tablet properly. |
| Responsive | Fluid, auto-resizing. Not a phone layout stretched wide. |
| Themes | **Both light and dark.** The dark counterpart has to be designed — the supplied palette is light-only. |
| Android | Recolour launcher + regenerate splash. Splash derives from the logo the owner uploads. |
| Sequencing | Everything. Tokens and primitives first, then all screens. |
| Logic | Frozen. See the boundary table in [`README.md`](./README.md). |

## Assumed — confirm before building

**Direction: "Counter" for the till, "Roastery" voice for what is read rather than tapped.**

**Confirmed 2026-09-12: the hybrid** — the owner picked it from the four options put
to them in the working session that produced Plan A. Counter on the till; Roastery on
the lock screen, receipt, end-of-day report, launcher and splash.

The three directions, so this can be re-cut without rebuilding the mockups:

- **Counter** — espresso chrome top and bottom, 3-up grid, 9 items per phone
  screen, 6px radius, hairlines not shadows, IBM Plex Sans + Plex Mono figures.
  Fastest at a rush; reads utilitarian.
- **Service** — no dark chrome, all cream, 2-up tiles, 6 items per screen, 18px
  radius, caramel cart bar floating in the thumb zone, Figtree. Friendliest;
  a third less menu visible.
- **Roastery** — no cards at all. Priced rows with dotted leaders like a menu
  board, Fraunces wordmark, letterspaced uppercase micro-labels, 8 items per
  screen. Most distinctive; smallest tap targets on the busiest screen.

The recommended hybrid spends Roastery on the **receipt, lock screen, end-of-day
report, launcher icon and splash** — surfaces that are read — and Counter on the
till. One system, two registers.

---

## Palette

| Role | Name | Hex |
|---|---|---|
| Primary | Deep Espresso | `#3B2416` |
| Primary light | Coffee Brown | `#6F4E37` |
| Accent | Caramel | `#C88A4A` |
| Background | Warm Cream | `#F8F3EA` |
| Surface | Milk White | `#FFFDF8` |
| Text | Dark Roast | `#241812` |
| Secondary text | Latte Gray | `#796E65` |
| Success | Matcha Green | `#58734C` |
| Warning | Honey | `#D49A3A` |
| Danger | Berry Red | `#B84C45` |

### Contrast audit — these are build rules, not suggestions

Measured against Warm Cream `#F8F3EA`. WCAG AA is 4.5:1 for body text, 3:1 for
large text and UI boundaries.

| Pair | Ratio | Rule |
|---|---|---|
| Dark Roast on Cream | 15.65 | Unrestricted |
| Deep Espresso on Cream | 13.10 | Unrestricted |
| Coffee Brown on Cream | 6.74 | Unrestricted |
| Matcha on Cream | 4.78 | Passes, narrowly |
| Berry on Cream | 4.57 | Passes, narrowly |
| **Latte Gray on Cream** | **4.49** | **0.01 short.** Use `#6A5F55` instead (5.2:1) |
| **Caramel on Cream** | **2.64** | **Fill only.** Never text, never a small icon |
| **Honey on Cream** | **2.24** | **Fill only.** Never text, never a small icon |
| Dark Roast on Caramel | 5.92 | The correct primary button: dark text on caramel |
| Dark Roast on Honey | 6.99 | The correct "low stock" chip |
| **Cream vs Milk White** | **1.09** | Cards cannot be distinguished by fill. They need a real border |

Two derived values the palette does not supply and the build needs:

```
--pos-line       #E8DFD0   hairline, because cream-on-milk is invisible
--pos-line-firm  #D8CCB8   firmer border for inputs and active chips
--pos-text2-aa   #6A5F55   Latte Gray, darkened to clear AA at body size
```

### Dark theme — designed 2026-09-12

Deep Espresso is the chrome in both themes; in dark it sits on a ground one shade
deeper (#1C120C) so the bar still reads as a bar. Surfaces are Dark Roast #241812,
ink cream.  is desaturated Caramel #D6A86E (espresso on espresso is
invisible). Every pair re-measured: . One derived value outside
the palette in both themes: warning-as-text (#8A6314 light), because Honey cannot
carry words.

---

## Responsive system

Independent of which direction is chosen. The order never leaves the screen on
the larger sizes — it stops being a bar and becomes a column, so a barista on a
phone and an owner on a laptop are using the same till.

| Width | Layout |
|---|---|
| `< 640px` phone | Menu owns the screen. Order collapses to a one-line bar (total + count); tapping raises the full list as a sheet. Bottom tabs. |
| `640–1024px` tablet | Order splits into a persistent right-hand column. Grid widens to 3-up. Tabs stay bottom — still thumb-reachable. |
| `> 1024px` laptop | Bottom tabs become a left rail; a mouse has no thumb zone. 4-up grid, wider order column. This is the shape the app already has. |

The current shell already implements the rail/tab split at `lg` —
`AppShell.tsx:88` (rail, `hidden lg:flex`) and `AppShell.tsx:130` (tabs, `lg:hidden`).
The tablet middle case is the one that does not exist yet.

---

## Scope — 49 files

- **Tokens** — `src/index.css` (the `:root` and `[data-theme='dark']` blocks),
  `tailwind.config.js`. Colours already resolve through CSS variables as
  `rgb(var(--x) / <alpha-value>)`, and Settings repaints them at runtime, so the
  token layer is the right and only place to change colour.
- **Shell** — `src/App.tsx`, `src/app/AppShell.tsx`
- **Primitives** — `src/components/ui/primitives.tsx`, `ConnectionBadge.tsx`,
  `charts/Charts.tsx`
- **Till** — `src/pos/*.tsx` (6 files; `PosScreen.tsx` is 722 lines, the largest
  in the codebase and the one most worth splitting while it is open)
- **Screens** — `src/screens/**/*.tsx` (Dashboard, Inventory, Ledger, Menu,
  Recipes, Reports, Settings, Staff, Setup, Lock, Sync + their panels, sheets
  and editors)
- **Print CSS** — the `@media print` block in `index.css`. The receipt's
  appearance only; `printing.ts` and its byte output stay.

Current token defaults for reference — note how close they already are, which is
why a palette swap alone will not read as a redesign:
`--brand: 122 74 44` (`#7A4A2C`), `--accent: 193 138 74` (`#C18A4A`).
The new work has to come from form: layout, density, typography, shape.

## Android

Current state: launcher background `#7A4A2C` in
`android/app/src/main/res/values/ic_launcher_background.xml`; app name
`Couz Coffee POS`; `scripts/brand.mjs` already regenerates all five mipmap
densities from `brand.config.json` using sharp.

Required: recolour the launcher background to Deep Espresso `#3B2416`, regenerate
splash drawables (11 density/orientation variants exist under
`android/app/src/main/res/drawable-*`), theme the Android status and navigation
bars to match, and **generate the splash from the owner's uploaded logo** rather
than a fixed asset. The existing mark is kept — no new mark was commissioned.

---

## Built — Plan A (2026-09-12)

Tokens (both themes) + contrast gate · primitives with a shared `Sheet` · shell
(bottom tabs to 1024px, rail beyond; espresso chrome) · till split into
`PosScreen` / `MenuGrid` / `CartPanel` with the three-width layout · the five till
sheets on `Sheet` · lock screen and receipt in the Roastery voice · Android launcher
colour, status/navigation bars, splash generation from `assets/logo.png`.

One `.ts` exception taken: `seed.ts` lines 57–59, three colour literals.
`providers.tsx` (plumbing) touched in two declared places: the theme-colour meta and
`useBranding`. Custom brand colours now apply to the light theme only; the four
seeded colours (old and new) count as "not chosen"; the primary button is painted
from the *Secondary* colour and the Branding panel says so. Two deliberate copy
changes on the till: the sold-out chip reads *Out*, and the phone order bar carries
a *Charge* button beside the total (the spec's bar had one tap, to the order sheet)
— veto either and it is a one-line change.

Plan: `docs/superpowers/plans/2026-09-12-ui-redesign-a-foundation-till.md`.

## Not yet built — Plan B

The remaining screens, on the primitives above: `App.tsx` (the loading state),
`charts/Charts.tsx` (on the `chart`/`chart-track` tokens), Dashboard, Sales ledger +
SaleSheet, Menu (Products, Categories, Options, Recipes, Ingredients, Import),
Reports (Shift, End of day — Roastery, P&L, Planner, Reading), Staff, Settings (all
panels), Setup, Sync sheet, and the `@media print` receipt block (appearance only;
`printing.ts` and its bytes stay). Mostly class recipes now that the token and
radius scales have moved; structural work on `RecipeEditor`, `IngredientSheet`,
`SaleSheet`, `EndOfDayPanel` (Roastery).

## Open

**Web auto-saving — parked, unanswered.**

On the Vercel deployment every sale lives in one browser's IndexedDB and nowhere
else. Nothing syncs, because `packages/server` is not deployed. Clearing site
data, switching browser or switching device loses the shop's history. The only
safety net is someone remembering to press Backup.

The owner asked for "auto saving data", was shown four options — deploy the sync
server / auto-backup to cloud storage / harden local storage only / park it —
and dismissed the question. **No option was selected.** It is recorded here
because it is a real data-loss exposure, not because it is scheduled.

Nothing in this track depends on the answer.

---

## Next actions

1. Confirm the direction assumption above.
2. Write the token layer — both themes — and validate every pair in the contrast
   table against the built page.
3. Rebuild `primitives.tsx` on the new tokens.
4. Till, then outward.
5. `npm test` must stay green at every step, unchanged.
