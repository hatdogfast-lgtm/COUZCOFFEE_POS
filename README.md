# Offline-first Point of Sale

A coffee shop POS, inventory, recipe-costing and reporting system built as an
offline-first distributed application. The till is not an online app with an
offline fallback bolted on — the device's own database *is* the working
database, and synchronisation is a separate concern that runs behind it.

Runs as a web app, an installable PWA on iOS and Android, and a native
Android/iOS app from the same codebase.

---

## Quick start

```bash
npm install
```

Run the sync server and the till together:

```bash
npm run dev
```

- Till: <http://localhost:5174>
- Sync server: <http://localhost:4000>

On first run the app asks for a business name, an owner name and a PIN. There
is no default login — a POS with a known factory PIN is a POS anyone can open
the drawer on.

To connect a till to the server, open the status indicator in the header →
**Connect this device**, with the server address and the enrolment code
(`letmein` in development; set `POS_ENROLMENT_CODE` in production).

A second till joins the same shop from the setup screen via **Join an existing
one** — it enrols and pulls the whole business down rather than creating a
second one.

---

## How it is put together

```
packages/shared    Types, pricing engine, unit maths, RBAC, PIN hashing,
                   and the sync protocol. Plain TypeScript, no dependencies.

packages/server    Central sync hub: node:sqlite + ws.
                   No native compilation, no build step, one database file.

packages/web       The till: Vite + React + TypeScript + Tailwind,
                   Dexie (IndexedDB) locally, PWA, Capacitor for native.
```

### The rule everything else follows

A sale is committed to the device's IndexedDB — the sale, its lines, its
discounts, its payments, the stock it consumed and the audit entry, **plus the
outbox rows that will carry them to the server** — in a single transaction.
The sale is complete the moment that transaction commits. Nothing about
completing a sale touches the network.

That is why the till does not stop when the internet does, and why there is no
window in which a sale exists locally but will never be sent.

### Why stock is a ledger, not a number

Stock on hand is the sum of `inventoryMovements`, never a stored quantity. Two
tills selling from the same milk while both offline each append their own
consumption; when they reconnect, the movements merge and the total is right.
If stock were one mutable number, the second device to sync would overwrite the
first one's day. This is the single design decision that makes offline
multi-device inventory correct rather than merely hopeful.

### Conflicts

Immutable facts — a completed sale, a stock movement, an audit line — are
`APPEND_ONLY` and can never conflict; two devices never edit what the other
wrote. Only genuinely mutable records (a price, a recipe, settings) can
disagree, and those are surfaced for a person to settle. The local record is
never discarded by the server.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Server + till together |
| `npm run dev:web` | Till only (works with no server at all) |
| `npm run dev:server` | Sync server only |
| `npm test` | Every test in every package |
| `npm run typecheck` | Type-check all packages |
| `npm run build` | Production PWA build |

Server configuration lives in the environment — see `.env.example`. Nothing
secret is hard-coded, and the server refuses to start in production without a
real signing secret and enrolment code.

---

## The three platforms

The same build serves all of them.

**Web** — any modern browser. Installable as a PWA from the address bar.

**iOS (iPhone / iPad)** — open the site in Safari → Share → *Add to Home
Screen*. It runs full-screen with its own icon, works offline, and syncs. For a
real App Store build, the Xcode project is at `packages/web/ios` — that step
needs a Mac and an Apple Developer account, which is Apple's rule rather than a
limitation of the app.

**Android (phone / tablet)** — installable as a PWA, or built as a real APK:

```bash
npm run android:apk
```

The APK lands at
`packages/web/android/app/build/outputs/apk/debug/app-debug.apk` (~4.2 MB,
`com.pos.offlinefirst`, minSdk 22 so Android 5.1 and up, targetSdk 34).

Install it by copying the file to a device and opening it, or over USB:

```bash
adb install -r packages/web/android/app/build/outputs/apk/debug/app-debug.apk
```

The build script finds the Android SDK and a JDK on its own, so there is no
environment to set up first. If no JDK is present it says exactly what to
install. For a Play Store release you need a signed release build — generate a
keystore and run `gradlew assembleRelease`.

Native builds serve the compiled app from the device itself, so the till starts
and completes sales with no network at all.

App icons for every platform are generated from one source:

```bash
npm run icons
```

---

## Running it for real, at no hosting cost

The server is a single Node process and a single SQLite file. It runs on any
always-on machine on the shop's network — a spare laptop, a mini PC, a
Raspberry Pi. Point the tills at its LAN address.

```bash
POS_ENROLMENT_CODE=<something long> POS_JWT_SECRET=<something long> \
NODE_ENV=production npm run dev:server
```

Back up by copying `packages/server/data/pos.db`.

If that machine is off, unplugged or unreachable, every till keeps trading and
syncs when it returns. There is no paid dependency anywhere in the stack.

---

## What is verified, and how

373 tests, all against real implementations — a real SQLite file, real HTTP, a
real WebSocket, a real IndexedDB. No mocked sync.

- **`packages/shared`** (69) — pricing, VAT, the statutory Senior/PWD
  concession, discount allocation to the centavo, PIN hashing. Then the
  printer protocol, byte for byte: the reset that opens every job, the cut, the
  drawer kick, emphasis that cannot leak into the next line, columns that keep
  the amount against the right margin when the name is too long, and the ASCII
  folding that stops a peso sign printing as a stray glyph. And the logo:
  GS v 0 with the width in bytes and the height in dots, centred and then set
  back to the left, a truncated image dropped rather than fed past the end of
  the printer's buffer, and the placeholder that keeps it visible in the
  text preview instead of silently vanishing.
- **`packages/server`** (11) — the two offline scenarios from the brief: twenty
  sales made offline all arriving intact, and two devices trading independently
  without either overwriting the other. Also conflict detection, idempotent
  retries, and realtime delivery.
- **`packages/web`** (293) — the atomic sale commit, recipe-driven stock
  deduction, availability, change, receipt numbering, the reason requirement on
  stock losses, weighted-average re-costing on a delivery, stock counts as
  corrections rather than edits, recipe costing, and tombstoning on recipe
  edits, plus the reporting figures: profit net of tax, voided sales excluded,
  quiet hours kept in the chart, offline payments reported as unverified, and
  the void/refund rules: no double voids, no over-refunding, stock returned
  only when asked, and records written before a field existed not being
  mistaken for refunds. Then the readings: an X reading leaving the shift
  running, a Z reading closing it exactly once, a drawer that does not balance
  refusing to close unsigned, the register total carrying forward across
  shifts, and a reading not being rewritten by a sale rung up after it. And
  the planner: shares holding their shape as the target moves, and a passcode
  that is never stored readable and cannot be removed without the current one.
  Then backup and restore: a backup never carrying the device identity or the
  server token, an edited file being refused, a merge that cannot overwrite,
  tombstones surviving, receipt numbering never re-issuing a number the
  restored sales already use and never moving backwards, another terminal-s
  numbering left alone, and the migration list travelling with the data it
  describes. And the audit trail: a diff naming only the fields that moved, an
  unknown action still reading as words, amounts shown as money while
  micro-minor-unit fields are left raw, and CSV quoting that survives a comma.
  And receipts: a reprint saying what the original said, a duplicate marked as
  one, change worked out from what was actually tendered, modifiers named
  rather than printed as [object Object], and settings that predate the printer
  still able to print. And the till switches: backdating off unless it was
  deliberately turned on, a GCash sale refused without its reference (including
  when the reference is only whitespace), methods the shop did not name left
  alone, cups and snacks counted separately onto the sale, and a sale written
  before the split reported as cups rather than as nothing.

```bash
npm test
```

### Measured, not assumed

Two tills on one server: a sale completed on one appeared on the other in
**1.3 seconds**, with no refresh — local commit → outbox → push → WebSocket
broadcast → pull → local write → UI.

---

## Inventory and recipes

**Inventory** lists stock worst-first, because "what am I about to run out of?"
is the question the screen exists to answer. Every figure is derived from the
movement ledger, so it is identical on every synced device.

Four operations, all of which append rather than overwrite:

- **Delivery** — adds stock, and if you enter what it cost, re-prices the
  ingredient as a *weighted average* of the old stock and the new. Replacing
  the rate outright would misstate the stock bought at the old price that is
  still on the shelf.
- **Wastage / spoilage / damage** — removes stock, and will not proceed
  without a reason.
- **Adjustment** — a signed correction, also requiring a reason.
- **Count** — reconciles against a physical count by writing the *difference*
  as its own movement. History is never edited, so the discrepancy stays
  visible.

**Recipes** are costed at today's ingredient rates every time they are read, so
re-pricing a sack of beans immediately re-prices everything made from it —
while sales already recorded keep the cost they were sold at. The editor shows
cost, profit and margin live as you type, splits ingredient cost from packaging
cost, and shows each ingredient's share of the total. Quantities are entered in
whatever unit reads naturally (18 g, not 0.018 kg) and stored in the base unit,
so a recipe in grams and a sack bought in kilos always agree.

Recipe edits tombstone removed rows rather than deleting them, so a removal can
travel to other devices instead of the ingredient reappearing on the next sync.

## Reports

Leads with the number an owner opens the app for; everything below it explains
that number. Revenue by hour (or by day over a longer range), top products
rankable by revenue, units sold, profit or margin — which give genuinely
different answers, since the best seller is rarely the best earner — plus
revenue by category, payment mix, and per-staff takings.

Profit is revenue **net of tax**, less cost of goods at the price it was sold
at. Voided sales are excluded from every figure and reported separately.
Payments taken while a till was offline are flagged as unverified, so the
takings total never quietly implies a confirmation nobody has.

It reads from the device's own records, so it works with the internet down,
and re-reads itself when sales sync in from another till.

The charts use one validated hue — checked with the
[data-viz validator](https://github.com/anthropics/skills) for lightness band,
chroma floor and 3:1 contrast against this app's own light and dark surfaces,
with a separately chosen step per mode rather than an automatic flip. The hue
is deliberately fixed rather than following the configurable brand colour, so a
pale brand choice can never render a chart unreadable. Every ranked list prints
its values as text beside the bar, so no figure is reachable only by hovering.

## Sales, voids and refunds

Every transaction is searchable by whatever someone actually remembers - a
receipt number, the queue number that was called out, a customer name, or just
latte.

**Void** and **refund** are deliberately separate. A void says the order never
really happened: it is marked cancelled and drops out of every report. A refund
says money is going back for something that did: it is written as its **own
sale with negative amounts**, linked to the original, so every report that sums
sales nets the two out with no special handling and the original receipt still
says exactly what the customer was charged on the day.

Neither edits history. Both require a reason, and both are recorded in the
audit trail with who did it.

Stock only comes back if someone says it should. A drink that was made and
handed over is not back on the shelf because the money went back - so the
toggle defaults on for a void and off for a refund.

A refund is not counted as an order, which would otherwise inflate the order
count and drag the average order value towards a number nobody ever paid.

## Loyalty claims

A loyalty redemption is claimed **per drink, and by the count**: on a line of
three lattes you can mark one free and charge for two. It is claimed: any line in the order can be
marked free against a card, while the rest of the order is paid for normally.
The claimed line stays on the receipt at its menu price so the customer can see
what it was worth, and a matching redemption takes that value back off the
total. It is recorded as a redemption rather than as money received - **revenue stays at zero**, because
nothing was taken. The stock is still consumed and the cost of goods is still
real, because a free cup costs exactly as much to make as a paid one. The
reports show how many were claimed, what they were worth at menu price, and
what they actually cost, which is the true price of the scheme.

## Entering orders after the fact

An order can be dated **Today, Yesterday or a specific time** - for one taken
while the till was unavailable. The record still carries when it was keyed in,
so the gap is visible to anyone auditing the day.

A whole past day can be recorded as a **single figure** - a total and a cup
count - for days before this system was in use. It deliberately invents no
detail it does not have: no line items, no stock movements, and no cost of
goods, because the cost is unknown rather than zero. Those days count towards
revenue but are kept out of margin, so a backfilled day cannot flatter the
figures with a margin it never earned.

## Staff and permissions

Everyone gets their own account and their own PIN, so the audit trail can name
who did what. A role sets a sensible starting point; from there every permission
is a switch on that person's own account.

The distinction the screen keeps is between "off because the role says so" and
"off because you decided". Switching a permission back to match its role
**clears** the adjustment rather than pinning it, so that person keeps following
the role if what the role means later changes. Each row says which of the two it
currently is.

Changes take effect immediately - the signed-in person's record is read live, so
revoking something reaches them mid-shift rather than waiting for them to sign
out. Deactivating an account ends its session the same way.

Two things are deliberately not possible: switching off your own access, and
removing or demoting the last active owner. There is no support line to call if
you lock yourself out of your own shop.

Accounts are switched off rather than deleted, so past sales keep pointing at a
real person. PINs are replaced, never revealed, and the audit records that one
changed without recording what it changed to.

## Profit and loss

Gross profit is where most till reports stop, and it is the number that
flatters a coffee shop most - it has not yet paid rent or anyone's wages. The
statement carries on past it:

```
Sales                                     +
Less: tax collected                       -   (never anybody's profit)
Net sales                                 =
Less: cost of ingredients and packaging   -   (at the cost it was sold at)
Gross profit                              =
Less: staff pay, rent, utilities, ...     -
Net profit                                =
```

Running costs are recorded with a category, a date and whether they are fixed
overhead or vary with trade; payroll can name the person it was for. A period
containing a backfilled day says so, because that day has no cost of goods and
would otherwise flatter gross profit silently.

## Shift readings

An X reading is a look at the register part-way through the day and changes
nothing, so it can be taken as often as anyone likes. A Z reading is the
closing one: it counts the drawer, records the variance and shuts the shift,
and there is exactly one per shift.

Both are computed from the sales themselves rather than from a running
counter. A counter drifts when a sale arrives late from another till; a
recomputation cannot. What is stored is the finished snapshot, so a reading
taken this morning still reads the same next year even if a sale is corrected
in between.

The drawer is reconciled as:

```
Opening float
  + cash sales            (refunds already netted out)
  + money put in
  - money taken out, petty cash, drops to the safe
  = expected in drawer
```

against what was actually counted. A discrepancy has to be explained before
the shift will close - the Z reading refuses otherwise. Each Z reading also
carries the register total across every Z reading ever taken, which by
convention never resets and is what an audit reconciles against.

## The sales planner

A target on its own is a wish; what makes it useful is deciding in advance
where the money goes. Set a target for the month and give each set-aside -
stock, wages, an emergency reserve, improvements - a percentage of it. Because
the shares are percentages and not amounts, moving the target moves every
set-aside with it and the plan keeps its shape.

Each row shows two figures: what the set-aside is worth if the target is met,
and what it is worth on the money that has actually come in so far. Alongside
sit the progress against target, what must be taken per remaining day to still
land on it, and where the month ends up if the current rate holds.

Targets are kept per month, so last month's plan is still there to compare
against.

The screen is behind the `planner.manage` permission, and can additionally
carry a passcode of its own for the shop where the owner is signed in on a
shared till. It is hashed exactly as a PIN is, so a forgotten passcode cannot
be looked up - only replaced by someone who knows the current one.

## The audit trail

Every consequential change writes a row to the audit log inside the same
transaction as the change itself. That ordering is the whole point: the trail
cannot disagree with what happened, because it is part of what happened. There
is no code anywhere in the app that edits or deletes an audit row, and no
control in the interface that would.

Settings → Audit trail reads it back. Filter by period, by area of the shop, or
by person; search across the reason, the wording, the record and the payloads.
Opening an entry shows which fields actually moved and what they moved from —
"Status OPEN → CLOSED", not two blobs of JSON side by side. Amounts are shown as
money rather than as the integer minor units they are stored in, from a curated
list of fields; `costRate` is deliberately excluded from it, because it is held
in micro-minor units and showing it as money would be wrong by a factor of a
million in a way that looks entirely plausible.

The filters are built from the entries that actually exist rather than a fixed
list, so an action added to the app later appears here on its own. An action
nobody has written wording for still reads: `SOMETHING_NEW_HAPPENED` becomes
"Something new happened".

## Backup and restore

A backup is every business record this device holds, in one readable JSON file,
checksummed with SHA-256 over a canonical form so a truncated or hand-edited
copy is caught rather than trusted.

What it deliberately leaves out is the local `meta` table, because that one
bucket holds three different kinds of thing and there is no single right answer
for all of them:

- **Preserved**: the device id and the server token. A file carrying those,
  restored onto a second terminal, would clone the first one's identity — and
  two tills sharing a device id discard each other's changes as their own echo,
  a corruption that shows up on the server rather than on the device where
  somebody could see it.
- **Recomputed**: the receipt and queue counters. They are device-local and were
  never part of the synced data, so restoring them from a file re-issues receipt
  numbers over the top of real ones — and nothing downstream catches it, because
  the index on `receiptNo` is not unique and the server upserts on id. After a
  restore the counter is recomputed from the restored sales that carry *this*
  terminal's code, and never moves backwards.
- **Carried with the data**: which one-off migrations have been applied. That
  belongs to the rows, not the device, so it travels in the manifest and is put
  back with them.

Restoring is the only thing in the app that destroys data on purpose, so it is
built to be hard to do by accident and impossible to do blindly. The file is
checked first and shown table by table against what is already on the device.
There are two ways to put it back:

- **Add what is missing** — writes only ids the device has never seen and
  overwrites nothing. For when one thing was deleted by mistake.
- **Replace everything** — empties every business table first, so what is left
  is exactly the file. A copy of the current data downloads automatically first,
  and the word REPLACE has to be typed out.

Then a separate question, asked plainly because there is no answer that is right
in every case:

- **Carry on syncing as normal** — the cursor is reset so the server is read
  again from the beginning, and where it has a record, its copy wins. Right when
  this device was the thing that broke.
- **This device is the surviving copy** — every restored record is queued up to
  the server. Only for a server that was lost and is being rebuilt; on a working
  shop this overwrites the other tills with old data.
- **Keep this device off the server** — disconnects entirely, so nothing
  restored can ever be pushed.

Before any of it, the sync engine is stopped and any cycle already in flight is
awaited: a push mid-flight would otherwise come back and write its result into
an outbox that had just been emptied, losing work with no error. Afterwards the
app reloads itself, because the device identity, the sync cursor, the signed-in
user and the applied-migrations list are all read once at boot — live queries
would make the screen *look* right while those stayed stale.

A restore is refused outright if the file fails its checksum, was written by a
newer version, or — when replacing — contains no settings or no active staff,
which would leave nobody able to sign in.

## Receipts and thermal printing

Receipts are composed once and rendered twice: to ESC/POS bytes for a thermal
printer, and to monospaced HTML for the browser's own print dialogue. One
composer means the paper and the on-screen preview cannot disagree about what
was charged — the preview in Settings is the receipt, not an impression of it.

A shop prints one of three ways, and all three are supported rather than one
being assumed:

| Route | For | Notes |
|---|---|---|
| **Print dialogue** | Any printer the device already knows | Works everywhere, including iPhones and iPads. The default. |
| **Bluetooth** | The counter-top thermal printers | Web Bluetooth. Prints immediately, no dialogue. |
| **USB** | A printer plugged into the till | WebUSB. Prints immediately. |

Paper width is 58mm (32 characters) or 80mm (48 characters), chosen in
Settings → Printer against a live preview, because finding out at the counter
that the right-hand column is cut off is the failure worth preventing.

Two deliberate limitations in the ESC/POS path, both about honesty rather than
cleverness:

- **Text is folded to ASCII.** A thermal printer's default code page has no
  peso sign and no smart quotes, and a byte it does not recognise prints as a
  random glyph. `₱1,250.00` becomes `P1,250.00`, and `José Peñaflor` becomes
  `Jose Penaflor`. Ugly in one place, correct on every printer.
- **Only Font A.** Font B is narrower and tempting, but its width varies
  between manufacturers, and a column layout that is right on one printer and
  wrong on another is worse than one plainly right on both.

The receipt carries what a Philippine receipt is expected to carry: the
business and its TIN, the VATable / VAT-exempt / zero-rated split, the VAT
itself, and — where a senior citizen or PWD concession was given — the
identification, the beneficiary's name and a line to sign, which is what makes
the concession auditable rather than a discount somebody typed in.

A duplicate says `*** REPRINT ***` across its face, and a void or refund
says so too, so a second copy can never be presented as a second sale.
Reprints are rebuilt from the stored sale rather than from anything on screen,
so a receipt printed a month later says exactly what the original said.

X and Z readings print on the same roll through the same layout code, with
lines to sign at the bottom.

Before this existed the Print buttons called `window.print()` with no print
stylesheet, which printed the application — header, navigation and all. There
is now a print stylesheet that hides everything except the receipt and sizes
the page to the roll, so the driver does not scale it down to fit A4.

## Making it your shop

Settings → **Shop** is where the coffee shop becomes yours. Nothing here is in
the code, and nothing needs a rebuild or a redeploy:

| What | Where it shows up |
|---|---|
| Logo | App header, sign-in screen, and the top of every receipt |
| Shop name, tagline | Header, sign-in screen, receipts |
| Registered name, address, contact, email, social | Receipt heading |
| Tax identification number | Printed as `VAT REG TIN` |
| Receipt footer | Last line before the thank-you |
| Primary / secondary / accent colours | Buttons, highlights, and positive figures |
| Light, dark, or match the device | The whole interface |

The colours and the theme apply the instant you pick them, because a colour
you cannot see until you save is a colour you pick twice.

**The logo** is resized to at most 512px and re-encoded on upload, because it
travels inside the settings record to every till — a 4MB photo off a phone
would otherwise be pushed around the shop forever. PNG keeps a transparent
background; anything else becomes JPEG. For a thermal printer it is converted
again, to one bit per dot at the print head's width (384 dots on 58mm paper,
576 on 80mm), using ordered dithering rather than a hard threshold — a flat
cut-off turns any logo with shading into a black blob.

### How a setting reaches every device

Branding is stored on the `settings` record, which is an ordinary synced
entity. So the path is exactly the path a sale takes:

```
Change it on any device
  → written to that device's IndexedDB, with an outbox row, in one transaction
  → pushed to the sync server
  → server appends it to the change log and broadcasts over WebSocket
  → every other till pulls it and writes it locally
  → their screens update on their own, because the UI reads a live query
```

Measured on two tills against one server, a change lands on the other device in
about **1.3 seconds**, with nobody refreshing anything.

Two consequences worth knowing:

- **It works offline.** Change the shop name on a tablet with no signal and it
  is correct on that tablet immediately; the change waits in the outbox and
  goes out when the network returns.
- **There is no separate admin site to deploy.** The "backend" is the same app,
  behind the `settings.edit` permission. Sign in as the owner on a laptop, or
  on the phone in your pocket — same screen, same effect.

### The same on web, Android and iOS

There is one codebase and one build. What differs is only how the build is
delivered:

| | How it runs | Gets updates | Logo and settings |
|---|---|---|---|
| **Web** | The browser loads it from the dev server or wherever you host it | On reload | Synced from the server |
| **Android** | The APK ships the build inside the app | New APK | Synced from the server |
| **iOS** | Safari → Share → *Add to Home Screen* | On reload | Synced from the server |

So an Android till and an iPhone show the same logo and the same colours as the
laptop, without any of them being rebuilt — the branding is data on the server,
not part of the app binary. Rebuilding is only needed to change the *code*.

The one thing that is genuinely per-device is which printer that till uses:
Settings → Printer keeps the paper width and route with the shop, but the
paired Bluetooth or USB printer belongs to the terminal it was paired on, which
is correct — the tablet at the counter and the laptop in the office do not
share a printer.

## Switches an owner controls

Three things at the till are decided in Settings rather than in the code, and
two of them are deliberately off until someone asks for them.

### Recording past days

Settings → General → **Allow recording past days**. Off by default, because
backdating rewrites the books and a control nobody uses is a control nobody is
watching.

It takes *two* things to reach it, and they are separate on purpose:

1. the shop-wide switch decides whether the feature exists at all, and
2. the **Record past days and backdated orders** permission decides who may
   use it — set per person in Staff, like every other permission.

Managers and owners have it by default; a barista does not, but can be granted
it individually. With the switch off, nobody sees the controls at all — the
date picker and the past-day takings box are simply not on the screen, rather
than being present and refusing.

### Payments that need a reference number

Settings → General → **Payments that need a reference number**, with GCash,
Maya and Card each independently Required or Optional.

When a method is required, the till will not complete the sale until the
reference is entered: the field is marked required, the Complete sale button
stays disabled, and `completeSale` refuses it as well — the check is in the
data layer too, not only in the sheet, because that is the path every sale
takes. The same applies to a backfilled day.

The reason is end-of-day reconciliation: a GCash payment with no reference
cannot be matched against the wallet statement, which is exactly the moment it
matters.

### Cups and snacks

A coffee shop counts its day in cups, and a pastry is not a cup. Menu →
**Categories** is where each category is marked as counted in *cups* or in
*snacks* — on the category rather than on each product, so a drink added next
year is counted correctly the moment it is filed, with nobody having to
remember.

Everything defaults to cups, because in a coffee shop that is most of the menu,
and a record written before this existed is reported as cups rather than as
nothing — reporting it as zero would understate every day already on the books.

The split then shows up everywhere the count matters:

- **The cart** — "1 cup · 1 snack" rather than one lumped number.
- **Every sale** — both figures are recorded at the moment of sale, not worked
  out later from the category, so recategorising something never moves the
  count on a day that is already closed.
- **Recording a past day** — two counters, cups and snacks.
- **X and Z readings** — cups and snacks on their own lines.

## Putting it on the internet, free

The shop works on its own LAN with no internet at all. You only need this when
a till is somewhere else — a second branch, a phone away from the shop, or you
want to check the books from home.

Two separate things can go online, and they are worth keeping apart:

| | Who needs it | Free option |
|---|---|---|
| **The sync server** | All three platforms | Cloudflare Tunnel from your own PC |
| **The web app** | Web and iOS only — the Android APK carries its own copy | Cloudflare Pages, Netlify, Vercel, GitHub Pages |

### The sync server, from your own computer

The obstacle is not the server — it is that a home internet connection has no
fixed address, no certificate, and a router in the way. A tunnel solves all
three at once and needs no port forwarding:

```bash
npm run dev:server
```

```bash
cloudflared tunnel --url http://localhost:4000
```

That prints an `https://something.trycloudflare.com` address. Put that into
each till at **Connect this device**, and they sync over the internet.

The realtime socket needs nothing extra: the client upgrades `ws:` to `wss:`
by itself when the server address is HTTPS.

A quick tunnel gets a new address every restart. A free Cloudflare account plus
a domain gives a permanent one, which is what you want once real tills depend
on it. **Tailscale** is the other good answer, and a better one if every till
belongs to you: the devices join a private network and the server is never
exposed to the internet at all.

Whichever you choose, in production the server refuses to start without these:

```bash
POS_JWT_SECRET=<long random string>
POS_ENROLMENT_CODE=<long random string>
POS_ALLOW_ORIGIN=https://your-web-app-address
NODE_ENV=production
```

Set `POS_ALLOW_ORIGIN` to the address you serve the app from. It defaults to
`*`, which is fine on a shop LAN and too generous on the open internet.

Your computer has to be awake and running for tills to sync — but they keep
trading while it is off and catch up when it returns, which is the whole point
of the design. If you would rather it were always on, the same server runs on
the cheapest VPS there is; it is one Node process and one SQLite file.

### The web app

`npm run build` produces a plain static folder (`packages/web/dist`). Any free
static host will serve it — drag the folder onto Netlify, or point Cloudflare
Pages at the repo with build command `npm run build` and output
`packages/web/dist`.

It must be served over **HTTPS**, which those hosts do automatically. Without
it there is no service worker, so no offline, no installing to a home screen,
and no Web Bluetooth for the printer.

### How the three stay in step

They do not sync to each other. Each one syncs to the same server, and that is
what keeps them together:

```
Android APK  ─┐
Web browser  ─┼─→  the sync server  ←→  SQLite file
iPhone PWA   ─┘
```

Setting one up is the same on all three: open the app, choose **Join an
existing one**, enter the server address and the enrolment code. The device
enrols, pulls the whole shop down, and from then on pushes what it sells and
pulls what the others sold.

| | Where the app comes from | Needs the web app hosted? | Needs the server address |
|---|---|---|---|
| **Web** | The host you deployed to | Yes | Yes |
| **Android** | The APK, bundled inside | No | Yes |
| **iOS** | Safari → Share → Add to Home Screen | Yes | Yes |

So the Android app needs no hosting for itself at all — only somewhere to sync
to. iOS needs the web app hosted because Apple has no other way to install a
PWA. And every one of them keeps taking money with the server unreachable.

## Menu and stock

Products, recipes and ingredients are three views of the same question - what
do we sell, what goes into it, and have we got any - so they share one screen
behind tabs rather than taking three navigation slots between them.

Drinks and food use the same form: a cookie is a product with one size, which
is why a snack gets a recipe, a cost and a margin exactly like a latte does.
Price and recipe both hang off the size, because a 16oz latte is a different
drink to a 12oz one in both respects.

## Importing a spreadsheet

The Import tab builds an `.xlsx` template with the exact headings it reads, so
an existing sheet can be pasted in without rearranging it first:

- **Ingredients** — Ingredient Name · Purchase Unit · Total Cost (₱) · Total
  Quantity · Total Quantity Unit · Cost per Unit (AUTO)
- **Recipes** — Drink Name · Size · Ingredient Name · Quantity Used · Quantity
  Unit. A name written as "Caramel Macchiato (16oz)" is understood, so a sheet
  that keeps the size in brackets needs no splitting.

Cost per unit is recomputed from the total cost and quantity rather than read
from the sheet, because that column is usually a formula and a pasted copy of
it is often stale. Units are matched loosely - "grams", "Liters", "pieces" all
land correctly.

Nothing is written until the counts are shown: rows found, rows ready, and
every problem row with the reason. Bad rows are refused; the good ones still
import. Re-importing replaces a recipe rather than doubling it.

ExcelJS is loaded only when the Import tab is opened, so it stays out of the
bundle the till starts with.

## Current state

Built and working: the local-first data layer, the sync engine, the central
server with realtime, PIN auth with RBAC, configurable branding, the full POS
checkout, X and Z readings with cash reconciliation, the sales planner, the
audit trail, backup and restore, receipt and thermal printing, and the menu,
stock, recipe, import, reporting, transaction, staff and settings screens
described above.

Built and working, continued: the audit trail viewer and backup/restore.

Everything in the brief is now built.
