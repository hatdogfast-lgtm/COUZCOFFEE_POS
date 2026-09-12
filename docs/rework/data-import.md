# Track 2 — One template for ingredients and recipes

The owner keeps two spreadsheets and wants one: a single workbook carrying
ingredients and recipes, imported in one action, with the drinks becoming
products automatically.

> *"can we make this one as one for the importing of the ingredients and also for
> recipe and i want auto read the template including the products"*
> — and later, narrowing: *"just make the one template for both ingredients and recipes"*

Findings below were produced by a 79-agent mapping run over `importing.ts`,
`ImportPanel.tsx`, `importing.test.ts`, `packages/shared/src/units.ts` and the
product/recipe write path, with every claim adversarially re-checked against
source by three independent verifiers. Vote counts are noted where a claim was
contested. Full transcript: `subagents/workflows/wf_c46a08a8-913/journal.jsonl`.

---

## The ask splits into three, and they are not equally hard

| # | Ask | Status |
|---|---|---|
| 1 | One workbook holding both sheets | **Small.** Template generator only |
| 2 | Import it in one action | **Medium.** Parser + UI |
| 3 | Auto-create the drinks as products | **Large, and blocked on decisions** |

Ask 3 is the one that looked easy and is not. It is treated separately below.

---

## What the owner's sheets look like

Read from screenshots — the files are open in WPS from a path not exposed on
disk, so they were not parsed directly.

**File A — `ingredients-template (1).xlsx`**, sheet `Ingredients`:

```
Ingredient Name | Purchase Unit | Total Cost (₱) | Total Quantity | Total Quantity Unit | Cost per Unit (AUTO)
```

Row 30 is `ICE` and row 32 is `CUPS/STRAW`, both with every other cell blank —
section headings the owner typed, not broken data. `Purchase Unit` is free text
(`pack`, `bottle`, `1L`, `750ml`), **not** a unit of measure.

**File B — `recipes-template (1).xlsx`**, sheets `Recipes` and `Ingredients`:

```
Drink Name | Ingredient Name | Quantity Used | Quantity Unit | Cost per Unit (AUTO) | Total Ingredient Cost | Unit Check
```

Rows 2–10 Caramel Macchiato, 11–18 Spanish Latte, 19–26 iced Latte, 27–35 Dirty
Matcha. Every drink carries its size in brackets. Casing drifts — row 19 is
`iced Latte (16oz)` with a lowercase *i*.

---

## What already works — verified against source

Considerably more than expected. Do not rebuild any of this.

| Owner's ask | Evidence |
|---|---|
| Purchase-based ingredient columns | `INGREDIENT_COLUMNS` (`importing.ts:38`) is byte-for-byte File A's header |
| `₱` vs plain `P` in the heading | `headerMap` strips the trailing parenthetical before comparing (`importing.ts:274`) — the mismatch is tolerated |
| `₱1,400.00` parses | `num()` strips all but digits, dot, minus (`importing.ts:96`) → `1400` |
| Cost-per-unit maths | `costRateFromPurchase` (`units.ts:107`) called at `importing.ts:400` reproduces **every** File A row: 500/170g → ₱2.94117, 85/1000ml → ₱0.0850, 1400/2000ml → ₱0.7000, 300/100pcs → ₱3.0000 |
| The sheet's own AUTO column | Deliberately **not** trusted — recomputed from the ingredient (`importing.ts:398`). Protects against a stale pasted formula |
| `Purchase Unit` as free text | Never passed to `normaliseUnit`; stored verbatim into `Ingredient.sku` (`importing.ts:394`) |
| Size in brackets → name + size | `splitDrinkName` (`importing.ts:478`), pinned by a test (`importing.test.ts:80`) |
| No `Size` column needed | A test feeds File B's real 4-column header and asserts `rows[0].size === '16oz'` (`importing.test.ts:223`) |
| Many rows → one recipe per size | `applyRecipes` buckets by variant across the file (`importing.ts:596`), pinned at `importing.test.ts:202` |
| Inconsistent casing (`iced Latte`) | All lookups trim-and-lowercase both sides (`importing.ts:528, :536, :547`) |
| File B's spreadsheet-only columns | `Cost per Unit (AUTO)`, `Total Ingredient Cost`, `Unit Check` are absent from `RECIPE_COLUMNS` and read as nothing (`importing.ts:514`). `Unit Check` is in fact redundant — the app runs the same check itself by dimension (`importing.ts:559`) |
| Packaging classification | `guessStockClass` catches cup/lid/straw/sticker/plastic (`importing.ts:458`) — File A's PET CUP, STICKER, STRAWLESS LID, PLASTIC, boba straw all land as `PACKAGING` |
| Re-import doesn't duplicate | Ingredients upsert by name (`importing.ts:418`); `saveRecipe` tombstones components no longer present (`recipes.ts:237`) |
| Preview before writing | Nothing is written until a separate confirm (`ImportPanel.tsx:87`) |

**Two claimed problems were refuted** and are not real: casing is not forked on
create (the importer never creates products at all), and a soft-deleted
ingredient is not resurrected as a duplicate (`write.ts:146` keeps the tombstone,
every reader filters it).

---

## What was missing (before 2026-09-12)

### Blocking

- **G1 — no product is ever created from a Drink Name.** `applyRecipes`'
  entire body is group / look up variant / `if (!variant) continue` / `saveRecipe`.
  No `stamp<Product>`, no `created('products')`, no `db.categories` reference.
  Rows for an unknown drink never reach it — `parseRecipes` rejects them with
  `There is no product called "X".` On a fresh shop all 34 File B rows become
  problems, *Ready to import* reads 0, and the button is disabled.
  `importing.ts:595-618`, `:528-532`, `ImportPanel.tsx:261`. *(3/3)*
- **G2 — no size-variant is ever created.** The parsed size is used only to
  *look up* an existing variant; a miss drops the row. The panel actively
  advertises the bracket feature to the owner (`ImportPanel.tsx:169`), which
  will read as a broken promise against File B. `importing.ts:525, :534`. *(3/3)*
- **G3 — an auto-created variant has no price.** `ProductVariant.price` is
  required (`types.ts:313`); File B has no selling-price column. Price `0` is
  legal, so drinks would ring up **free** until someone noticed. *(3/3)*
- **G4 — an auto-created product has no category, and `createCategory` throws
  on a repeat** rather than returning the existing row (`products.ts:55`), so a
  get-or-create is not available. A shop that declined the starter menu has zero
  categories (`seed.ts:517`). *(2/3)*
- **G5 — there is no single-file, two-sheet path.** `readSheet` returns exactly
  one worksheet (`importing.ts:293-319`); each parser reopens the file
  independently; the UI has two mutually exclusive modes and switching resets
  any parse (`ImportPanel.tsx:30, :72`). *(3/3)*
- **G6 — File A's `ICE` and `CUPS/STRAW` are reported as errors.**
  `parseIngredients` skips a row only when the *name* is blank; a name-only row
  passes that guard and dies on `normaliseUnit('')` → `"blank" is not a unit we
  recognise.` The recipe parser has exactly the tolerance needed
  (`importing.ts:521`) — it was never applied to the ingredient side. *(3/3)*
- **G7 — a test locks in the refusal.** `refuses a drink or ingredient it has
  never heard of` asserts `rows.length === 0` plus `/no product called/i` and
  `/no size called/i` (`importing.test.ts:234-248`). Auto-creation makes those
  rows import. This test must be **rewritten, not extended.** *(3/3)*

### Major

- **G8** — a combined workbook's ingredient sheet may not be found: sheet
  selection needs ≥3 heading matches or it falls back to `worksheets[0]` and
  throws. The app's own 3-column lookup sheet is a live example. `importing.ts:310`
- **G9** — reported row numbers don't match Excel's. `eachRow({includeEmpty:false})`
  drops empty rows but problems report `index + 1` over the dense array.
  Verified: `CUPS/STRAW` on real row 32 reports as **Row 31**. `importing.ts:302, :352`
- **G10** — a combined import is not one transaction. `applyIngredients` commits
  once; `applyRecipes` commits per variant (`recipes.ts:258`). A failure part-way
  leaves products created and recipes missing, with no rollback.
- **G11** — ingredient matching is trim+lowercase only. No double-space
  collapsing, no punctuation folding. `DA VINCI SYRUP CARAMEL SAUCE 2L` on the
  recipe sheet must match File A character-for-character.
- **G13** — the on-screen column guide doesn't match the file the Download button
  produces: the panel prints `RECIPE_COLUMNS`, the generator writes
  `RECIPE_TEMPLATE_COLUMNS`. `ImportPanel.tsx:155` vs `importing.ts:200`

### Minor

`G14` explicit Size column silently beats the brackets · `G15` blank Drink Name on
a continuation row isn't carried down · `G16` a drink listing the same ingredient
twice is refused rather than summed · `G17` re-import wipes recipe notes and
resets `optional` flags · `G18` a partial sheet deletes recipe parts it doesn't
mention, with no confirmation or undo · `G20` rich-text and errored cells arrive
as the literal `[object Object]` · `G21` column order is **not** free despite the
comment saying so — `Total Quantity` is a prefix of `Total Quantity Unit`, so
placing the unit column left of the quantity column binds both keys to the wrong
column · `G22` *Rows found* excludes skipped rows · `G23` preview is capped at 40
rows and is flat, not grouped by drink · `G24` a SUPERVISOR can rewrite recipes
via `inventory.adjust`, and would be able to create priced menu items.

---

## Decided by the owner — 2026-09-12

| # | Question | Decision |
|---|---|---|
| 1 | Price | A `Selling Price (₱)` column on the Recipes sheet. Applies to a **new** size only; an existing size keeps its price. A new size with no price is refused, once, and none of its lines import. |
| 2 | Category | A `Category` column, blank meaning **Drinks**. Applies to a new product only. Matched to an existing, active category ignoring case; created if missing. |
| 3 | Typos | Every drink that would be created is listed in the check step with its price, category and every recipe line before Confirm. |
| 4 | The freeze | **Lifted for `importing.ts` and `importing.test.ts` only.** `recipes.ts`, `products.ts`, `write.ts` untouched. |

## Defaulted by the build — assumed until the owner says otherwise

| # | Question | Default |
|---|---|---|
| 5 | Whole menu or patch | Unchanged: a size named in the file has its whole recipe replaced; sizes not named are left alone. |
| 6 | Missing ingredient | Unchanged: refused. But an ingredient on the same file's Ingredients sheet counts, so both can arrive together. |
| 7 | Spelling | First seen wins, stored verbatim. |
| 8 | `Size` column | Still honoured when present; the template does not include it. |
| 9 | Replace or add | The one template **replaces** the two old downloads. Old single-sheet files still import — the parser reads whichever sheets it finds. |
| 10 | Permission | `recipe.import` only (managers and owners), for both the tab and the panel. |
| — | Smaller defaults | A bracketless new drink is sized `Regular`. An explicit `0` price is accepted; a blank one is refused. A new category gets the app's own defaults (`#8C6F4A`, `Tag`, counted as cups). A new product is `taxable: true`. The sheet's dimension wins over the shop's when both have the ingredient. An unchanged template re-upload counts every ingredient as *updated*, and a rate that is not a whole centavo per kilo/litre comes back a fraction of a centavo different. |

## Gaps closed

G1–G7 (blocking), G8, G9, G11 (case and whitespace — punctuation is still compared literally), G13 (major), G15, G17 (notes only), G20 (formula and rich-text cells), G21, G23, G24 (minor).

## Gaps left open, on purpose

- **G10** — still not one transaction: ingredients commit, then the menu commits, then one `saveRecipe` per size. An interruption leaves menu items without recipes; importing the same file again completes them and creates nothing twice. One transaction is possible without touching `recipes.ts`, but only by copying `saveRecipe`'s diff-and-tombstone logic into `importing.ts`; that duplication was judged worse than the gap.
- **G11** punctuation is not folded — `Syrup-Caramel` and `Syrup Caramel` are two ingredients · **G14** an explicit `Size` column still beats the brackets · **G16** the same ingredient twice on one drink is still refused rather than summed · **G17** `optional` flags still reset (notes are now kept) · **G18** a partial sheet still deletes recipe parts it does not mention · **G22** *Rows found* is gone; the counts are now Ingredients / Drinks / Recipe lines / Problems.

## Where it lives

`packages/web/src/db/importing.ts` — `parseMenu`, `applyMenu`, `menuTemplate`. `packages/web/src/screens/menu/ImportPanel.tsx` — the one flow. Branch `rework/menu-import`, five commits. Plan: `docs/superpowers/plans/2026-09-12-menu-import.md`.

One thing the plan review did not predict and the build found: ExcelJS hands back *sparse* row arrays, and the template's formula-only rows have holes in columns A–E. `Array.prototype.map` skips holes and `findIndex` visits them, so the heading matcher threw on its own template. The reading layer now builds headings with `Array.from`, and the round-trip test pins it.
