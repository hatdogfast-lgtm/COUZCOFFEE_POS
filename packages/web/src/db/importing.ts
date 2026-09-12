import {
  costRateFromPurchase,
  fromDecimal,
  isUnit,
  toBase,
  toDecimal,
  unitDimension,
  type AuditLog,
  type Category,
  type Dimension,
  type Ingredient,
  type Money,
  type Product,
  type ProductVariant,
  type Unit,
  BASE_UNIT,
  COST_PRECISION,
} from '@pos/shared'
import { db } from './database.ts'
import { commit, created, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'
import type { RecipeComponent } from './recipes.ts'
import { loadRecipeFor, saveRecipe } from './recipes.ts'

/**
 * Bringing a menu in from a spreadsheet.
 *
 * The column headings match the sheet the shop already keeps, so an existing
 * file can be pasted in without being rearranged first. Everything is checked
 * before anything is written: a file with three bad rows imports the good ones
 * and tells you precisely what was wrong with the rest, rather than failing
 * wholesale or - worse - importing nonsense quietly.
 *
 * ExcelJS is loaded on demand. It is a large library and most days nobody
 * imports anything, so it should not be in the bundle the till starts with.
 */

async function excel() {
  const module = await import('exceljs')
  return module.default ?? module
}

// ------------------------------------------------------------------ headings --

export const INGREDIENT_COLUMNS = [
  'Ingredient Name',
  'Purchase Unit',
  'Total Cost (₱)',
  'Total Quantity',
  'Total Quantity Unit',
  'Cost per Unit (AUTO)',
] as const

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

/** The full layout written into the downloadable template. */
export const RECIPE_TEMPLATE_COLUMNS = [
  'Drink Name',
  'Ingredient Name',
  'Quantity Used',
  'Quantity Unit',
  'Cost per Unit (AUTO)',
  'Total Ingredient Cost',
  'Unit Check',
] as const

export interface RowProblem {
  /** Which sheet of the workbook, so a person can find the row. */
  sheet: string
  /** Excel's own row number, not a count of the rows that had something in them. */
  row: number
  message: string
}

export interface ParseResult<T> {
  rows: T[]
  problems: RowProblem[]
  duplicates: number
  totalRows: number
}

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

function num(value: unknown): number {
  const raw = text(value).replace(/[^\d.-]/g, '')
  return raw === '' ? Number.NaN : Number(raw)
}

/** How names are compared: case, surrounding space and doubled spaces are ignored. */
function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Accepts the spellings people actually type, not just the canonical ones. */
export function normaliseUnit(raw: string): Unit | null {
  const value = raw.trim().toLowerCase()
  const table: Record<string, Unit> = {
    g: 'g', gram: 'g', grams: 'g', gr: 'g',
    kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
    ml: 'ml', milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml',
    l: 'L', liter: 'L', litre: 'L', liters: 'L', litres: 'L',
    pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', ea: 'pcs', each: 'pcs', unit: 'pcs', units: 'pcs',
  }
  const mapped = table[value]
  if (mapped) return mapped
  return isUnit(raw.trim()) ? (raw.trim() as Unit) : null
}

// ---------------------------------------------------------------- templates --

async function templateWorkbook(sheetName: string, headings: readonly string[], samples: unknown[][]) {
  const ExcelJS = await excel()
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet(sheetName)

  sheet.addRow([...headings])
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE4DA' } }
  header.alignment = { vertical: 'middle' }

  for (const sample of samples) sheet.addRow(sample)

  headings.forEach((heading, index) => {
    sheet.getColumn(index + 1).width = Math.max(16, heading.length + 4)
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  return book
}

export async function ingredientTemplate(): Promise<Blob> {
  const book = await templateWorkbook('Ingredients', INGREDIENT_COLUMNS, [
    ['Jersey Full Cream Milk 1L', '1L', 85, 1000, 'ml', ''],
    ['Nescafe Gold Medium Roast', '100g jar', 294.12, 100, 'grams', ''],
    ['Pet Cup 16oz', '50 pcs', 150, 50, 'pcs', ''],
  ])
  const buffer = await book.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** How many ingredient rows the lookup formulas are allowed to reach. */
const LOOKUP_ROWS = 500

/**
 * The recipes workbook.
 *
 * Laid out like the sheet a coffee shop already keeps, so existing rows paste
 * straight in: the drink carries its size in brackets, and the last three
 * columns work themselves out.
 *
 * The workbook ships with a second sheet holding the shop's real ingredients
 * and their real costs, so the moment a row is typed the cost appears. That is
 * the point of it - a recipe you cannot price while you are writing it is a
 * recipe you price wrong.
 *
 * Those computed columns are read on import but never trusted: the cost that
 * ends up on the books is worked out here from the ingredient, not from
 * whatever a spreadsheet happened to contain.
 */
export async function recipeTemplate(): Promise<Blob> {
  const ExcelJS = await excel()
  const book = new ExcelJS.Workbook()

  // The recipes sheet is added first so it is the one that opens; the
  // ingredient list behind it is a lookup, not something to type into.
  const sheet = book.addWorksheet('Recipes')

  // ------------------------------------------------------------ ingredients --
  const live = (await db.ingredients.toArray())
    .filter((row) => row.deletedAt === null && row.active)
    .sort((a, b) => a.name.localeCompare(b.name))

  const source = book.addWorksheet('Ingredients')
  source.addRow(['Ingredient Name', 'Unit', 'Cost per Unit'])
  for (const ingredient of live) {
    source.addRow([
      ingredient.name,
      BASE_UNIT[ingredient.dimension],
      ingredient.costRate / COST_PRECISION / 100,
    ])
  }
  source.getRow(1).font = { bold: true }
  source.getColumn(1).width = 38
  source.getColumn(2).width = 12
  source.getColumn(3).width = 16
  source.getColumn(3).numFmt = '#,##0.0000'
  source.views = [{ state: 'frozen', ySplit: 1 }]

  // ---------------------------------------------------------------- recipes --
  sheet.addRow([...RECIPE_TEMPLATE_COLUMNS])

  // Sample rows are built from the shop's own menu and ingredients, so the
  // template imports cleanly as downloaded. Illustrative names that do not
  // exist here would fail on the first try and teach the wrong lesson.
  const [products, variants] = await Promise.all([db.products.toArray(), db.productVariants.toArray()])
  const liveVariants = variants.filter((row) => row.deletedAt === null && row.active)
  const example = liveVariants
    .map((variant) => ({
      variant,
      product: products.find((row) => row.id === variant.productId && row.deletedAt === null),
    }))
    .find((entry) => entry.product)

  const drink = example?.product
    ? `${example.product.name} (${example.variant.name})`
    : 'Caramel Macchiato (16oz)'

  const samples = live.slice(0, 3).map((ingredient) => [
    drink,
    ingredient.name,
    ingredient.dimension === 'COUNT' ? 1 : ingredient.dimension === 'MASS' ? 10 : 100,
    BASE_UNIT[ingredient.dimension],
  ])

  for (const sample of samples.length > 0
    ? samples
    : [['Caramel Macchiato (16oz)', 'Fresh Milk', 150, 'ml']]) {
    sheet.addRow(sample)
  }

  // Formulas run past the samples so pasted rows price themselves too.
  const table = `Ingredients!$A$2:$C$${LOOKUP_ROWS}`
  for (let row = 2; row <= LOOKUP_ROWS; row++) {
    const filled = `$B${row}<>""`
    sheet.getCell(`E${row}`).value = {
      formula: `IF(${filled},IFERROR(VLOOKUP($B${row},${table},3,FALSE),""),"")`,
    }
    sheet.getCell(`F${row}`).value = {
      formula: `IF(AND(${filled},$C${row}<>""),IFERROR($C${row}*$E${row},""),"")`,
    }
    // Names the mismatch rather than just failing: a recipe in ml against an
    // ingredient priced per gram is the error this column exists to catch.
    sheet.getCell(`G${row}`).value = {
      formula: `IF(${filled},IFERROR(IF(EXACT(LOWER($D${row}),LOWER(VLOOKUP($B${row},${table},2,FALSE))),"OK","CHECK UNIT"),"NOT FOUND"),"")`,
    }
    sheet.getCell(`E${row}`).numFmt = '#,##0.0000'
    sheet.getCell(`F${row}`).numFmt = '#,##0.00'
  }

  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE4DA' } }
  RECIPE_TEMPLATE_COLUMNS.forEach((heading, index) => {
    sheet.getColumn(index + 1).width = Math.max(16, heading.length + 4)
  })
  sheet.getColumn(1).width = 30
  sheet.getColumn(2).width = 34
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await book.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ------------------------------------------------------------------ reading --

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

// -------------------------------------------------------------- ingredients --

export interface IngredientRow {
  name: string
  purchaseUnit: string
  totalCost: number
  totalQuantity: number
  unit: Unit
  costRate: number
  existingId: string | null
}

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

/** Packaging and resale items behave differently, so guess from the name. */
function guessStockClass(name: string): Ingredient['stockClass'] {
  const value = name.toLowerCase()
  if (/(cup|lid|straw|sticker|plastic|paper bag|tissue|cutlery|packaging|box)/.test(value)) return 'PACKAGING'
  if (/(cookie|croissant|cake|bread|sandwich|pastry|snack|chips)/.test(value)) return 'RETAIL'
  return 'INGREDIENT'
}

// ------------------------------------------------------------------ recipes --

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

/** "Caramel Macchiato (16oz)" -> name and size, when they share one column. */
export function splitDrinkName(raw: string): { name: string; size: string } {
  const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(raw.trim())
  if (match?.[1] && match[2]) return { name: match[1].trim(), size: match[2].trim() }
  return { name: raw.trim(), size: '' }
}

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
