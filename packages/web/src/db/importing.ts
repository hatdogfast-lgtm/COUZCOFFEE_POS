import {
  costRateFromPurchase,
  fromDecimal,
  isUnit,
  toBase,
  unitDimension,
  type Ingredient,
  type Unit,
  BASE_UNIT,
  COST_PRECISION,
} from '@pos/shared'
import { db } from './database.ts'
import { commit, created, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'
import type { RecipeComponent } from './recipes.ts'
import { saveRecipe } from './recipes.ts'

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
 * The columns the importer reads.
 *
 * Matched by heading rather than by position, so extra columns in a shop's own
 * sheet are simply ignored and the order does not matter. 'Size' is optional:
 * a drink written as "Caramel Macchiato (16oz)" carries its size in brackets.
 */
export const RECIPE_COLUMNS = [
  'Drink Name',
  'Size',
  'Ingredient Name',
  'Quantity Used',
  'Quantity Unit',
] as const

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

export async function parseIngredients(file: File): Promise<ParseResult<IngredientRow>> {
  const found = locate(await readWorkbook(file), INGREDIENT_COLUMNS)
  if (!found) {
    throw new Error(
      `Could not find the expected column headings. The first row should contain: ${INGREDIENT_COLUMNS.join(', ')}.`,
    )
  }
  const { sheet, headerIndex, columns } = found
  const problems: RowProblem[] = []
  const rows: IngredientRow[] = []

  const existing = (await db.ingredients.toArray()).filter((row) => row.deletedAt === null)
  const byName = new Map(existing.map((row) => [key(row.name), row]))
  const seen = new Set<string>()
  let duplicates = 0

  for (const { number: at, cells: raw } of sheet.rows.slice(headerIndex + 1)) {
    const cell = (want: (typeof INGREDIENT_COLUMNS)[number]): unknown => {
      const column = columns.get(want)
      return column === undefined ? '' : raw[column]
    }

    const name = text(cell('Ingredient Name'))
    if (name.length === 0) continue // A blank line is a spacer, not an error.

    const k = key(name)
    if (seen.has(k)) {
      duplicates++
      problems.push({ sheet: sheet.name, row: at, message: `"${name}" appears more than once in this file.` })
      continue
    }
    seen.add(k)

    const unitRaw = text(cell('Total Quantity Unit'))
    const unit = normaliseUnit(unitRaw)
    if (!unit) {
      problems.push({
        sheet: sheet.name,
        row: at,
        message: `"${unitRaw || 'blank'}" is not a unit we recognise. Use g, kg, ml, L or pcs.`,
      })
      continue
    }

    const totalQuantity = num(cell('Total Quantity'))
    if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) {
      problems.push({ sheet: sheet.name, row: at, message: 'Total quantity must be a number greater than zero.' })
      continue
    }

    const totalCost = num(cell('Total Cost (₱)'))
    if (!Number.isFinite(totalCost) || totalCost < 0) {
      problems.push({ sheet: sheet.name, row: at, message: 'Total cost must be a number.' })
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

export async function applyIngredients(rows: IngredientRow[]): Promise<{ created: number; updated: number }> {
  const writes: PendingWrite[] = []
  const existing = new Map((await db.ingredients.toArray()).map((row) => [row.id, row]))
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
      updatedCount++
    } else {
      writes.push(
        created(
          'ingredients',
          stamp<Ingredient>({
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
          }),
        ),
      )
      createdCount++
    }
  }

  await commit(writes)
  return { created: createdCount, updated: updatedCount }
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
  productName: string
  size: string
  ingredientName: string
  quantity: number
  unit: Unit
  ingredientId: string
  variantId: string
}

/** "Caramel Macchiato (16oz)" -> name and size, when they share one column. */
export function splitDrinkName(raw: string): { name: string; size: string } {
  const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(raw.trim())
  if (match?.[1] && match[2]) return { name: match[1].trim(), size: match[2].trim() }
  return { name: raw.trim(), size: '' }
}

export async function parseRecipes(file: File): Promise<ParseResult<RecipeRow>> {
  const found = locate(await readWorkbook(file), RECIPE_COLUMNS)
  if (!found) {
    throw new Error(
      `Could not find the expected column headings. The first row should contain: ${RECIPE_COLUMNS.join(', ')}.`,
    )
  }
  const { sheet, headerIndex, columns } = found
  const problems: RowProblem[] = []
  const rows: RecipeRow[] = []

  const [ingredients, products, variants] = await Promise.all([
    db.ingredients.toArray(),
    db.products.toArray(),
    db.productVariants.toArray(),
  ])
  const ingredientByName = new Map(
    ingredients.filter((row) => row.deletedAt === null).map((row) => [key(row.name), row]),
  )
  const liveProducts = products.filter((row) => row.deletedAt === null)
  const liveVariants = variants.filter((row) => row.deletedAt === null)

  const seen = new Set<string>()
  let duplicates = 0

  for (const { number: at, cells: raw } of sheet.rows.slice(headerIndex + 1)) {
    const cell = (want: (typeof RECIPE_COLUMNS)[number]): unknown => {
      const column = columns.get(want)
      return column === undefined ? '' : raw[column]
    }

    const drink = text(cell('Drink Name'))
    const ingredientName = text(cell('Ingredient Name'))
    if (drink.length === 0 && ingredientName.length === 0) continue
    // A section heading like "COFFEE" with nothing else on the line.
    if (ingredientName.length === 0) continue

    const parsed = splitDrinkName(drink)
    const size = text(cell('Size')) || parsed.size

    const product = liveProducts.find((entry) => key(entry.name) === key(parsed.name))
    if (!product) {
      problems.push({ sheet: sheet.name, row: at, message: `There is no product called "${parsed.name}".` })
      continue
    }

    const forProduct = liveVariants.filter((entry) => entry.productId === product.id)
    const variant = size
      ? forProduct.find((entry) => key(entry.name) === key(size))
      : forProduct.find((entry) => entry.isDefault) ?? forProduct[0]

    if (!variant) {
      problems.push({
        sheet: sheet.name,
        row: at,
        message: `"${parsed.name}" has no size called "${size}". It has: ${forProduct.map((entry) => entry.name).join(', ') || 'none'}.`,
      })
      continue
    }

    const ingredient = ingredientByName.get(key(ingredientName))
    if (!ingredient) {
      problems.push({
        sheet: sheet.name,
        row: at,
        message: `There is no ingredient called "${ingredientName}". Import ingredients first.`,
      })
      continue
    }

    const unitRaw = text(cell('Quantity Unit'))
    const unit = normaliseUnit(unitRaw)
    if (!unit) {
      problems.push({ sheet: sheet.name, row: at, message: `"${unitRaw || 'blank'}" is not a unit we recognise.` })
      continue
    }
    if (unitDimension(unit) !== ingredient.dimension) {
      problems.push({
        sheet: sheet.name,
        row: at,
        message: `${ingredient.name} is measured in ${ingredient.displayUnit}, so it cannot be used in ${unit}.`,
      })
      continue
    }

    const quantity = num(cell('Quantity Used'))
    if (!Number.isFinite(quantity) || quantity <= 0) {
      problems.push({ sheet: sheet.name, row: at, message: 'Quantity used must be a number greater than zero.' })
      continue
    }

    const lineKey = `${variant.id}|${ingredient.id}`
    if (seen.has(lineKey)) {
      duplicates++
      problems.push({ sheet: sheet.name, row: at, message: `${ingredient.name} is listed twice for ${drink}.` })
      continue
    }
    seen.add(lineKey)

    rows.push({
      productName: product.name,
      size: variant.name,
      ingredientName: ingredient.name,
      quantity,
      unit,
      ingredientId: ingredient.id,
      variantId: variant.id,
    })
  }

  return { rows, problems, duplicates, totalRows: rows.length + problems.length }
}

export async function applyRecipes(rows: RecipeRow[], userId: string): Promise<{ recipes: number }> {
  const byVariant = new Map<string, RecipeComponent[]>()
  for (const row of rows) {
    const list = byVariant.get(row.variantId) ?? []
    list.push({
      ingredientId: row.ingredientId,
      baseQuantity: toBase(row.quantity, row.unit),
      optional: false,
    })
    byVariant.set(row.variantId, list)
  }

  const variants = await db.productVariants.toArray()

  for (const [variantId, components] of byVariant) {
    const variant = variants.find((entry) => entry.id === variantId)
    if (!variant) continue
    // Each sheet is the whole recipe for that size, so it replaces what was
    // there rather than adding to it - importing twice must not double it.
    await saveRecipe({ variant, components, notes: '', userId })
  }

  return { recipes: byVariant.size }
}
