# Menu Import (one workbook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One downloadable workbook with an `Ingredients` sheet and a `Recipes` sheet, imported in one action, where a drink named on the Recipes sheet that does not exist yet becomes a product with a priced size — previewed before anything is written.

**Architecture:** `packages/web/src/db/importing.ts` is rewritten around a single public pair, `parseMenu(file) → MenuParse` and `applyMenu(parse, userId) → MenuOutcome`, plus `menuTemplate()`. The workbook is loaded once; each sheet is located by best heading match; the Recipes parser resolves ingredients against the database **and** the file's own Ingredients sheet; drinks are collected into `DrinkPlan`s that say whether a product/size will be created. `applyMenu` writes ingredients (one commit), then categories + products + sizes + audit rows (one commit), then one `saveRecipe` per size. `ImportPanel.tsx` becomes a single flow: download → upload → check (with a "will be added" list) → import.

**Tech Stack:** TypeScript, ExcelJS (loaded on demand), Dexie via `write.ts` (`stamp`/`created`/`commit`), Vitest with fake-indexeddb, React 18 + existing `primitives.tsx`.

**Spec:** `docs/rework/data-import.md` (gaps G1–G24, decisions) and the four decisions taken 2026-09-12: freeze lifted for `importing.ts` only; price from a `Selling Price (₱)` column; category from a `Category` column defaulting to `Drinks`; new drinks shown in the preview as "will be added".

## Global Constraints

- **Only `packages/web/src/db/importing.ts` and `importing.test.ts` may change among `.ts` files.** `recipes.ts`, `products.ts`, `write.ts`, `packages/shared` are not touched. (`saveRecipe`, `loadRecipeFor` and the `write.ts` helpers are consumed as-is.)
- `ImportPanel.tsx` (a `.tsx`) may be rewritten. `packages/web/src/screens/MenuScreen.tsx` changes in exactly one line (Task 5): the Import tab's gate at line 37 drops `|| can('inventory.adjust')`, so a supervisor is not shown a tab whose only content is a refusal.
- **Owner decisions (2026-09-12, this conversation):** 1 price column · 2 category column, blank = Drinks · 3 preview lists what will be created · 4 freeze lifted for `importing.ts` only. **Defaulted by this plan, for the owner to veto (spec decisions 5–10 and a few smaller ones):** whole recipe per size replaced, unnamed sizes untouched · missing ingredient still refused unless it is on the same file · first spelling wins · `Size` column still honoured · the one template replaces both downloads · `recipe.import` only · a bracketless new drink is sized `Regular` (the app's own default size name) · an explicit `0` price is accepted, a blank one is refused · a new category gets the app's own defaults (`#8C6F4A`, `Tag`, counted as cups) · a new product is `taxable: true`, like `emptyDraft` · the sheet's dimension wins over the shop's when both have the ingredient, because that is what gets written.
- `npm test` (run from `packages/web`) must be green at the end of every task. Every other test file stays byte-identical.
- `npm run typecheck` must pass at the end of every task.
- Currency symbol in headings is `₱`; `headerMap` already tolerates `(P)`/`(PHP)`.
- Import permission: `recipe.import` only (managers and owners). `inventory.adjust` no longer grants it, because the import now creates priced menu items (spec G24, decision 10 defaulted).
- Name matching everywhere: trim, lowercase, collapse runs of whitespace (spec G11).
- Problems report **Excel's** row number and the sheet name (spec G9).
- A sheet price applies to a **new** size only; an existing size keeps its price. A sheet category applies to a **new** product only. (Decisions 7/8/9 defaulted: first spelling seen wins; a `Size` column is still honoured when present; the combined template **replaces** the two old downloads.)
- Commit after each task with the message given. Do not commit `docs/` — the owner decides when the docs go in.
- All commands below run from `packages/web` unless a path says otherwise.

---

### Task 0: Clear the probe files and confirm the baseline

**Files:**
- Delete: `packages/web/src/db/zzg17probe.test.ts`, `packages/web/src/db/zzg19lens.test.ts`, `packages/web/src/db/zzg21probe.test.ts`

These are leftovers from the 79-agent mapping run. They are untracked, so deleting them is not a git change.

- [ ] **Step 1: Delete the three files**

```bash
rm src/db/zzg17probe.test.ts src/db/zzg19lens.test.ts src/db/zzg21probe.test.ts
```

- [ ] **Step 2: Run the suite and record the baseline**

Run: `npx vitest run`
Expected: `Test Files 19 passed (19)`. Note the test count — it must not go down for any file other than `importing.test.ts` during this plan.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no output.

No commit — nothing tracked changed.

---

### Task 1: Read the whole workbook once, locate sheets by best match, keep Excel row numbers

**Files:**
- Modify: `packages/web/src/db/importing.ts` — replace `headerMap` (lines 268–282) and `readSheet` (lines 293–319); add `key()`, `readWorkbook`, `locate`; add `sheet` to `RowProblem`; make the two existing parsers use them.
- Modify: `packages/web/src/db/importing.test.ts` — add a multi-sheet file builder and three tests.

**Interfaces:**
- Produces (module-private, used by Tasks 2–4):
  ```ts
  interface SheetRow { number: number; cells: unknown[] }
  interface Sheet { name: string; rows: SheetRow[] }
  interface Located { sheet: Sheet; headerIndex: number; columns: Map<string, number> }
  function key(name: string): string
  async function readWorkbook(file: File): Promise<Sheet[]>
  function locate(sheets: Sheet[], wanted: readonly string[]): Located | null
  ```
- Produces (public): `RowProblem` gains `sheet: string`.
- `parseIngredients(file)` / `parseRecipes(file)` keep their signatures in this task (they are removed in Task 5).

- [ ] **Step 1: Add the file builder and three failing tests**

In `importing.test.ts`, replace the `sheetFile` helper (lines 33–41) with a builder that can write several sheets, and keep `sheetFile` as a wrapper so the existing tests still compile:

```ts
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** A workbook with one sheet per entry, in the order given. */
async function workbookFile(sheets: Record<string, unknown[][]>): Promise<File> {
  const book = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(name)
    for (const row of rows) sheet.addRow(row)
  }
  const buffer = await book.xlsx.writeBuffer()
  return new File([buffer], 'menu.xlsx', { type: XLSX })
}

async function sheetFile(name: string, rows: unknown[][]): Promise<File> {
  return workbookFile({ [name]: rows })
}
```

Add a new `describe` block at the end of the file:

```ts
describe('reading the workbook', () => {
  test('problems carry the sheet name and the row number Excel shows', async () => {
    // Row 3 is genuinely empty, so the bad row is row 4 in Excel.
    const file = await sheetFile('Ingredients', [
      INGREDIENT_HEADER,
      ['Good One', '1L', 85, 1000, 'ml', ''],
      [],
      ['Bad Unit', '1 tub', 50, 10, 'scoops', ''],
    ])
    const result = await parseIngredients(file)
    expect(result.problems).toEqual([
      { sheet: 'Ingredients', row: 4, message: expect.stringMatching(/not a unit/i) },
    ])
  })

  test('the unit column may come before the quantity column', async () => {
    const file = await sheetFile('Ingredients', [
      ['Ingredient Name', 'Purchase Unit', 'Total Cost (₱)', 'Total Quantity Unit', 'Total Quantity', 'Cost per Unit (AUTO)'],
      ['Fresh Milk', '1L', 85, 'ml', 1000, ''],
    ])
    const result = await parseIngredients(file)
    expect(result.problems).toEqual([])
    expect(result.rows[0]?.totalQuantity).toBe(1000)
    expect(result.rows[0]?.unit).toBe('ml')
  })

  test('the best-matching sheet is read, not the first that clears the bar', async () => {
    // The Recipes sheet scores exactly 3 against the ingredient headings
    // (Ingredient Name, Total Quantity, Cost per Unit); the Ingredients sheet
    // scores 6. First-past-the-post picks the wrong one.
    const file = await workbookFile({
      Recipes: [['Drink Name', 'Ingredient Name', 'Total Quantity', 'Quantity Unit', 'Cost per Unit (AUTO)']],
      Ingredients: [INGREDIENT_HEADER, ['Fresh Milk', '1L', 85, 1000, 'ml', '']],
    })
    const result = await parseIngredients(file)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.name).toBe('Fresh Milk')
  })

  test('a formula cell reads as its result and rich text as its words', async () => {
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('Ingredients')
    sheet.addRow(INGREDIENT_HEADER)
    sheet.addRow(['', '1L', 85, 1000, 'ml', ''])
    // A name pasted from a formatted sheet arrives as runs, not a string.
    sheet.getCell('A2').value = { richText: [{ text: 'Fresh ' }, { text: 'Milk' }] }
    // A formula written by ExcelJS carries no cached result at all.
    sheet.getCell('F2').value = { formula: 'C2/D2' }
    const file = new File([await book.xlsx.writeBuffer()], 'menu.xlsx', { type: XLSX })

    const result = await parseIngredients(file)
    expect(result.problems).toEqual([])
    expect(result.rows[0]?.name).toBe('Fresh Milk')
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/db/importing.test.ts -t "reading the workbook"`
Expected: all 4 fail — the first because `sheet` is missing and row is `3`; the second because `Total Quantity` binds to the unit column (`greater than zero`); the third because `readSheet` settles on the first sheet with three matching headings — Recipes — and returns no rows (`expected [] to have a length of 1`); the fourth because the current `text()` turns a `{ richText }` cell into the literal `[object Object]` (spec G20).

- [ ] **Step 3: Replace the reading layer in `importing.ts`**

Change the `RowProblem` interface:

```ts
export interface RowProblem {
  /** Which sheet of the workbook, so a person can find the row. */
  sheet: string
  /** Excel's own row number, not a count of the rows that had something in them. */
  row: number
  message: string
}
```

Replace `text()` (lines 85–94) with one that understands every shape ExcelJS hands back — a formula written by ExcelJS carries no `result` key at all, and a pasted name can arrive as rich-text runs:

```ts
function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const cell = value as { result?: unknown; text?: unknown; richText?: Array<{ text: string }>; formula?: unknown }
    // A formula: what it worked out to, if the file was saved by something
    // that calculates. ExcelJS itself does not, so this can be nothing.
    if ('formula' in cell || 'result' in cell) return text(cell.result ?? '')
    if (Array.isArray(cell.richText)) return cell.richText.map((run) => run.text).join('').trim()
    if ('text' in cell) return String(cell.text ?? '').trim()
    return ''
  }
  return String(value).trim()
}
```

Add after `num()`:

```ts
/** How names are compared: case, surrounding space and doubled spaces are ignored. */
function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}
```

Replace `headerMap` with:

```ts
/** Locate each wanted heading, wherever the sheet happens to put it. */
function headerMap(row: unknown[], wanted: readonly string[]): Map<string, number> {
  const found = new Map<string, number>()
  const headings = row.map((cell) => text(cell).toLowerCase().replace(/\s+/g, ' '))
  const target = (want: string): string => want.toLowerCase().replace(/\s+/g, ' ')
  const stripped = (want: string): string => target(want).replace(/\s*\(.*\)$/, '')

  // Exact matches first, so "Total Quantity" is not claimed by a
  // "Total Quantity Unit" column that happens to sit to its left.
  for (const want of wanted) {
    const index = headings.findIndex((heading) => heading === target(want) || heading === stripped(want))
    if (index !== -1) found.set(want, index)
  }
  // Then loosely, so "Total Cost (PHP)" still finds "Total Cost (₱)".
  const taken = new Set(found.values())
  for (const want of wanted) {
    if (found.has(want)) continue
    const index = headings.findIndex((heading, at) => !taken.has(at) && heading.startsWith(stripped(want)))
    if (index === -1) continue
    found.set(want, index)
    taken.add(index)
  }
  return found
}
```

Replace `readSheet` with:

```ts
interface SheetRow {
  /** Excel's own row number, so a problem can be found in the file. */
  number: number
  cells: unknown[]
}

interface Sheet {
  name: string
  rows: SheetRow[]
}

/** Every sheet in the file, loaded once. */
async function readWorkbook(file: File): Promise<Sheet[]> {
  const ExcelJS = await excel()
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await file.arrayBuffer())
  if (book.worksheets.length === 0) throw new Error('That file has no sheets in it.')

  return book.worksheets.map((sheet) => {
    const rows: SheetRow[] = []
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      const values = row.values as unknown[]
      // ExcelJS pads index 0; drop it so columns line up with the header.
      rows.push({ number, cells: values.slice(1) })
    })
    return { name: sheet.name, rows }
  })
}

interface Located {
  sheet: Sheet
  /** Index into `sheet.rows` of the heading row. */
  headerIndex: number
  columns: Map<string, number>
}

/**
 * Find the sheet that holds a given kind of data.
 *
 * The best-matching sheet wins, not the first to clear the bar: a recipes
 * sheet mentions "Ingredient Name" too, and must not be mistaken for the
 * ingredients sheet just because it comes first in the file.
 */
function locate(sheets: Sheet[], wanted: readonly string[]): Located | null {
  let best: Located | null = null
  let bestScore = 2
  for (const sheet of sheets) {
    sheet.rows.forEach((row, index) => {
      const columns = headerMap(row.cells, wanted)
      if (columns.size > bestScore) {
        best = { sheet, headerIndex: index, columns }
        bestScore = columns.size
      }
    })
  }
  return best
}
```

- [ ] **Step 4: Make `parseIngredients` and `parseRecipes` use the new layer**

In `parseIngredients`, replace the first statements (from `const sheet = await readSheet(...)` through `const columns = headerMap(...)`) with:

```ts
  const found = locate(await readWorkbook(file), INGREDIENT_COLUMNS)
  if (!found) {
    throw new Error(
      `Could not find the expected column headings. The first row should contain: ${INGREDIENT_COLUMNS.join(', ')}.`,
    )
  }
  const { sheet, headerIndex, columns } = found
  const problems: RowProblem[] = []
  const rows: IngredientRow[] = []
```

Replace the loop head and the `cell` helper:

```ts
  for (const { number: at, cells: raw } of sheet.rows.slice(headerIndex + 1)) {
    const cell = (want: (typeof INGREDIENT_COLUMNS)[number]): unknown => {
      const column = columns.get(want)
      return column === undefined ? '' : raw[column]
    }
```

Every `problems.push({ row: at, ...})` in that function becomes `problems.push({ sheet: sheet.name, row: at, ... })`. Replace `const key = name.toLowerCase()` with `const k = key(name)` (and its uses), and build `byName` with `key(row.name)`.

Do the same in `parseRecipes`: locate with `RECIPE_COLUMNS`, iterate `sheet.rows.slice(headerIndex + 1)` with `{ number: at, cells: raw }`, add `sheet: sheet.name` to each problem, and use `key()` for the product, variant and ingredient lookups (`key(entry.name) === key(parsed.name)`, `key(entry.name) === key(size)`, `ingredientByName.get(key(ingredientName))`, map built with `key(row.name)`). **The loop body declares its own `const key = \`${variant.id}|${ingredient.id}\`` (lines 573–579); rename that local and its three uses to `lineKey`**, otherwise the block-scoped string shadows the new `key()` function and typecheck fails with TS2448.

Delete the now-unused `readSheet`.

- [ ] **Step 5: Run the whole import test file**

Run: `npx vitest run src/db/importing.test.ts`
Expected: all pass, including the three new ones.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; 19 files pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/importing.ts src/db/importing.test.ts
git commit -m "Read the workbook once, pick sheets by best match, report Excel row numbers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `parseMenu` — both sheets, drinks planned for creation, ingredients resolved across sheets

**Files:**
- Modify: `packages/web/src/db/importing.ts` — new constants `MENU_RECIPE_COLUMNS`, `DEFAULT_CATEGORY`; extend `RECIPE_COLUMNS`; `RECIPE_TEMPLATE_COLUMNS` **stays until Task 4** (the old `recipeTemplate` still uses it and must keep round-tripping at this commit); new types `RecipeRow` (changed), `DrinkPlan`, `MenuParse`; new functions `empty`, `parseIngredientSheet`, `parseRecipeSheet`, `parseMenu`. `parseIngredients`/`parseRecipes` become thin wrappers. `applyRecipes` takes a `MenuParse` for now.
- Modify: `packages/web/src/db/importing.test.ts` — new `describe('importing the whole menu')` parse tests; rewrite the G7 test.
- Modify: `packages/web/src/screens/menu/ImportPanel.tsx` — minimal edits so it typechecks (throwaway; Task 5 rewrites it).

**Interfaces:**
- Consumes: `key`, `readWorkbook`, `locate`, `Located` from Task 1.
- Produces (public):
  ```ts
  export const RECIPE_COLUMNS = ['Drink Name','Size','Category','Selling Price (₱)','Ingredient Name','Quantity Used','Quantity Unit'] as const
  export const MENU_RECIPE_COLUMNS = ['Drink Name','Category','Selling Price (₱)','Ingredient Name','Quantity Used','Quantity Unit','Cost per Unit (AUTO)','Total Ingredient Cost','Unit Check'] as const
  export const DEFAULT_CATEGORY = 'Drinks'
  export interface RecipeRow { drinkKey: string; productName: string; size: string; ingredientName: string; quantity: number; unit: Unit; ingredientId: string | null }
  export interface DrinkPlan { key: string; name: string; size: string; productId: string | null; variantId: string | null; category: string | null; price: Money | null; lines: number }
  export interface MenuParse { ingredients: ParseResult<IngredientRow>; recipes: ParseResult<RecipeRow>; drinks: DrinkPlan[]; newCategories: string[]; sheets: { ingredients: boolean; recipes: boolean } }
  export async function parseMenu(file: File): Promise<MenuParse>
  ```
  `RecipeRow.variantId` is **removed** (it lives on `DrinkPlan` now).
- `recipeTemplate()` and `RECIPE_TEMPLATE_COLUMNS` are left exactly as they are in this task; both go in Task 4.

- [ ] **Step 1: Write the failing tests**

Add `parseMenu`, `DEFAULT_CATEGORY` to the import list at the top of `importing.test.ts`. Add next to `RECIPE_HEADER`:

```ts
/** The combined template's recipes sheet, minus the three computed columns. */
const MENU_HEADER = ['Drink Name', 'Category', 'Selling Price (₱)', 'Ingredient Name', 'Quantity Used', 'Quantity Unit']
```

Move `seedMenu` out of the `importing recipes` describe to file scope (body unchanged) so the new block can use it. Then add at the end of the file:

```ts
describe('importing the whole menu', () => {
  test('a drink it has never heard of is planned as a new product with a priced size', async () => {
    const file = await workbookFile({
      Ingredients: [INGREDIENT_HEADER, ['Fresh Milk', '1L', 85, 1000, 'ml', '']],
      Recipes: [
        MENU_HEADER,
        ['Spanish Latte (16oz)', 'Coffee', 165, 'Fresh Milk', 150, 'ml'],
        ['Spanish Latte (16oz)', '', '', 'Fresh Milk', 150, 'ml'],
      ],
    })
    const parse = await parseMenu(file)

    expect(parse.sheets).toEqual({ ingredients: true, recipes: true })
    expect(parse.ingredients.rows).toHaveLength(1)
    // The second line names the same ingredient twice for the same drink.
    expect(parse.recipes.problems).toHaveLength(1)
    expect(parse.recipes.rows).toHaveLength(1)
    expect(parse.drinks).toEqual([
      {
        key: 'spanish latte|16oz',
        name: 'Spanish Latte',
        size: '16oz',
        productId: null,
        variantId: null,
        category: 'Coffee',
        price: fromDecimal(165),
        lines: 1,
      },
    ])
    expect(parse.newCategories).toEqual(['Coffee'])
  })

  test('an ingredient on the same file counts, even though it is not in the shop yet', async () => {
    const file = await workbookFile({
      Ingredients: [INGREDIENT_HEADER, ['Oat Milk', '1L', 120, 1000, 'ml', '']],
      Recipes: [MENU_HEADER, ['Oat Latte (12oz)', 'Coffee', 150, 'Oat Milk', 200, 'ml']],
    })
    const parse = await parseMenu(file)
    expect(parse.recipes.problems).toEqual([])
    expect(parse.recipes.rows[0]?.ingredientId).toBeNull()
    expect(parse.recipes.rows[0]?.ingredientName).toBe('Oat Milk')
  })

  test('a new drink with no selling price is refused, once, and its lines stay out', async () => {
    await seedMenu()
    const file = await workbookFile({
      Recipes: [
        MENU_HEADER,
        ['Unicorn Frappe (16oz)', 'Drinks', '', 'Jersey Full Cream Milk 1L', 150, 'ml'],
        ['Unicorn Frappe (16oz)', '', '', 'Nescafe Gold', 3, 'g'],
        ['Caramel Macchiato (16oz)', '', '', 'Jersey Full Cream Milk 1L', 150, 'ml'],
      ],
    })
    const parse = await parseMenu(file)
    expect(parse.recipes.rows).toHaveLength(1)
    expect(parse.recipes.rows[0]?.productName).toBe('Caramel Macchiato')
    expect(parse.recipes.problems).toEqual([
      { sheet: 'Recipes', row: 2, message: expect.stringMatching(/needs a Selling Price/i) },
    ])
    expect(parse.drinks.map((drink) => drink.name)).toEqual(['Caramel Macchiato'])
  })

  test('a price is money and must agree with itself', async () => {
    const file = await workbookFile({
      Ingredients: [INGREDIENT_HEADER, ['Fresh Milk', '1L', 85, 1000, 'ml', '']],
      Recipes: [
        MENU_HEADER,
        ['Latte (16oz)', 'Coffee', '₱165.00', 'Fresh Milk', 150, 'ml'],
        ['Latte (16oz)', '', 175, 'Fresh Milk', 150, 'ml'],
        ['Mocha (16oz)', 'Coffee', 'lots', 'Fresh Milk', 150, 'ml'],
      ],
    })
    const parse = await parseMenu(file)
    expect(parse.drinks.find((drink) => drink.name === 'Latte')?.price).toBe(fromDecimal(165))
    expect(parse.recipes.problems.map((problem) => problem.row)).toEqual([3, 4])
    expect(parse.recipes.problems[0]?.message).toMatch(/priced 175 here but 165/)
    expect(parse.recipes.problems[1]?.message).toMatch(/not a price/i)
  })

  test('a new size on an existing drink is planned against that product', async () => {
    await seedMenu()
    const product = (await db.products.toArray())[0]!
    const file = await workbookFile({
      Recipes: [MENU_HEADER, ['caramel  macchiato (12oz)', '', 145, 'Jersey Full Cream Milk 1L', 120, 'ml']],
    })
    const parse = await parseMenu(file)
    expect(parse.recipes.problems).toEqual([])
    expect(parse.drinks).toEqual([
      {
        key: 'caramel macchiato|12oz',
        name: 'Caramel Macchiato',
        size: '12oz',
        productId: product.id,
        variantId: null,
        category: null,
        price: fromDecimal(145),
        lines: 1,
      },
    ])
  })

  test('an existing size keeps its own price and category, whatever the sheet says', async () => {
    await seedMenu()
    const variant = (await db.productVariants.toArray())[0]!
    const file = await workbookFile({
      Recipes: [MENU_HEADER, ['Caramel Macchiato (16oz)', 'Specials', 999, 'Jersey Full Cream Milk 1L', 150, 'ml']],
    })
    const parse = await parseMenu(file)
    expect(parse.drinks[0]).toMatchObject({ variantId: variant.id, price: null, category: null })
    expect(parse.newCategories).toEqual([])
  })

  test('a blank category means Drinks, and an existing category is matched loosely', async () => {
    await seedMenu()
    const file = await workbookFile({
      Recipes: [
        MENU_HEADER,
        ['Choco Milk (16oz)', '', 120, 'Jersey Full Cream Milk 1L', 200, 'ml'],
        ['Flat White (12oz)', ' hot ', 140, 'Jersey Full Cream Milk 1L', 100, 'ml'],
      ],
    })
    const parse = await parseMenu(file)
    expect(parse.drinks.map((drink) => drink.category)).toEqual([DEFAULT_CATEGORY, 'hot'])
    // "Hot" already exists; only Drinks is new.
    expect(parse.newCategories).toEqual([DEFAULT_CATEGORY])
  })

  test('a line with no drink name belongs to the drink above it', async () => {
    const file = await workbookFile({
      Ingredients: [INGREDIENT_HEADER, ['Fresh Milk', '1L', 85, 1000, 'ml', ''], ['Sugar', '1kg', 60, 1000, 'g', '']],
      Recipes: [
        MENU_HEADER,
        ['Latte (16oz)', 'Coffee', 165, 'Fresh Milk', 150, 'ml'],
        ['', '', '', 'Sugar', 10, 'g'],
      ],
    })
    const parse = await parseMenu(file)
    expect(parse.recipes.problems).toEqual([])
    expect(parse.recipes.rows.map((row) => row.drinkKey)).toEqual(['latte|16oz', 'latte|16oz'])
    expect(parse.drinks[0]?.lines).toBe(2)
  })

  test('section headings on the ingredients sheet are not errors', async () => {
    const file = await workbookFile({
      Ingredients: [
        INGREDIENT_HEADER,
        ['Fresh Milk', '1L', 85, 1000, 'ml', ''],
        ['ICE', '', '', '', '', ''],
        ['CUPS/STRAW'],
        ['Pet Cup 16oz', '50 pcs', 150, 50, 'pcs', ''],
      ],
    })
    const parse = await parseMenu(file)
    expect(parse.ingredients.problems).toEqual([])
    expect(parse.ingredients.rows.map((row) => row.name)).toEqual(['Fresh Milk', 'Pet Cup 16oz'])
  })

  test('a file with only one of the sheets imports that sheet', async () => {
    await seedMenu()
    const old = await sheetFile('Recipes', [
      RECIPE_HEADER,
      ['Caramel Macchiato', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
    ])
    const parse = await parseMenu(old)
    expect(parse.sheets).toEqual({ ingredients: false, recipes: true })
    expect(parse.ingredients.rows).toEqual([])
    expect(parse.recipes.rows).toHaveLength(1)
  })

  test('a file with neither sheet is refused with an explanation', async () => {
    const file = await sheetFile('Sheet1', [['Thing', 'Whatever'], ['x', 'y']])
    await expect(parseMenu(file)).rejects.toThrow(/column headings/i)
  })

  test('names are matched with doubled spaces collapsed', async () => {
    const file = await workbookFile({
      Ingredients: [INGREDIENT_HEADER, ['DA VINCI SYRUP  CARAMEL', 'bottle', 500, 750, 'ml', '']],
      Recipes: [MENU_HEADER, ['Caramel Latte (16oz)', 'Coffee', 170, 'da vinci syrup caramel ', 20, 'ml']],
    })
    const parse = await parseMenu(file)
    expect(parse.recipes.problems).toEqual([])
  })
})
```

Rewrite the G7 test inside `describe('importing recipes')` — replace `refuses a drink or ingredient it has never heard of` with:

```ts
  test('refuses an ingredient it has never heard of, but not a drink', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      RECIPE_HEADER,
      ['Unicorn Frappe', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
      ['Caramel Macchiato', '16oz', 'Moon Dust', 5, 'g'],
      ['Caramel Macchiato', '99oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
    ])

    const result = await parseRecipes(file)
    // Both unknown drinks are new sizes with no price, so they are refused for that reason.
    expect(result.rows).toHaveLength(0)
    expect(result.problems.filter((p) => /needs a Selling Price/i.test(p.message))).toHaveLength(2)
    expect(result.problems.some((p) => /no ingredient called/i.test(p.message))).toBe(true)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/db/importing.test.ts`
Expected: the new block fails on `parseMenu is not a function`; the rewritten G7 test fails on message text.

- [ ] **Step 3: Add the constants and types**

Replace `RECIPE_COLUMNS` (lines 47–60) with the block below, which also adds `MENU_RECIPE_COLUMNS` and `DEFAULT_CATEGORY` after it. Leave `RECIPE_TEMPLATE_COLUMNS` (lines 62–71) where it is:

```ts
/**
 * The columns the importer reads from a recipes sheet.
 *
 * Matched by heading rather than by position, so extra columns in a shop's own
 * sheet are simply ignored. 'Size' is optional: a drink written as
 * "Caramel Macchiato (16oz)" carries its size in brackets. 'Category' and
 * 'Selling Price' matter only for a drink that does not exist yet - they say
 * where it goes on the menu and what it rings up at.
 */
export const RECIPE_COLUMNS = [
  'Drink Name',
  'Size',
  'Category',
  'Selling Price (₱)',
  'Ingredient Name',
  'Quantity Used',
  'Quantity Unit',
] as const

/** The recipes sheet as the downloadable template lays it out. */
export const MENU_RECIPE_COLUMNS = [
  'Drink Name',
  'Category',
  'Selling Price (₱)',
  'Ingredient Name',
  'Quantity Used',
  'Quantity Unit',
  'Cost per Unit (AUTO)',
  'Total Ingredient Cost',
  'Unit Check',
] as const

/** Where a new drink goes when its row does not say. */
export const DEFAULT_CATEGORY = 'Drinks'
```

Replace the `RecipeRow` interface with:

```ts
export interface RecipeRow {
  /** Joins the line to its drink in `MenuParse.drinks`. */
  drinkKey: string
  productName: string
  size: string
  ingredientName: string
  quantity: number
  unit: Unit
  /** Null when the ingredient is on this file's Ingredients sheet and does not exist yet. */
  ingredientId: string | null
}

/**
 * One drink at one size, and whether it exists yet.
 *
 * A null id means the import will create it. A new product needs a category
 * and a new size needs a price; both come from the sheet, and a drink with no
 * price is refused rather than put on the menu for free.
 */
export interface DrinkPlan {
  key: string
  name: string
  size: string
  productId: string | null
  variantId: string | null
  /** The category a new product goes in. Null for an existing product. */
  category: string | null
  /** What a new size rings up at, in minor units. Null for an existing size. */
  price: Money | null
  /** Recipe lines that will be saved for it. */
  lines: number
}

export interface MenuParse {
  ingredients: ParseResult<IngredientRow>
  recipes: ParseResult<RecipeRow>
  drinks: DrinkPlan[]
  /** Categories named on the sheet that do not exist yet, spelled as first seen. */
  newCategories: string[]
  /** Which sheets the file turned out to have. */
  sheets: { ingredients: boolean; recipes: boolean }
}
```

Add `toDecimal`, `type Dimension`, `type Money`, `type Product`, `type ProductVariant` to the `@pos/shared` import.

- [ ] **Step 4: Split the ingredient parser into a sheet-level function**

Replace `parseIngredients` with:

```ts
function empty<T>(): ParseResult<T> {
  return { rows: [], problems: [], duplicates: 0, totalRows: 0 }
}

function parseIngredientSheet(found: Located, existing: Ingredient[]): ParseResult<IngredientRow> {
  const { sheet, headerIndex, columns } = found
  const problems: RowProblem[] = []
  const rows: IngredientRow[] = []
  const byName = new Map(existing.map((row) => [key(row.name), row]))
  const seen = new Set<string>()
  let duplicates = 0

  for (const { number: at, cells: raw } of sheet.rows.slice(headerIndex + 1)) {
    const cell = (want: (typeof INGREDIENT_COLUMNS)[number]): unknown => {
      const column = columns.get(want)
      return column === undefined ? '' : raw[column]
    }
    const problem = (message: string): void => {
      problems.push({ sheet: sheet.name, row: at, message })
    }

    const name = text(cell('Ingredient Name'))
    if (name.length === 0) continue // A blank line is a spacer, not an error.

    const unitRaw = text(cell('Total Quantity Unit'))
    const quantityRaw = text(cell('Total Quantity'))
    const costRaw = text(cell('Total Cost (₱)'))
    // A name with nothing beside it is a heading the owner typed - "ICE",
    // "CUPS/STRAW" - to group the rows below, not an ingredient with no unit.
    if (unitRaw === '' && quantityRaw === '' && costRaw === '' && text(cell('Purchase Unit')) === '') continue

    const k = key(name)
    if (seen.has(k)) {
      duplicates++
      problem(`"${name}" appears more than once in this file.`)
      continue
    }
    seen.add(k)

    const unit = normaliseUnit(unitRaw)
    if (!unit) {
      problem(`"${unitRaw || 'blank'}" is not a unit we recognise. Use g, kg, ml, L or pcs.`)
      continue
    }

    const totalQuantity = num(quantityRaw)
    if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) {
      problem('Total quantity must be a number greater than zero.')
      continue
    }

    const totalCost = num(costRaw)
    if (!Number.isFinite(totalCost) || totalCost < 0) {
      problem('Total cost must be a number.')
      continue
    }

    rows.push({
      name,
      purchaseUnit: text(cell('Purchase Unit')),
      totalCost,
      totalQuantity,
      unit,
      // Worked out here rather than trusted from the sheet: the AUTO column is
      // a formula in Excel, and a pasted copy of it is often stale.
      costRate: costRateFromPurchase(fromDecimal(totalCost), totalQuantity, unit),
      existingId: byName.get(k)?.id ?? null,
    })
  }

  return { rows, problems, duplicates, totalRows: rows.length + problems.length }
}

export async function parseIngredients(file: File): Promise<ParseResult<IngredientRow>> {
  const found = locate(await readWorkbook(file), INGREDIENT_COLUMNS)
  if (!found) {
    throw new Error(
      `Could not find the expected column headings. The first row should contain: ${INGREDIENT_COLUMNS.join(', ')}.`,
    )
  }
  const existing = (await db.ingredients.toArray()).filter((row) => row.deletedAt === null)
  return parseIngredientSheet(found, existing)
}
```

- [ ] **Step 5: Write the recipe sheet parser**

Two recipe-row messages are reworded on purpose: the missing-ingredient message now says *Add it to the Ingredients sheet* because the ingredient may arrive in the same workbook (decision 6), and the unit message gains *Use g, kg, ml, L or pcs.* to match the Ingredients-sheet message.

Replace `parseRecipes` with:

```ts
interface KnownIngredient {
  /** Null for one that is on this file's Ingredients sheet and not yet in the shop. */
  id: string | null
  name: string
  dimension: Dimension
  displayUnit: string
}

interface MenuContext {
  ingredients: Map<string, KnownIngredient>
  products: Product[]
  variants: ProductVariant[]
}

function parseRecipeSheet(
  found: Located,
  context: MenuContext,
): { result: ParseResult<RecipeRow>; drinks: DrinkPlan[] } {
  const { sheet, headerIndex, columns } = found
  const problems: RowProblem[] = []
  const candidates: Array<{ at: number; row: RecipeRow }> = []
  const drinks = new Map<string, DrinkPlan>()
  const firstRow = new Map<string, number>()
  const priceRow = new Map<string, number>()
  const seen = new Set<string>()
  let duplicates = 0
  let lastDrink = ''

  for (const { number: at, cells: raw } of sheet.rows.slice(headerIndex + 1)) {
    const cell = (want: (typeof RECIPE_COLUMNS)[number]): unknown => {
      const column = columns.get(want)
      return column === undefined ? '' : raw[column]
    }
    const problem = (message: string): void => {
      problems.push({ sheet: sheet.name, row: at, message })
    }

    let drink = text(cell('Drink Name'))
    const ingredientName = text(cell('Ingredient Name'))
    if (drink.length === 0 && ingredientName.length === 0) continue
    // A section heading like "COFFEE" with nothing else on the line.
    if (ingredientName.length === 0) continue
    // A line with no drink of its own belongs to the drink above it.
    if (drink.length === 0) drink = lastDrink
    if (drink.length === 0) {
      problem('There is no Drink Name on this row or on any row above it.')
      continue
    }
    lastDrink = drink

    const parsed = splitDrinkName(drink)
    const size = text(cell('Size')) || parsed.size
    const product = context.products.find((entry) => key(entry.name) === key(parsed.name))
    const forProduct = product ? context.variants.filter((entry) => entry.productId === product.id) : []
    const variant = !product
      ? undefined
      : size
        ? forProduct.find((entry) => key(entry.name) === key(size))
        : (forProduct.find((entry) => entry.isDefault) ?? forProduct[0])
    const sizeName = variant?.name ?? (size || 'Regular')
    const drinkKey = `${key(parsed.name)}|${key(sizeName)}`

    let plan = drinks.get(drinkKey)
    if (!plan) {
      plan = {
        key: drinkKey,
        name: product?.name ?? parsed.name,
        size: sizeName,
        productId: product?.id ?? null,
        variantId: variant?.id ?? null,
        category: null,
        price: null,
        lines: 0,
      }
      drinks.set(drinkKey, plan)
      firstRow.set(drinkKey, at)
    }

    // Category and price describe the drink rather than the line, so the
    // first row to name them speaks for every row of that drink.
    const category = text(cell('Category'))
    if (category.length > 0 && plan.category === null) plan.category = category

    const priceRaw = text(cell('Selling Price (₱)'))
    if (priceRaw.length > 0) {
      const price = num(priceRaw)
      if (!Number.isFinite(price) || price < 0) {
        problem(`"${priceRaw}" is not a price.`)
        continue
      }
      const minor = fromDecimal(price)
      if (plan.price === null) {
        plan.price = minor
        priceRow.set(drinkKey, at)
      } else if (plan.price !== minor) {
        problem(
          `${plan.name} (${plan.size}) is priced ${price} here but ${toDecimal(plan.price)} on row ${priceRow.get(drinkKey)}.`,
        )
        continue
      }
    }

    const ingredient = context.ingredients.get(key(ingredientName))
    if (!ingredient) {
      problem(`There is no ingredient called "${ingredientName}". Add it to the Ingredients sheet.`)
      continue
    }

    const unitRaw = text(cell('Quantity Unit'))
    const unit = normaliseUnit(unitRaw)
    if (!unit) {
      problem(`"${unitRaw || 'blank'}" is not a unit we recognise. Use g, kg, ml, L or pcs.`)
      continue
    }
    if (unitDimension(unit) !== ingredient.dimension) {
      problem(`${ingredient.name} is measured in ${ingredient.displayUnit}, so it cannot be used in ${unit}.`)
      continue
    }

    const quantity = num(cell('Quantity Used'))
    if (!Number.isFinite(quantity) || quantity <= 0) {
      problem('Quantity used must be a number greater than zero.')
      continue
    }

    const lineKey = `${drinkKey}|${key(ingredientName)}`
    if (seen.has(lineKey)) {
      duplicates++
      problem(`${ingredient.name} is listed twice for ${drink}.`)
      continue
    }
    seen.add(lineKey)

    candidates.push({
      at,
      row: {
        drinkKey,
        productName: plan.name,
        size: plan.size,
        ingredientName: ingredient.name,
        quantity,
        unit,
        ingredientId: ingredient.id,
      },
    })
  }

  // A size that does not exist yet needs a price, and without one none of its
  // lines go in: a drink on the menu at ₱0 is worse than a drink not on it.
  const unpriced = new Set<string>()
  for (const plan of drinks.values()) {
    if (plan.variantId !== null || plan.price !== null) continue
    // A drink whose every line already failed has been reported; do not add to it.
    if (!candidates.some((entry) => entry.row.drinkKey === plan.key)) continue
    unpriced.add(plan.key)
    problems.push({
      sheet: sheet.name,
      row: firstRow.get(plan.key)!,
      message: `${plan.name} (${plan.size}) is new, so it needs a Selling Price.`,
    })
  }
  const rows = candidates.filter((entry) => !unpriced.has(entry.row.drinkKey)).map((entry) => entry.row)

  const plans: DrinkPlan[] = []
  for (const plan of drinks.values()) {
    plan.lines = rows.filter((row) => row.drinkKey === plan.key).length
    if (plan.lines === 0) continue
    // Only a product being created needs a category, and only a size being
    // created needs a price; what exists already keeps its own.
    plan.category = plan.productId === null ? (plan.category ?? DEFAULT_CATEGORY) : null
    if (plan.variantId !== null) plan.price = null
    plans.push(plan)
  }

  problems.sort((a, b) => a.row - b.row)
  return { result: { rows, problems, duplicates, totalRows: rows.length + problems.length }, drinks: plans }
}
```

- [ ] **Step 6: Write `parseMenu`, the `parseRecipes` wrapper, and the interim `applyRecipes`**

```ts
/**
 * Read a menu workbook: an Ingredients sheet, a Recipes sheet, or both.
 *
 * Recipes are checked against the shop's ingredients *and* the ones on this
 * file's own Ingredients sheet, so a new drink and the things it is made of
 * can arrive together. Nothing is written here.
 */
export async function parseMenu(file: File): Promise<MenuParse> {
  const sheets = await readWorkbook(file)
  const ingredientSheet = locate(sheets, INGREDIENT_COLUMNS)
  const recipeSheet = locate(sheets, RECIPE_COLUMNS)
  if (!ingredientSheet && !recipeSheet) {
    throw new Error(
      `Could not find the expected column headings. An Ingredients sheet starts with: ${INGREDIENT_COLUMNS.join(', ')}. A Recipes sheet starts with: ${MENU_RECIPE_COLUMNS.slice(0, 6).join(', ')}.`,
    )
  }

  const [dbIngredients, products, variants, categories] = await Promise.all([
    db.ingredients.toArray(),
    db.products.toArray(),
    db.productVariants.toArray(),
    db.categories.toArray(),
  ])
  const liveIngredients = dbIngredients.filter((row) => row.deletedAt === null)

  const ingredients = ingredientSheet ? parseIngredientSheet(ingredientSheet, liveIngredients) : empty<IngredientRow>()

  const known = new Map<string, KnownIngredient>(
    liveIngredients.map((row) => [
      key(row.name),
      { id: row.id, name: row.name, dimension: row.dimension, displayUnit: row.displayUnit },
    ]),
  )
  // The file's own ingredients count too, and win over the shop's where both
  // have one - the sheet is what is about to be written.
  for (const row of ingredients.rows) {
    known.set(key(row.name), {
      id: row.existingId,
      name: row.name,
      dimension: unitDimension(row.unit),
      displayUnit: row.unit,
    })
  }

  const recipes = recipeSheet
    ? parseRecipeSheet(recipeSheet, {
        ingredients: known,
        products: products.filter((row) => row.deletedAt === null),
        variants: variants.filter((row) => row.deletedAt === null),
      })
    : { result: empty<RecipeRow>(), drinks: [] as DrinkPlan[] }

  // Active only, to match applyMenu and the app's own createCategory: an
  // archived "Coffee" is not somewhere a new drink can be filed, so a sheet
  // naming it gets a fresh, visible one.
  const categoryKeys = new Set(
    categories.filter((row) => row.deletedAt === null && row.active).map((row) => key(row.name)),
  )
  const newCategories: string[] = []
  for (const drink of recipes.drinks) {
    if (drink.productId !== null || drink.category === null) continue
    if (categoryKeys.has(key(drink.category))) continue
    categoryKeys.add(key(drink.category))
    newCategories.push(drink.category)
  }

  return {
    ingredients,
    recipes: recipes.result,
    drinks: recipes.drinks,
    newCategories,
    sheets: { ingredients: ingredientSheet !== null, recipes: recipeSheet !== null },
  }
}

export async function parseRecipes(file: File): Promise<ParseResult<RecipeRow>> {
  return (await parseMenu(file)).recipes
}
```

`applyRecipes` no longer compiles (`row.variantId` is gone). Change it to take the parse so the existing recipe tests keep passing until Task 3 replaces it:

```ts
export async function applyRecipes(parse: MenuParse, userId: string): Promise<{ recipes: number }> {
  const variantByKey = new Map(parse.drinks.map((drink) => [drink.key, drink.variantId]))
  const byVariant = new Map<string, RecipeComponent[]>()
  for (const row of parse.recipes.rows) {
    const variantId = variantByKey.get(row.drinkKey)
    if (!variantId || !row.ingredientId) continue
    const list = byVariant.get(variantId) ?? []
    list.push({ ingredientId: row.ingredientId, baseQuantity: toBase(row.quantity, row.unit), optional: false })
    byVariant.set(variantId, list)
  }
  const variants = await db.productVariants.toArray()
  for (const [variantId, components] of byVariant) {
    const variant = variants.find((entry) => entry.id === variantId)
    if (!variant) continue
    await saveRecipe({ variant, components, notes: '', userId })
  }
  return { recipes: byVariant.size }
}
```

In `importing.test.ts`, the existing `applyRecipes` calls change: in `matches a drink, its size and its ingredients` replace `await applyRecipes(result.rows, 'USER-1')` with `await applyRecipes(await parseMenu(file), 'USER-1')`; in `importing twice replaces the recipe...` replace both `applyRecipes((await parseRecipes(await sheetFile('R', rows))).rows, 'USER-1')` with `applyRecipes(await parseMenu(await sheetFile('R', rows)), 'USER-1')`.

In `ImportPanel.tsx` (throwaway edits so it typechecks): change `useState<ParseResult<RecipeRow> | null>(null)` to `useState<MenuParse | null>(null)` for `recipes`; line 42 to `const result = kind === 'INGREDIENTS' ? ingredients : (recipes?.recipes ?? null)`; line 76 to `setRecipes(await parseMenu(file))`; line 95 to `await applyRecipes(recipes, user?.id ?? '')`; line 242 to `(kind === 'RECIPES' ? (recipes?.recipes.rows ?? []) : [])`. In the import list add `parseMenu` and `type MenuParse`, drop `parseRecipes` and `type RecipeRow`.

- [ ] **Step 7: Run the import tests, typecheck, full suite**

Run: `npx vitest run src/db/importing.test.ts && npm run typecheck && npx vitest run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/db/importing.ts src/db/importing.test.ts src/screens/menu/ImportPanel.tsx
git commit -m "Parse a menu workbook: both sheets at once, new drinks planned with a price and category

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `applyMenu` — write ingredients, then the menu, then the recipes

**Files:**
- Modify: `packages/web/src/db/importing.ts` — `applyIngredients` returns ids; new `MenuOutcome`, `applyMenu`; delete `applyRecipes`.
- Modify: `packages/web/src/db/importing.test.ts` — apply tests; port the `applyRecipes` callers to `applyMenu`.
- Modify: `packages/web/src/screens/menu/ImportPanel.tsx` — `applyRecipes` → `applyMenu` (import and call), so it still typechecks.

**Interfaces:**
- Consumes: `MenuParse`, `DrinkPlan`, `RecipeRow`, `key`, `DEFAULT_CATEGORY` from Task 2; `saveRecipe`, `loadRecipeFor` from `recipes.ts`; `stamp`, `created`, `commit` from `write.ts`.
- Produces:
  ```ts
  export interface MenuOutcome { ingredients: { created: number; updated: number }; categories: number; products: number; sizes: number; recipes: number }
  export async function applyMenu(parse: MenuParse, userId: string): Promise<MenuOutcome>
  export async function applyIngredients(rows: IngredientRow[]): Promise<{ created: number; updated: number; ids: Map<string, string> }>
  ```

- [ ] **Step 1: Write the failing tests**

Add `applyMenu` to the `./importing.ts` import list and `saveRecipe` to the `./recipes.ts` import. Add to `describe('importing the whole menu')`:

```ts
  test('creates the category, the drink, its priced sizes and their recipes from one file', async () => {
    const file = await workbookFile({
      Ingredients: [
        INGREDIENT_HEADER,
        ['Fresh Milk', '1L', 85, 1000, 'ml', ''],
        ['Espresso Beans', '1kg', 900, 1000, 'g', ''],
      ],
      Recipes: [
        MENU_HEADER,
        ['Spanish Latte (16oz)', 'Coffee', 165, 'Fresh Milk', 150, 'ml'],
        ['Spanish Latte (16oz)', '', '', 'Espresso Beans', 18, 'g'],
        ['Spanish Latte (12oz)', 'Coffee', 145, 'Fresh Milk', 100, 'ml'],
      ],
    })
    const outcome = await applyMenu(await parseMenu(file), 'USER-1')

    expect(outcome).toEqual({
      ingredients: { created: 2, updated: 0 },
      categories: 1,
      products: 1,
      sizes: 2,
      recipes: 2,
    })

    const categories = await db.categories.toArray()
    expect(categories.map((row) => row.name)).toEqual(['Coffee'])

    const products = await db.products.toArray()
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({ name: 'Spanish Latte', categoryId: categories[0]!.id, active: true, available: true })

    const variants = (await db.productVariants.toArray()).sort((a, b) => a.sortOrder - b.sortOrder)
    expect(variants.map((row) => [row.name, row.price, row.isDefault])).toEqual([
      ['16oz', fromDecimal(165), true],
      ['12oz', fromDecimal(145), false],
    ])

    const large = await loadRecipeFor(variants[0]!.id)
    expect(large.components.map((c) => c.baseQuantity).sort((a, b) => a - b)).toEqual([18, 150])
    const small = await loadRecipeFor(variants[1]!.id)
    expect(small.components.map((c) => c.baseQuantity)).toEqual([100])

    const audit = await db.auditLogs.toArray()
    expect(audit.filter((row) => row.action === 'PRODUCT_CREATED')).toHaveLength(1)
  })

  test('a new size joins an existing drink without becoming its default', async () => {
    await seedMenu()
    const product = (await db.products.toArray())[0]!
    const file = await workbookFile({
      Recipes: [MENU_HEADER, ['Caramel Macchiato (12oz)', 'Whatever', 145, 'Jersey Full Cream Milk 1L', 120, 'ml']],
    })
    const outcome = await applyMenu(await parseMenu(file), 'USER-1')
    expect(outcome).toMatchObject({ categories: 0, products: 0, sizes: 1, recipes: 1 })

    const variants = (await db.productVariants.where('productId').equals(product.id).toArray()).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    )
    expect(variants.map((row) => [row.name, row.isDefault])).toEqual([
      ['16oz', true],
      ['12oz', false],
    ])
    expect((await db.categories.toArray()).map((row) => row.name)).toEqual(['Hot'])
  })

  test('an existing size keeps its price, and its recipe is replaced', async () => {
    await seedMenu()
    const before = (await db.productVariants.toArray())[0]!
    const file = await workbookFile({
      Recipes: [MENU_HEADER, ['Caramel Macchiato (16oz)', '', 999, 'Nescafe Gold', 3, 'g']],
    })
    await applyMenu(await parseMenu(file), 'USER-1')

    const after = (await db.productVariants.toArray())[0]!
    expect(after.price).toBe(before.price)
    expect((await loadRecipeFor(after.id)).components.map((c) => c.baseQuantity)).toEqual([3])
  })

  test('importing the same file twice creates nothing the second time', async () => {
    const file = await workbookFile({
      Ingredients: [INGREDIENT_HEADER, ['Fresh Milk', '1L', 85, 1000, 'ml', '']],
      Recipes: [MENU_HEADER, ['Latte (16oz)', 'Coffee', 165, 'Fresh Milk', 150, 'ml']],
    })
    await applyMenu(await parseMenu(file), 'USER-1')
    const again = await applyMenu(await parseMenu(file), 'USER-1')

    expect(again).toEqual({
      ingredients: { created: 0, updated: 1 },
      categories: 0,
      products: 0,
      sizes: 0,
      recipes: 1,
    })
    expect(await db.products.count()).toBe(1)
    expect(await db.productVariants.count()).toBe(1)
    expect(await db.categories.count()).toBe(1)
  })

  test('a category is matched to an existing one regardless of case', async () => {
    await seedMenu()
    const file = await workbookFile({
      Recipes: [MENU_HEADER, ['Flat White (12oz)', 'HOT', 140, 'Jersey Full Cream Milk 1L', 100, 'ml']],
    })
    const outcome = await applyMenu(await parseMenu(file), 'USER-1')
    expect(outcome.categories).toBe(0)
    const hot = (await db.categories.toArray())[0]!
    expect((await db.products.toArray()).find((row) => row.name === 'Flat White')?.categoryId).toBe(hot.id)
  })

  test('recipe notes survive a re-import', async () => {
    await seedMenu()
    const variant = (await db.productVariants.toArray())[0]!
    const ingredient = (await db.ingredients.toArray())[0]!
    await saveRecipe({
      variant,
      components: [{ ingredientId: ingredient.id, baseQuantity: 10, optional: false }],
      notes: 'Stir twice.',
      userId: 'USER-1',
    })
    const file = await workbookFile({
      Recipes: [MENU_HEADER, ['Caramel Macchiato (16oz)', '', '', 'Nescafe Gold', 3, 'g']],
    })
    await applyMenu(await parseMenu(file), 'USER-1')
    expect((await loadRecipeFor(variant.id)).recipe?.notes).toBe('Stir twice.')
  })
```

Port the `applyRecipes(...)` calls in `describe('importing recipes')` to `applyMenu(...)` (same arguments) and drop `applyRecipes` from the import list.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/db/importing.test.ts -t "whole menu"`
Expected: failures on `applyMenu is not a function`.

- [ ] **Step 3: Make `applyIngredients` report the ids it wrote**

Change its signature and body:

```ts
export async function applyIngredients(
  rows: IngredientRow[],
): Promise<{ created: number; updated: number; ids: Map<string, string> }> {
  const writes: PendingWrite[] = []
  const existing = new Map((await db.ingredients.toArray()).map((row) => [row.id, row]))
  /** Every ingredient written, by name key, so recipes can find the new ones. */
  const ids = new Map<string, string>()
  let createdCount = 0
  let updatedCount = 0

  for (const row of rows) {
    const dimension = unitDimension(row.unit)
    const current = row.existingId ? existing.get(row.existingId) : undefined

    if (current) {
      writes.push(
        updated(
          'ingredients',
          revise(current, {
            costRate: row.costRate,
            dimension,
            displayUnit: row.unit,
            sku: current.sku || row.purchaseUnit,
          }),
        ),
      )
      ids.set(key(row.name), current.id)
      updatedCount++
    } else {
      const record = stamp<Ingredient>({
        name: row.name,
        sku: row.purchaseUnit,
        stockClass: guessStockClass(row.name),
        dimension,
        displayUnit: row.unit,
        costRate: row.costRate,
        supplierId: null,
        lowStockThresholdBase: 0,
        trackStock: true,
        active: true,
      })
      writes.push(created('ingredients', record))
      ids.set(key(row.name), record.id)
      createdCount++
    }
  }

  await commit(writes)
  return { created: createdCount, updated: updatedCount, ids }
}
```

- [ ] **Step 4: Write `applyMenu`, delete `applyRecipes`**

Add `type AuditLog`, `type Category` to the `@pos/shared` import and `loadRecipeFor` to the `./recipes.ts` import. Replace `applyRecipes` with:

```ts
export interface MenuOutcome {
  ingredients: { created: number; updated: number }
  categories: number
  products: number
  sizes: number
  recipes: number
}

/**
 * Write everything a parsed menu described.
 *
 * Three commits rather than one, in an order that lets a second run of the
 * same file find what the first one made: ingredients first, because recipes
 * look them up by name; then categories, products and sizes together; then
 * the recipe for each size through saveRecipe, which already knows how to
 * diff and tombstone a recipe's rows. One transaction is possible without
 * touching recipes.ts, but only by copying that diff logic in here; the
 * price of not doing so is that an interrupted run leaves menu items without
 * recipes - and importing the file again completes them, creating nothing
 * twice.
 */
export async function applyMenu(parse: MenuParse, userId: string): Promise<MenuOutcome> {
  const now = Date.now()

  // -------------------------------------------------------------- ingredients --
  const ingredients = await applyIngredients(parse.ingredients.rows)
  const ingredientIds = new Map(ingredients.ids)
  for (const row of (await db.ingredients.toArray()).filter((entry) => entry.deletedAt === null)) {
    if (!ingredientIds.has(key(row.name))) ingredientIds.set(key(row.name), row.id)
  }

  // --------------------------------------------------------------------- menu --
  const writes: PendingWrite[] = []
  const [categories, liveVariants, productCount] = await Promise.all([
    db.categories.toArray().then((rows) => rows.filter((row) => row.deletedAt === null && row.active)),
    db.productVariants.toArray().then((rows) => rows.filter((row) => row.deletedAt === null)),
    db.products.count(),
  ])

  const categoryIds = new Map(categories.map((row) => [key(row.name), row.id]))
  let categoryCount = 0
  for (const name of parse.newCategories) {
    if (categoryIds.has(key(name))) continue
    const category = stamp<Category>(
      {
        name,
        colour: '#8C6F4A',
        icon: 'Tag',
        servingUnit: 'CUP',
        sortOrder: categories.length + categoryCount,
        active: true,
      },
      now,
    )
    writes.push(created('categories', category))
    categoryIds.set(key(name), category.id)
    categoryCount++
  }

  const productIds = new Map<string, string>()
  const variantIds = new Map<string, string>()
  const sizesOf = new Map<string, number>()
  for (const variant of liveVariants) sizesOf.set(variant.productId, (sizesOf.get(variant.productId) ?? 0) + 1)
  let productCreated = 0
  let sizeCreated = 0

  for (const drink of parse.drinks) {
    if (drink.variantId !== null) {
      variantIds.set(drink.key, drink.variantId)
      continue
    }

    let productId = drink.productId ?? productIds.get(key(drink.name))
    if (!productId) {
      const categoryId = categoryIds.get(key(drink.category ?? DEFAULT_CATEGORY))
      if (!categoryId) throw new Error(`There is no category called "${drink.category}".`)
      const product = stamp<Product>(
        {
          categoryId,
          name: drink.name,
          description: '',
          sku: '',
          imageDataUrl: null,
          active: true,
          available: true,
          sortOrder: productCount + productCreated,
          taxable: true,
          modifierGroupIds: [],
        },
        now,
      )
      writes.push(created('products', product))
      writes.push(
        created(
          'auditLogs',
          stamp<AuditLog>(
            {
              entityType: 'products',
              entityId: product.id,
              action: 'PRODUCT_CREATED',
              userId,
              before: null,
              after: JSON.stringify({ name: product.name, source: 'import' }),
              reason: '',
              occurredAt: now,
            },
            now,
          ),
        ),
      )
      productId = product.id
      productIds.set(key(drink.name), productId)
      productCreated++
    }

    // The first size a product gets is its default; any later one is not.
    const existingSizes = sizesOf.get(productId) ?? 0
    const variant = stamp<ProductVariant>(
      {
        productId,
        name: drink.size,
        price: drink.price ?? 0,
        sortOrder: existingSizes,
        active: true,
        isDefault: existingSizes === 0,
      },
      now,
    )
    writes.push(created('productVariants', variant))
    sizesOf.set(productId, existingSizes + 1)
    variantIds.set(drink.key, variant.id)
    sizeCreated++
  }

  await commit(writes, now)

  // ------------------------------------------------------------------ recipes --
  const byVariant = new Map<string, RecipeComponent[]>()
  for (const row of parse.recipes.rows) {
    const variantId = variantIds.get(row.drinkKey)
    const ingredientId = row.ingredientId ?? ingredientIds.get(key(row.ingredientName))
    if (!variantId || !ingredientId) continue
    const list = byVariant.get(variantId) ?? []
    list.push({ ingredientId, baseQuantity: toBase(row.quantity, row.unit), optional: false })
    byVariant.set(variantId, list)
  }

  const variants = await db.productVariants.toArray()
  let recipeCount = 0
  for (const [variantId, components] of byVariant) {
    const variant = variants.find((entry) => entry.id === variantId)
    if (!variant) continue
    // Each sheet is the whole recipe for that size, so it replaces what was
    // there rather than adding to it - importing twice must not double it.
    // The notes are the owner's, not the sheet's, and are left as they were.
    const { recipe } = await loadRecipeFor(variantId)
    await saveRecipe({ variant, components, notes: recipe?.notes ?? '', userId })
    recipeCount++
  }

  return {
    ingredients: { created: ingredients.created, updated: ingredients.updated },
    categories: categoryCount,
    products: productCreated,
    sizes: sizeCreated,
    recipes: recipeCount,
  }
}
```

In `ImportPanel.tsx` change the `applyRecipes` import and call to `applyMenu` (same arguments) and the toast to `${outcome.recipes} recipes saved.`. The panel's ingredient path still calls `applyIngredients`; that compiles because the extra `ids` field is ignored.

- [ ] **Step 5: Run, typecheck, full suite**

Run: `npx vitest run src/db/importing.test.ts && npm run typecheck && npx vitest run`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/db/importing.ts src/db/importing.test.ts src/screens/menu/ImportPanel.tsx
git commit -m "Apply a parsed menu: ingredients, then categories, products and priced sizes, then recipes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `menuTemplate` — one workbook, two sheets, formulas pointing at the importable sheet

**Files:**
- Modify: `packages/web/src/db/importing.ts` — new `menuTemplate()`; delete `ingredientTemplate`, `recipeTemplate`, `templateWorkbook`.
- Modify: `packages/web/src/db/importing.test.ts` — round-trip tests.
- Modify: `packages/web/src/screens/menu/ImportPanel.tsx` — `download()` calls `menuTemplate()` for either kind (throwaway; Task 5 rewrites).

**Interfaces:**
- Produces: `export async function menuTemplate(): Promise<Blob>`

- [ ] **Step 1: Write the failing round-trip tests**

First give `seedMenu` an ingredient that is displayed by the kilo, so the template's unit handling is exercised and not just assumed. Add to `seedMenu` (after `beans`) and include it in the `commit([...])` list:

```ts
    const kilo = stamp<Ingredient>({
      name: 'Espresso Beans', sku: '1kg bag', stockClass: 'INGREDIENT', dimension: 'MASS',
      displayUnit: 'kg', costRate: costRateFromPurchase(fromDecimal(900), 1, 'kg'), supplierId: null,
      lowStockThresholdBase: 0, trackStock: true, active: true,
    })
```

(No existing test counts the seeded ingredients; the one that picks `[0]` works with any of them.)

Add `menuTemplate`, `MENU_RECIPE_COLUMNS` to the test imports. Add to `describe('importing the whole menu')`:

```ts
  test('the downloaded template imports back with nothing to report', async () => {
    await seedMenu()
    const blob = await menuTemplate()
    const file = new File([await blob.arrayBuffer()], 'menu-template.xlsx', { type: XLSX })

    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await blob.arrayBuffer())
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Ingredients', 'Recipes'])
    expect(book.getWorksheet('Recipes')!.getRow(1).values).toEqual([undefined, ...MENU_RECIPE_COLUMNS])
    // The cost columns look up the importable sheet, not a separate lookup,
    // and the sheet's own maths converts kilos and litres before comparing.
    const lookup = book.getWorksheet('Recipes')!.getCell('G2').value as { formula: string }
    expect(lookup.formula).toContain('Ingredients!$A$2:$F$')
    const perBase = book.getWorksheet('Ingredients')!.getCell('F2').value as { formula: string }
    expect(perBase.formula).toContain('"kg"')

    const parse = await parseMenu(file)
    expect(parse.ingredients.problems).toEqual([])
    expect(parse.recipes.problems).toEqual([])
    expect(parse.sheets).toEqual({ ingredients: true, recipes: true })
    // The shop's own ingredients come back as updates, in the unit each one
    // is shown in, at the same rate. (Exact here because every seeded rate
    // is a whole centavo per kilo or litre; a rate that is not would come
    // back a fraction of a centavo different - see the note in menuTemplate.)
    const stored = await db.ingredients.toArray()
    expect(parse.ingredients.rows).toHaveLength(stored.length)
    for (const row of parse.ingredients.rows) {
      const original = stored.find((entry) => entry.name === row.name)!
      expect(row.existingId).toBe(original.id)
      expect(row.unit).toBe(original.displayUnit)
      expect(row.costRate).toBe(original.costRate)
    }
    // The sample recipe is for a drink the shop already has.
    expect(parse.drinks[0]?.variantId).not.toBeNull()
  })

  test('the template on an empty shop uses sample rows that import cleanly', async () => {
    const blob = await menuTemplate()
    const file = new File([await blob.arrayBuffer()], 'menu-template.xlsx', { type: XLSX })
    const parse = await parseMenu(file)
    expect(parse.ingredients.problems).toEqual([])
    expect(parse.recipes.problems).toEqual([])
    expect(parse.drinks[0]).toMatchObject({ productId: null, variantId: null, category: 'Coffee' })
    expect(parse.drinks[0]?.price).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/db/importing.test.ts -t "template"`
Expected: `menuTemplate is not a function`.

- [ ] **Step 3: Write `menuTemplate`, delete the two old generators**

Replace everything from the `// ---- templates --` banner through the end of `recipeTemplate` with:

```ts
// ---------------------------------------------------------------- template --

/** How many rows the lookup formulas are allowed to reach. */
const LOOKUP_ROWS = 500

type Worksheet = import('exceljs').Worksheet

function styleSheet(sheet: Worksheet, headings: readonly string[]): void {
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE4DA' } }
  header.alignment = { vertical: 'middle' }
  headings.forEach((heading, index) => {
    sheet.getColumn(index + 1).width = Math.max(16, heading.length + 4)
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

/**
 * Spreadsheet-side unit handling, mirroring normaliseUnit.
 *
 * The sheet's cost columns are a convenience - nothing on the books comes
 * from them - but a convenience that is wrong by a thousand is worse than
 * none. So the sheet, like the importer, works per gram, millilitre and
 * piece: a purchase in kilos or litres is scaled before the cost per unit
 * is worked out, a recipe line in kilos or litres is scaled before it is
 * priced, and the unit check compares kinds of measurement, not spellings.
 */
const MASS_WORDS = ['g', 'gram', 'grams', 'gr', 'kg', 'kilo', 'kilos', 'kilogram', 'kilograms']
const VOLUME_WORDS = ['ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres', 'l', 'liter', 'litre', 'liters', 'litres']
const THOUSAND_WORDS = ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'l', 'liter', 'litre', 'liters', 'litres']

function isAny(ref: string, words: string[]): string {
  return `OR(${words.map((word) => `LOWER(${ref})="${word}"`).join(',')})`
}

/** 1000 for a kilo or a litre, else 1. */
function perBase(ref: string): string {
  return `IF(${isAny(ref, THOUSAND_WORDS)},1000,1)`
}

/** "MASS", "VOLUME" or "COUNT" for a unit cell, as the importer would read it. */
function dimensionOf(ref: string): string {
  return `IF(${isAny(ref, MASS_WORDS)},"MASS",IF(${isAny(ref, VOLUME_WORDS)},"VOLUME","COUNT"))`
}

/**
 * The menu workbook: an Ingredients sheet and a Recipes sheet.
 *
 * Laid out like the sheets a coffee shop already keeps, so existing rows paste
 * straight in. The recipe's cost columns look up the Ingredients sheet of the
 * same file, so a cost appears the moment a row is typed - on a sheet that
 * is itself imported, rather than a separate lookup that is empty until an
 * import has already happened.
 *
 * Both sheets start from the shop's own data where there is any, so the file
 * imports cleanly as downloaded. The computed columns are read on import but
 * never trusted: the cost that ends up on the books is worked out here.
 */
export async function menuTemplate(): Promise<Blob> {
  const ExcelJS = await excel()
  const book = new ExcelJS.Workbook()

  const [ingredients, products, variants, categories] = await Promise.all([
    db.ingredients.toArray(),
    db.products.toArray(),
    db.productVariants.toArray(),
    db.categories.toArray(),
  ])
  const live = ingredients
    .filter((row) => row.deletedAt === null && row.active)
    .sort((a, b) => a.name.localeCompare(b.name))

  // ------------------------------------------------------------ ingredients --
  const first = book.addWorksheet('Ingredients')
  first.addRow([...INGREDIENT_COLUMNS])

  // Each ingredient is written in the unit it is shown in, so importing the
  // file back leaves that alone: one kilo or one litre, or a thousand grams,
  // a thousand millilitres, a hundred pieces. The cost is that much at the
  // stored rate, to the centavo - exact for any rate that is a whole centavo
  // per kilo or litre, and a fraction of a centavo out for one that is not.
  const ingredientRows: unknown[][] =
    live.length > 0
      ? live.map((ingredient) => {
          const unit = ingredient.displayUnit
          const quantity = unit === 'kg' || unit === 'L' ? 1 : unit === 'pcs' ? 100 : 1000
          const cost = (ingredient.costRate * toBase(quantity, unit)) / COST_PRECISION / 100
          return [ingredient.name, ingredient.sku, Math.round(cost * 100) / 100, quantity, unit]
        })
      : [
          ['Jersey Full Cream Milk 1L', '1L', 85, 1000, 'ml'],
          ['Nescafe Gold Medium Roast', '100g jar', 294.12, 100, 'grams'],
          ['Pet Cup 16oz', '50 pcs', 150, 50, 'pcs'],
        ]
  for (const row of ingredientRows) first.addRow(row)

  // Cost per gram, millilitre or piece, whatever the purchase was in.
  for (let row = 2; row <= LOOKUP_ROWS; row++) {
    first.getCell(`F${row}`).value = {
      formula: `IF(AND($C${row}<>"",$D${row}>0),$C${row}/($D${row}*${perBase(`$E${row}`)}),"")`,
    }
    first.getCell(`F${row}`).numFmt = '#,##0.0000'
  }
  styleSheet(first, INGREDIENT_COLUMNS)
  first.getColumn(1).width = 38

  // ---------------------------------------------------------------- recipes --
  const second = book.addWorksheet('Recipes')
  second.addRow([...MENU_RECIPE_COLUMNS])

  const liveVariants = variants.filter((row) => row.deletedAt === null && row.active)
  const example = liveVariants
    .map((variant) => ({
      variant,
      product: products.find((row) => row.id === variant.productId && row.deletedAt === null),
    }))
    .find((entry) => entry.product)
  const exampleCategory = example?.product
    ? (categories.find((row) => row.id === example.product!.categoryId)?.name ?? DEFAULT_CATEGORY)
    : 'Coffee'
  const drink = example?.product ? `${example.product.name} (${example.variant.name})` : 'Caramel Macchiato (16oz)'
  const price = example ? toDecimal(example.variant.price) : 185

  const samples: unknown[][] = live.slice(0, 3).map((ingredient, index) => [
    drink,
    index === 0 ? exampleCategory : '',
    index === 0 ? price : '',
    ingredient.name,
    ingredient.dimension === 'COUNT' ? 1 : ingredient.dimension === 'MASS' ? 10 : 100,
    BASE_UNIT[ingredient.dimension],
  ])
  for (const row of samples.length > 0
    ? samples
    : [[drink, exampleCategory, price, 'Jersey Full Cream Milk 1L', 150, 'ml']]) {
    second.addRow(row)
  }

  // Formulas run past the samples so pasted rows price themselves too.
  const table = `Ingredients!$A$2:$F$${LOOKUP_ROWS}`
  for (let row = 2; row <= LOOKUP_ROWS; row++) {
    const filled = `$D${row}<>""`
    const bought = `VLOOKUP($D${row},${table},5,FALSE)`
    // Cost per gram, millilitre or piece, straight from the Ingredients sheet.
    second.getCell(`G${row}`).value = {
      formula: `IF(${filled},IFERROR(VLOOKUP($D${row},${table},6,FALSE),""),"")`,
    }
    // A line in kilos or litres is scaled to match.
    second.getCell(`H${row}`).value = {
      formula: `IF(AND(${filled},$E${row}<>""),IFERROR($E${row}*${perBase(`$F${row}`)}*$G${row},""),"")`,
    }
    // Names the mismatch rather than just failing: a recipe in ml against an
    // ingredient bought in grams is the error this column exists to catch.
    // Grams against a kilo purchase is fine - same kind of measurement.
    second.getCell(`I${row}`).value = {
      formula: `IF(${filled},IFERROR(IF(${dimensionOf(`$F${row}`)}=${dimensionOf(bought)},"OK","CHECK UNIT"),"NOT FOUND"),"")`,
    }
    second.getCell(`G${row}`).numFmt = '#,##0.0000'
    second.getCell(`H${row}`).numFmt = '#,##0.00'
  }
  styleSheet(second, MENU_RECIPE_COLUMNS)
  second.getColumn(1).width = 30
  second.getColumn(4).width = 34

  const buffer = await book.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
```

In `ImportPanel.tsx`, change `download()` to `const blob = await menuTemplate()` and fix the import list (drop `ingredientTemplate`, `recipeTemplate`; add `menuTemplate`).

- [ ] **Step 4: Run, typecheck, full suite**

Run: `npx vitest run src/db/importing.test.ts && npm run typecheck && npx vitest run`
Expected: green. If the round-trip test fails on `costRate` equality, the three seeded rates (85 per 1000 ml → 85.00 per 1000 ml; 294 per 100 g → 2940.00 per 1000 g; 900 per 1 kg → 900.00 per 1 kg) all round exactly to the centavo in their display unit — check the arithmetic in `ingredientRows` before changing anything else. If it fails on `row.unit`, the row is being written in a unit other than `displayUnit`.

- [ ] **Step 5: Commit**

```bash
git add src/db/importing.ts src/db/importing.test.ts src/screens/menu/ImportPanel.tsx
git commit -m "One menu template: Ingredients and Recipes sheets, costs looked up from the importable sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `ImportPanel` — one flow, a preview that names what will be added

**Files:**
- Rewrite: `packages/web/src/screens/menu/ImportPanel.tsx`
- Modify: `packages/web/src/db/importing.ts` — delete `parseIngredients`, `parseRecipes`; un-export `applyIngredients`; drop `totalRows`.
- Modify: `packages/web/src/db/importing.test.ts` — port the remaining `parseIngredients`/`parseRecipes`/`applyIngredients` callers to `parseMenu`/`applyMenu`.
- Modify: `packages/web/src/screens/MenuScreen.tsx` — line 37 only: the Import tab's `allowed` guard.

**Interfaces:**
- Consumes: `parseMenu`, `applyMenu`, `menuTemplate`, `INGREDIENT_COLUMNS`, `MENU_RECIPE_COLUMNS`, `type MenuParse`, `type RecipeRow` from `importing.ts`; `Button` from `primitives.tsx`; `useSession`, `useMoney` from `providers.tsx`; `cn` from `lib/utils.ts`.
- `ParseResult<T>` loses `totalRows` (its meaning had drifted: an unpriced drink with five lines counted as one problem and no rows). Nothing asserts it; the old panel was its only reader.

- [ ] **Step 1: Port the old tests off the wrappers**

In `importing.test.ts`, rewrite each remaining caller by hand — there is no safe mechanical rule, because one test passes the promise straight to `expect().rejects` and another would be left with an unused local (`noUnusedLocals` is on, and `tsc` includes the test files):

- In `describe('reading units …')` and `describe('a drink name …')`: nothing to change.
- `reads the rows and works out the cost per unit itself`: `const result = await parseIngredients(file)` → `const result = (await parseMenu(file)).ingredients`.
- `creates the ingredients, guessing packaging from the name`: replace the two lines `const parsed = await parseIngredients(file)` / `const outcome = await applyIngredients(parsed.rows)` with `const outcome = await applyMenu(await parseMenu(file), 'USER-1')`, and `expect(outcome.created).toBe(2)` → `expect(outcome.ingredients.created).toBe(2)`.
- `re-importing updates the cost rather than duplicating the item`: `await applyIngredients((await parseIngredients(first)).rows)` → `await applyMenu(await parseMenu(first), 'USER-1')`; `const outcome = await applyIngredients((await parseIngredients(second)).rows)` → `const outcome = await applyMenu(await parseMenu(second), 'USER-1')`; `outcome.created` / `outcome.updated` → `outcome.ingredients.created` / `outcome.ingredients.updated`.
- `reports bad rows and imports the rest` and `blank spacer rows are skipped rather than flagged`: `await parseIngredients(file)` → `(await parseMenu(file)).ingredients`.
- `a file with the wrong headings is refused with an explanation`: `await expect(parseIngredients(file)).rejects.toThrow(/column headings/i)` → `await expect(parseMenu(file)).rejects.toThrow(/column headings/i)`.
- The four `describe('reading the workbook')` tests: `await parseIngredients(file)` → `(await parseMenu(file)).ingredients`.
- In `describe('importing recipes')`: every `await parseRecipes(file)` → `(await parseMenu(file)).recipes` (five tests, including the rewritten G7 one).
- Remove `parseIngredients`, `parseRecipes`, `applyIngredients` from the import list.

Run: `npx vitest run src/db/importing.test.ts && npm run typecheck`
Expected: green (the wrappers still exist).

- [ ] **Step 2: Delete the wrappers and `totalRows` from `importing.ts`**

Delete `parseIngredients` and `parseRecipes`. `applyIngredients` stays (it is `applyMenu`'s first step) but loses its `export` keyword. Remove `totalRows` from the `ParseResult` interface, from `empty<T>()`, and from the two `return { rows, problems, duplicates, totalRows: … }` statements in `parseIngredientSheet` and `parseRecipeSheet` (they become `return { rows, problems, duplicates }` / `result: { rows, problems, duplicates }`).

Run: `npx vitest run src/db/importing.test.ts`
Expected: green.

- [ ] **Step 2b: The Import tab gate in `MenuScreen.tsx`**

Line 37: `allowed: can('recipe.import') || can('inventory.adjust')` → `allowed: can('recipe.import')`. (The panel's own `if (!mayImport)` branch stays as a belt-and-braces refusal for anyone who reaches it another way.)

- [ ] **Step 3: Rewrite `ImportPanel.tsx`**

Replace the whole file with:

```tsx
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Download, Sparkles, TriangleAlert, Upload } from 'lucide-react'
import {
  applyMenu,
  INGREDIENT_COLUMNS,
  MENU_RECIPE_COLUMNS,
  menuTemplate,
  parseMenu,
  type DrinkPlan,
  type MenuParse,
  type RecipeRow,
} from '../../db/importing.ts'
import { Button } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Bringing the menu in from one spreadsheet.
 *
 * The flow is deliberately upload, check, then confirm - never upload and
 * hope. Everything is validated first and what will happen is listed before
 * a single row is written: every drink the file would add to the menu is
 * named, with its price, so a typo is seen here rather than found at the till.
 */

export function ImportPanel() {
  const { user, can } = useSession()
  const money = useMoney()
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parse, setParse] = useState<MenuParse | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // Creating priced menu items is a manager's job, whatever else a role may do to stock.
  const mayImport = can('recipe.import')

  function reset(): void {
    setParse(null)
    setFileName('')
    if (input.current) input.current.value = ''
  }

  async function download(): Promise<void> {
    try {
      const blob = await menuTemplate()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'menu-template.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('The template could not be built.')
    }
  }

  async function choose(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    setFileName(file.name)
    try {
      setParse(await parseMenu(file))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That file could not be read.')
      reset()
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (!parse || busy) return
    setBusy(true)
    try {
      const outcome = await applyMenu(parse, user?.id ?? '')
      const parts = [
        outcome.ingredients.created > 0 ? `${outcome.ingredients.created} ingredients added` : '',
        outcome.ingredients.updated > 0 ? `${outcome.ingredients.updated} updated` : '',
        outcome.products > 0 ? `${outcome.products} drinks added to the menu` : '',
        outcome.sizes > 0 ? `${outcome.sizes} sizes` : '',
        outcome.recipes > 0 ? `${outcome.recipes} recipes saved` : '',
      ].filter(Boolean)
      toast.success(parts.length > 0 ? `${parts.join(', ')}.` : 'Nothing needed importing.')
      reset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The import could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  if (!mayImport) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        Your role cannot import the menu. A manager or owner can.
      </p>
    )
  }

  const ready = parse ? parse.ingredients.rows.length + parse.recipes.rows.length : 0
  const problems = parse ? [...parse.ingredients.problems, ...parse.recipes.problems] : []
  const newDrinks = parse ? parse.drinks.filter((drink) => drink.variantId === null) : []
  const existingDrinks = parse ? parse.drinks.filter((drink) => drink.variantId !== null) : []

  // Every recipe line under its drink, so a wrong quantity or a mis-read
  // ingredient is seen here rather than found in the till's costings.
  const linesByDrink = new Map<string, RecipeRow[]>()
  for (const row of parse?.recipes.rows ?? []) {
    const list = linesByDrink.get(row.drinkKey) ?? []
    list.push(row)
    linesByDrink.set(row.drinkKey, list)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-5">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-medium text-ink">1. Start from the template</h3>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">
          One workbook, two sheets. Put what you buy on <strong>Ingredients</strong> and what goes into each
          drink on <strong>Recipes</strong>, then save it as .xlsx. It comes filled with what the shop already has.
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void download()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download the menu template
          </Button>
        </div>

        <ColumnGuide title="Ingredients sheet" columns={INGREDIENT_COLUMNS} />
        <p className="mt-2 text-[0.8125rem] text-ink-subtle">
          Cost per unit — per gram, millilitre or piece, whatever you bought it in — is worked out here from
          the total cost and quantity, so that column can stay as the formula in your sheet: it is read, not
          trusted. A row with only a name, like “ICE”, is treated as a heading and skipped.
        </p>

        <ColumnGuide title="Recipes sheet" columns={MENU_RECIPE_COLUMNS} />
        <p className="mt-2 text-[0.8125rem] text-ink-subtle">
          Write the drink as “Caramel Macchiato (16oz)” — the size in brackets is understood. A drink that is
          not on the menu yet is added to it, so give it a <strong>Selling Price</strong> on its first line and,
          if you like, a <strong>Category</strong>; blank means “Drinks”. The last three columns work themselves out.
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-medium text-ink">2. Upload the file</h3>
        <input
          ref={input}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void choose(event.target.files?.[0])}
          className="mt-3 block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-ink hover:file:bg-brand/90"
        />
        {fileName ? (
          <p className="mt-2 text-[0.8125rem] text-ink-subtle">
            Read {fileName}
            {parse
              ? ` — ${
                  parse.sheets.ingredients && parse.sheets.recipes
                    ? 'both sheets found'
                    : parse.sheets.ingredients
                      ? 'ingredients only'
                      : 'recipes only'
                }.`
              : '.'}
          </p>
        ) : null}
      </section>

      {parse ? (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-medium text-ink">3. Check before importing</h3>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Ingredients" value={parse.ingredients.rows.length} tone="positive" />
            <Count label="Drinks" value={parse.drinks.length} tone="positive" />
            <Count label="Recipe lines" value={parse.recipes.rows.length} tone="positive" />
            <Count label="Problems" value={problems.length} tone={problems.length > 0 ? 'danger' : 'default'} />
          </div>

          {problems.length > 0 ? (
            <div className="mt-4 space-y-1.5">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-danger">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                These rows will not be imported
              </p>
              <ul className="scroll-pane max-h-56 divide-y divide-line rounded-xl border border-line">
                {problems.map((problem, index) => (
                  <li key={index} className="flex gap-3 px-3 py-2 text-[0.8125rem]">
                    <span className="tabular shrink-0 text-ink-subtle">
                      {problem.sheet} · Row {problem.row}
                    </span>
                    <span className="text-ink">{problem.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-[0.8125rem] text-positive">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Every row checks out.
            </p>
          )}

          {newDrinks.length > 0 || parse.newCategories.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-muted">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Will be added to the menu
              </p>
              <ul className="scroll-pane max-h-72 divide-y divide-line rounded-xl border border-line text-[0.8125rem]">
                {parse.newCategories.map((name) => (
                  <li key={`category:${name}`} className="flex justify-between gap-3 px-3 py-2">
                    <span className="text-ink">
                      {name} <span className="text-ink-subtle">· new category</span>
                    </span>
                  </li>
                ))}
                {newDrinks.map((drink) => (
                  <DrinkPreview
                    key={drink.key}
                    drink={drink}
                    lines={linesByDrink.get(drink.key) ?? []}
                    note={drink.productId === null ? `new drink in ${drink.category}` : 'new size'}
                    trailing={<span className="tabular shrink-0 font-medium text-ink">{money(drink.price ?? 0)}</span>}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {existingDrinks.length > 0 || parse.ingredients.rows.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-[0.8125rem] font-medium text-ink-muted">
                Ingredients, and drinks already on the menu
              </p>
              <ul className="scroll-pane max-h-72 divide-y divide-line rounded-xl border border-line text-[0.8125rem]">
                {existingDrinks.map((drink) => (
                  <DrinkPreview
                    key={drink.key}
                    drink={drink}
                    lines={linesByDrink.get(drink.key) ?? []}
                    note="recipe replaced"
                    trailing={<span className="shrink-0 text-ink-muted">price kept</span>}
                  />
                ))}
                {parse.ingredients.rows.map((row) => (
                  <li key={`ingredient:${row.name}`} className="flex justify-between gap-3 px-3 py-2">
                    <span className="truncate text-ink">
                      {row.name}
                      <span className="text-ink-subtle">
                        {' '}
                        · {row.totalQuantity} {row.unit}
                      </span>
                    </span>
                    <span className="shrink-0 text-ink-muted">{row.existingId ? 'cost updated' : 'new'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Start over
            </Button>
            <Button className="flex-1" onClick={() => void confirm()} disabled={busy || ready === 0}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Importing…' : `Import ${ready} ${ready === 1 ? 'row' : 'rows'}`}
            </Button>
          </div>

          {parse.recipes.rows.length > 0 ? (
            <p className="mt-2 text-[0.8125rem] text-ink-subtle">
              Importing replaces the whole recipe for each size in the file, so running it twice does not double
              anything up. Prices of sizes already on the menu are left as they are.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

/** One drink in the check step: what will happen to it, and every line that goes into it. */
function DrinkPreview({
  drink,
  lines,
  note,
  trailing,
}: {
  drink: DrinkPlan
  lines: RecipeRow[]
  note: string
  trailing: React.ReactNode
}) {
  return (
    <li className="px-3 py-2">
      <div className="flex justify-between gap-3">
        <span className="truncate text-ink">
          {drink.name} <span className="text-ink-subtle">{drink.size}</span>
          <span className="text-ink-subtle">
            {' '}
            · {note} · {lines.length} {lines.length === 1 ? 'ingredient' : 'ingredients'}
          </span>
        </span>
        {trailing}
      </div>
      <ul className="mt-1 space-y-0.5 pl-3 text-xs text-ink-muted">
        {lines.map((line) => (
          <li key={`${line.drinkKey}|${line.ingredientName}`} className="flex justify-between gap-3">
            <span className="truncate">{line.ingredientName}</span>
            <span className="tabular shrink-0">
              {line.quantity} {line.unit}
              {line.ingredientId === null ? ' · new' : ''}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}

function ColumnGuide({ title, columns }: { title: string; columns: readonly string[] }) {
  return (
    <div className="mt-3">
      <p className="text-[0.8125rem] font-medium text-ink-muted">{title}</p>
      <div className="scroll-pane mt-1 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-xs">
          <thead>
            <tr className="border-b border-line">
              {columns.map((column) => (
                <th key={column} className="whitespace-nowrap px-2 py-1.5 font-medium text-ink-muted">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
    </div>
  )
}

function Count({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'positive' | 'danger'
}) {
  return (
    <div className="rounded-xl bg-surface-sunken px-3 py-2.5">
      <p
        className={cn(
          'tabular text-xl font-semibold',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck, full suite, build**

Run: `npm run typecheck && npx vitest run && npx vite build`
Expected: typecheck clean; 19 files green; build succeeds. The build also copies `dist/` to the repository root — do not commit that.

- [ ] **Step 5: Look at it**

Start the dev server (`npm run dev`, port 5173), sign in as an owner, open Menu → Import. Download the template; upload it back unchanged; confirm the check step lists the shop's drinks under "Will be updated" with no problems. Then edit the downloaded file: add a row `Spanish Latte (16oz) | Coffee | 165 | <an ingredient from the Ingredients sheet> | 150 | ml` and upload — confirm it appears under "Will be added to the menu" with ₱165.00 and "new drink in Coffee". Import, then check Menu → Products shows Spanish Latte.

- [ ] **Step 6: Commit**

```bash
git add src/db/importing.ts src/db/importing.test.ts src/screens/menu/ImportPanel.tsx src/screens/MenuScreen.tsx
git commit -m "Import the menu in one step, with every new drink and its price listed before anything is written

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Record what was decided and what was left

**Files:**
- Modify: `docs/rework/data-import.md`
- Modify: `docs/rework/README.md`

- [ ] **Step 1: Update `data-import.md`**

Rename the heading `## What is missing` to `## What was missing (before 2026-09-12)`. Replace the `## The freeze collision`, `## Proposed shape for ask 1`, `## Decisions needed` and `## Next actions` sections with:

```markdown
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

`packages/web/src/db/importing.ts` — `parseMenu`, `applyMenu`, `menuTemplate`. `packages/web/src/screens/menu/ImportPanel.tsx` — the one flow. Plan: `docs/superpowers/plans/2026-09-12-menu-import.md`.
```

- [ ] **Step 2: Update `README.md`**

In the tracks table change the import row's state to `**Built 2026-09-12.** Decisions recorded in the document; G10 and five minor gaps left open on purpose.` In "The one rule" section, after the paragraph about the import track breaking the rule, add: `Done: only `importing.ts` and its test changed.`

- [ ] **Step 3: Do not commit the docs** — `docs/` has never been committed; leave that to the owner.
