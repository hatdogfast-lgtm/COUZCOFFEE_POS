# Shift close, day close, and the watched folder

**Date:** 2026-09-13
**Status:** Design, awaiting review

## Goal

Separate the two things the till currently does in one step:

- **End of shift** — a cashier hands over their drawer. Per cashier, many per day, switchable off.
- **End of day** — the owner closes the books. One Z reading per business day, never more.

Make the whole thing run itself: nothing to open, nothing scheduled, nothing that blocks tomorrow because somebody forgot yesterday.

While here, make the "phone exports, browser imports" path automatic with a watched folder, and stop the browser evicting the shop.

## Decisions already taken

| Question | Answer |
|---|---|
| What is a shift tied to? | **One cashier.** Two cashiers on at once = two open shifts. |
| A cashier forgot to close at end of day? | **Block** the day close until every cashier shift is counted. Supervisor+ can close anyone's. |
| Shift close turned off? | **Only the day close exists.** It counts the drawer. |
| Shop open past midnight? | **Configurable** day-start hour. |
| Day ever auto-closed? | **Never.** A Z with no count behind it is worse than an open day with a nudge. |

## What exists today

`shifts` is one shared drawer session; `runZReading()` counts it, closes it, and is the Z — so every shift close bumps the Z counter and the grand total ([readings.ts](../../../packages/web/src/db/readings.ts)). `ensureShift(user)` opens a shift on the first sale if none is open ([shift.ts](../../../packages/web/src/pos/shift.ts)). `EndOfShiftSheet` shows *calendar-day* totals over a *shift-scoped* close. `RegisterReading.type` is `'X' | 'Z'`.

Backup/restore already dedupes by record id, carries tombstones, and offers `MERGE` / `CATCH_UP` / `REPLACE` ([backup.ts](../../../packages/web/src/db/backup.ts)). Import in the browser is a file picker.

## 1. Data model

### `BusinessSettings.closing` (new, optional on old rows)

```ts
closing: {
  /** Each cashier opens and closes their own shift. Off: one drawer, counted at the day close. */
  perCashierShifts: boolean   // default true
  /** Hour (0-23) the business day begins. 4 means a 1 am sale belongs to yesterday. */
  dayStartsAt: number         // default 0
}
```

Read through one accessor, `closingOf(settings)`, which supplies the defaults when the field is missing. No settings migration; a row from before this change behaves as `{ perCashierShifts: true, dayStartsAt: 0 }`.

### `Shift` (existing, +2 fields)

```ts
kind: 'CASHIER' | 'DAY'
dayKey: string   // 'YYYY-MM-DD' of the business day it belongs to
```

`openedBy` already says whose it is. A `CASHIER` shift belongs to `openedBy`. A `DAY` shift belongs to nobody in particular; it is the drawer when per-cashier shifts are off.

### `BusinessDay` (new synced entity → `businessDays`)

```ts
interface BusinessDay extends SyncMeta {
  dayKey: string
  status: 'OPEN' | 'CLOSED'
  openedAt: number
  closedAt: number | null
  closedBy: string | null
  /** Filled at close, frozen. Null while open. */
  zSequence: number | null
  totalSales: Money | null
  expectedCash: Money | null
  countedCash: Money | null
  variance: Money | null
  note: string
}
```

**Id is deterministic:** `day-<dayKey>`. Two devices that both open Sep 13 create the same row, and sync sees one record, not two. Conflict policy `LAST_WRITE_WINS` — same as `shifts`. The `zSequence` and `grandTotal` live in the Z reading's frozen payload; the row carries copies for listing.

### `RegisterReading` (existing)

```ts
type: 'X' | 'SHIFT' | 'Z'   // was 'X' | 'Z'
dayKey: string
```

`shiftId` stays: set for `SHIFT` readings; for `X` and `Z` it is the empty string (they are day-scoped). Payload shape gains a `shifts: ShiftLine[]` block on `Z` (cashier name, opened, closed, expected, counted, variance) and `dayKey` on all three.

### Storage

- **Dexie:** version 5 adds `businessDays: 'id, dayKey, status, updatedAt'` and extends `shifts` to `'id, status, openedAt, openedBy, dayKey, updatedAt'`, `registerReadings` to `'id, shiftId, type, dayKey, updatedAt'`.
- **Server:** `businessDays` table spec in `schema.ts`; new columns on `shifts` and `register_readings` are picked up by `addMissingColumns()` on next start.
- **Sync:** `'businessDays'` appended to `SYNC_ENTITIES`, `CONFLICT_POLICIES.businessDays = 'LAST_WRITE_WINS'`.
- **Backup:** nothing to do — it iterates `SYNC_ENTITIES`.

## 2. The business day

One function, in `packages/web/src/db/businessDay.ts`:

```ts
businessDayOf(at: number, closing: ClosingSettings): { dayKey: string; from: number; to: number }
```

Subtract `dayStartsAt` hours from `at`, take the local calendar date → `dayKey`; `from` is that date at `dayStartsAt:00`, `to` is `from + 24h`. `todayKey(closing)` is `businessDayOf(Date.now(), closing).dayKey`.

Every day-scoped figure uses it: `closeDay`, the X reading, `buildEndOfDay`, and the Reports "Today"/"Yesterday" ranges in `analytics.ts` (`startOfDay` there becomes business-day aware). Sales do **not** store `dayKey`; it is derived from `occurredAt`. Changing `dayStartsAt` later re-buckets live queries; every stored reading is frozen JSON and reads as it was printed.

## 3. Operations

All in `packages/web/src/db/` (readings/shifts) and `packages/web/src/pos/shift.ts`, following the existing `commit([...])` single-transaction pattern.

### Opening

```ts
ensureShift(user, settings): Shift
```

- Computes `dayKey = todayKey(closing)`.
- Ensures a `BusinessDay` row for `dayKey` exists and is `OPEN`; if it is `CLOSED` → throw `'Today is already closed. Nothing more can be sold into it.'`
- `perCashierShifts` on: find an `OPEN` `CASHIER` shift with `openedBy = user.id` and this `dayKey`, else open one.
- Off: find the `OPEN` `DAY` shift for this `dayKey`, else open one.
- A shift from a *different* `dayKey` is never reused, whatever its status.

`openShift(user, openingFloat, kind)` is the explicit form the Shift tab uses (to set a float). Same lookup, same guard.

### End my shift — `closeShift({ shift, user, countedCash, varianceReason, note })`

- Shift must be `OPEN` and `kind === 'CASHIER'`. (A `DAY` shift is closed only by the day close.)
- Caller must be `openedBy` and hold `shift.close`, **or** hold `cash.count` (supervisor+ in the built-in roles), which lets them close anyone's. The check lives in this function, not only in the UI.
- Scope: `sales.where('shiftId')`, `cashMovements.where('shiftId')` — exactly what `buildReading` does today.
- Variance ≠ 0 needs a reason (existing rule).
- Writes in one commit: `SHIFT` reading (sequence = this shift's reading count + 1, so it is 1 nearly always), shift → `CLOSED` with the counts, audit `SHIFT_CLOSE`. **Touches neither the Z sequence nor the grand total.**

### End the day — `closeDay({ dayKey, user, countedCash?, varianceReason?, note })`

- `BusinessDay` must be `OPEN`. Caller needs `shift.zreading`.
- Load every shift with this `dayKey`.
  - Any `OPEN` `CASHIER` shift → throw with the list: `'2 shifts are still open: Ana, Ben. Close them first.'`
  - An `OPEN` `DAY` shift → `countedCash` is required; the day close closes it in the same commit with that count.
- Build the Z over all sales whose `occurredAt` falls in the day's `[from, to)` (voided excluded, refunds netted — existing rules), across all shifts. Cash block = sum of each shift's float / cash sales / movements / counted / variance, plus per-shift lines.
- `zSequence` = number of existing `Z` readings + 1. `grandTotal` = previous Z's `grandTotal` + `totalSales`. Close order, not calendar order.
- Writes in one commit: `Z` reading, `BusinessDay` → `CLOSED` with the copies, the `DAY` shift close if any, audit `Z_READING`.
- After this, `ensureShift` for that `dayKey` refuses, and so does a backdated or lump-sum entry whose `occurredAt` lands in it. The guard is one function, `assertDayOpen(occurredAt, closing)`, called from `checkout.ts` on every sale-creating path.

### X reading — `runXReading({ dayKey, user })`

Day-scoped now: same computation as the Z over `[from, to)`, type `X`, sequence = X readings for this `dayKey` + 1. Stored, changes nothing. `shift.xreading` as today.

### `buildReading` refactor

Split into `computeTotals(sales, payments, discounts, movements)` (pure) and two thin callers, `readingForShift(shift)` and `readingForDay(dayKey)`. The existing 26 reading tests keep passing against the shift path; the day path gets its own.

## 4. Permissions

No new keys. Relabel in `PERMISSION_LABELS`:

| Key | Label now | Who (built-in roles) |
|---|---|---|
| `shift.open` | Open a shift | cashier+ |
| `shift.close` | Close your own shift | cashier+ |
| `cash.count` | Count and close anyone's shift | supervisor+ |
| `shift.xreading` | Run an X reading | cashier+ |
| `shift.zreading` | Close the day (Z reading) | manager+ |

Cashier gains `shift.close` so they can end their own shift. Closing somebody else's needs `cash.count`, which supervisors already have. Both checks are enforced in `closeShift`, not only by the role table.

## 5. Screens

**Till → "End of shift" button** opens `EndOfShiftSheet` as today. The summary now shows *this cashier's shift* when `perCashierShifts` is on (their cups, their takings), the day when off. Source: `buildEndOfDay({ dayKey })` for the day; `buildShiftSummary(shift)` for the shift, which is the same builder over `loadAnalytics(range, { shiftId })` — `loadAnalytics` gains that one optional filter and nothing else. Buttons by state:

| Toggle | Role | Buttons |
|---|---|---|
| on | cashier | End my shift |
| on | manager+ | End my shift · End the day |
| off | manager+ | End the day |
| off | cashier | (figures only; "A manager closes the day.") |
| any | any, day `CLOSED` | "Today is closed." — the till also refuses new orders |

`CloseShiftSheet` (shared, in `ShiftPanel.tsx`) grows a `scope: 'shift' | 'day'` prop. In day scope it lists the shifts, shows the open-cashier-shift blocker with a "Close" button per shift (opens the same sheet in shift scope, then returns), and asks for a count only when a `DAY` shift is open.

**Reports → "Shift" tab → "Day & shifts":**
- Today: day status chip, the shifts (cashier · opened · status · over/short), X reading, End the day.
- Any earlier `OPEN` day: one honey notice, *"Sep 12 was never closed"*, with the same End the day flow for that `dayKey`.
- Past days: one row per `CLOSED` day → `ReadingSheet` on its Z. Each shift row → its `SHIFT` reading.

**Settings → Rules panel** gains a *Closing* group: toggle *"Each cashier closes their own shift"*, and *"Business day starts at"* (hour select, 0–23, shown as "12:00 am … 11:00 pm"). Settings → Backup gains *"Watch a folder on this PC"* (section 7).

**`ReadingSheet` / print:** render `SHIFT` (same as today's Z) and the new `Z` (adds the per-shift block). `endOfShiftLines()` becomes `shiftReportLines()` and `dayReportLines()`; the browser and ESC/POS routes are unchanged.

## 6. Migration

One entry in `migrations.ts`, `2026-09-13-shift-kind-and-day`, idempotent:

- Every shift missing `kind` → `kind: 'CASHIER'`, `dayKey: businessDayOf(openedAt, closing).dayKey`.
- Every reading missing `dayKey` → from its shift's `openedAt`. Existing `Z` readings stay type `Z`: they *were* the Z of their day under the old model, and the grand total chain must not break. The next real Z continues the sequence from them.
- For every distinct **past** `dayKey` (strictly before `todayKey`) whose shifts are all `CLOSED` and which has at least one `Z` reading, create a `BusinessDay` `CLOSED` at the latest `closedAt`, with `zSequence` and totals copied from that day's latest `Z` — so history lists as days, and a day that was Z'd under the old model is locked like any other. A past `dayKey` with an `OPEN` shift gets an `OPEN` day (it will show in the "never closed" nudge). **Today's `dayKey` is never created by the migration**: `ensureShift` creates it `OPEN` on the next sale, so a shop that closed a shift this morning and then updated keeps selling this afternoon.
- A past day that never had a shift (a lump-sum-only day, or nothing at all) gets no row and stays open for backfilling.
- Runs behind first paint via the existing `runDataMigrations()`; safe to replay after a restore.

Old `Z` payloads lack `shifts[]`; `ReadingSheet` treats that as "one shift, this one".

## 7. Watched folder (browser only)

`packages/web/src/db/watchedFolder.ts`, behind `'showDirectoryPicker' in window`.

- **Setup:** Backup panel → *Watch a folder on this PC* → `showDirectoryPicker({ mode: 'read' })`. The `FileSystemDirectoryHandle` is stored in the `meta` table (structured-cloneable in Chromium). Permission is re-requested with `handle.requestPermission()` on the next user gesture if it lapsed.
- **Scan:** on app start (after `isSetUp()`), and every 5 minutes while the tab is open. Lists `*.json` in the folder (not recursive), reads each, `inspectBackup()`. Sorted by `manifest.createdAt`, oldest first.
- **Skip rules:** checksum already in `meta['import.applied']` (a bounded list, most recent 500) → skip. Not this shop → skip and list under *"Not from this shop"* in the panel. Any `FATAL` problem → skip and list with the reason.
- **Same shop** = the file's live `settings` row id equals this device's live settings id. So the first ever transfer is a manual **Replace** from a full backup, which makes the two the same shop; after that the folder does the rest.
- **Apply:** `restoreBackup({ mode: 'CATCH_UP', sync: 'STANDALONE' })` when not connected to a server, `'PUSH'` when connected (so the server learns what the phone did). Records the checksum. Toasts *"Caught up from phone-backup-20260913-2101.json — 84 records"*.
- **Never:** Replace, Merge, or anything with a `replaceOnly` fatal. The folder only ever catches up.
- Firefox/Safari: the button is absent; the file picker stays.

## 8. Storage persistence

`navigator.storage.persist()` once at startup in `App.tsx`, after `loadIdentity()`, result ignored. Chromium grants it silently to installed PWAs and frequently used sites; it turns "cleared under pressure" into "kept". Not a substitute for backups, and the Backup panel says so.

## 9. Known limits, stated

- Two **offline** devices both closing the **same** day: deterministic id means the second to sync arrives as a `LAST_WRITE_WINS` overwrite of the day row, and two `Z` readings with the same `dayKey` exist. Surfaced in the Day & shifts list as *"Closed twice — check the readings"*. Rule of thumb in the UI copy: close the day on one device.
- The watched folder runs only while the tab is open. There is no background service in a web page.
- A `dayStartsAt` change re-buckets live reports for history. Stored readings do not move.

## 10. Testing

`node --test` alongside the existing files:

- `businessDay.test.ts` — boundaries at `dayStartsAt` 0 and 4, DST-day sanity, `todayKey`.
- `shift.test.ts` — per-cashier lookup, `DAY` lookup, never reuses another day's shift, refuses a closed day.
- `readings.test.ts` (extended) — `closeShift` writes `SHIFT` and leaves Z sequence/grand total alone; `closeDay` blocks on open cashier shifts, closes a `DAY` shift with the count, sums per-shift cash, numbers Z in close order, carries the grand total; X is day-scoped.
- `checkout.test.ts` (extended) — a sale, a backdated sale and a lump sum into a closed day are refused.
- `migrations.test.ts` — the migration is idempotent and produces days for old closed shifts.
- `watchedFolder.test.ts` — with a fake directory handle: skips applied checksums, skips other shops, applies oldest first, records checksums.
- `backup.test.ts` — unchanged, plus `businessDays` round-trips.

## Delivery

Two plans, in order, each shippable on its own:

1. **Close model** — sections 1–6, 8, and their tests.
2. **Watched folder** — section 7 and its tests.

## Out of scope

- Reopening a closed day. If a mistake needs fixing after the Z, it is a correction entered on the next open day, with a note.
- Per-cashier *drawers* as physical hardware (kick codes per cashier).
- Auto-closing anything.
- Reading Google Drive directly from the browser.
- Renaming `shift.zreading` — the key stays; only the label changes.
