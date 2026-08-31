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
  if (typeof value === 'object' && 'result' in (value as Record<string, unknown>)) {
    return String((value as { result: unknown }).result ?? '').trim()
  }
  if (typeof value === 'object' && 'text' in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text ?? '').trim()
  }
  return String(value).trim()
}

function num(value: unknown): number {
  const raw = text(value).replace(/[^\d.-]/g, '')
  return raw === '' ? Number.NaN : Number(raw)
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
  row.forEach((cell, index) => {
    const heading = text(cell).toLowerCase().replace(/\s+/g, ' ')
    for (const want of wanted) {
      const target = want.toLowerCase().replace(/\s+/g, ' ')
      // Match loosely, so "Total Cost (PHP)" still finds "Total Cost (₱)".
      const stripped = target.replace(/\s*\(.*\)$/, '')
      if (heading === target || heading === stripped || heading.startsWith(stripped)) {
        if (!found.has(want)) found.set(want, index)
      }
    }
  })
  return found
}

/**
 * Read the sheet that actually holds the data.
 *
 * Not simply the first one: a real workbook has a lookup sheet, a scratch
 * sheet, last year's prices. Whichever sheet's header row matches what is
 * being imported is the one to read, and only if none matches does the first
 * sheet get used - so the error a person sees is about their headings rather
 * than about a sheet they never meant to import.
 */
async function readSheet(file: File, wanted?: readonly string[]): Promise<unknown[][]> {
  const ExcelJS = await excel()
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await file.arrayBuffer())

  if (book.worksheets.length === 0) throw new Error('That file has no sheets in it.')

  const readAll = (sheet: (typeof book.worksheets)[number]): unknown[][] => {
    const rows: unknown[][] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[]
      // ExcelJS pads index 0; drop it so columns line up with the header.
      rows.push(values.slice(1))
    })
    return rows
  }

  if (wanted) {
    for (const sheet of book.worksheets) {
      const rows = readAll(sheet)
      const hasHeadings = rows.some((row) => headerMap(row, wanted).size >= 3)
      if (hasHeadings) return rows
    }
  }

  return readAll(book.worksheets[0]!)
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
  const sheet = await readSheet(file, INGREDIENT_COLUMNS)
  const problems: RowProblem[] = []
  const rows: IngredientRow[] = []

  const headerIndex = sheet.findIndex((row) => headerMap(row, INGREDIENT_COLUMNS).size >= 3)
  if (headerIndex === -1) {
    throw new Error(
      `Could not find the expected column headings. The first row should contain: ${INGREDIENT_COLUMNS.join(', ')}.`,
    )
  }
  const columns = headerMap(sheet[headerIndex] as unknown[], INGREDIENT_COLUMNS)

  const existing = (await db.ingredients.toArray()).filter((row) => row.deletedAt === null)
  const byName = new Map(existing.map((row) => [row.name.trim().toLowerCase(), row]))
  const seen = new Set<string>()
  let duplicates = 0

  for (let index = headerIndex + 1; index < sheet.length; index++) {
    const raw = sheet[index] as unknown[]
    const at = index + 1
    const cell = (key: (typeof INGREDIENT_COLUMNS)[number]): unknown => {
      const column = columns.get(key)
      return column === undefined ? '' : raw[column]
    }

    const name = text(cell('Ingredient Name'))
    if (name.length === 0) continue // A blank line is a spacer, not an error.

    const key = name.toLowerCase()
    if (seen.has(key)) {
      duplicates++
      problems.push({ row: at, message: `"${name}" appears more than once in this file.` })
      continue
    }
    seen.add(key)

    const unitRaw = text(cell('Total Quantity Unit'))
    const unit = normaliseUnit(unitRaw)
    if (!unit) {
      problems.push({
        row: at,
        message: `"${unitRaw || 'blank'}" is not a unit we recognise. Use g, kg, ml, L or pcs.`,
      })
      continue
    }

    const totalQuantity = num(cell('Total Quantity'))
    if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) {
      problems.push({ row: at, message: 'Total quantity must be a number greater than zero.' })
      continue
    }

    const totalCost = num(cell('Total Cost (₱)'))
    if (!Number.isFinite(totalCost) || totalCost < 0) {
      problems.push({ row: at, message: 'Total cost must be a number.' })
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
      existingId: byName.get(key)?.id ?? null,
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
  const sheet = await readSheet(file, RECIPE_COLUMNS)
  const problems: RowProblem[] = []
  const rows: RecipeRow[] = []

  const headerIndex = sheet.findIndex((row) => headerMap(row, RECIPE_COLUMNS).size >= 3)
  if (headerIndex === -1) {
    throw new Error(
      `Could not find the expected column headings. The first row should contain: ${RECIPE_COLUMNS.join(', ')}.`,
    )
  }
  const columns = headerMap(sheet[headerIndex] as unknown[], RECIPE_COLUMNS)

  const [ingredients, products, variants] = await Promise.all([
    db.ingredients.toArray(),
    db.products.toArray(),
    db.productVariants.toArray(),
  ])
  const ingredientByName = new Map(
    ingredients.filter((row) => row.deletedAt === null).map((row) => [row.name.trim().toLowerCase(), row]),
  )
  const liveProducts = products.filter((row) => row.deletedAt === null)
  const liveVariants = variants.filter((row) => row.deletedAt === null)

  const seen = new Set<string>()
  let duplicates = 0

  for (let index = headerIndex + 1; index < sheet.length; index++) {
    const raw = sheet[index] as unknown[]
    const at = index + 1
    const cell = (key: (typeof RECIPE_COLUMNS)[number]): unknown => {
      const column = columns.get(key)
      return column === undefined ? '' : raw[column]
    }

    const drink = text(cell('Drink Name'))
    const ingredientName = text(cell('Ingredient Name'))
    if (drink.length === 0 && ingredientName.length === 0) continue
    // A section heading like "COFFEE" with nothing else on the line.
    if (ingredientName.length === 0) continue

    const parsed = splitDrinkName(drink)
    const size = text(cell('Size')) || parsed.size

    const product = liveProducts.find((entry) => entry.name.trim().toLowerCase() === parsed.name.toLowerCase())
    if (!product) {
      problems.push({ row: at, message: `There is no product called "${parsed.name}".` })
      continue
    }

    const forProduct = liveVariants.filter((entry) => entry.productId === product.id)
    const variant = size
      ? forProduct.find((entry) => entry.name.trim().toLowerCase() === size.toLowerCase())
      : forProduct.find((entry) => entry.isDefault) ?? forProduct[0]

    if (!variant) {
      problems.push({
        row: at,
        message: `"${parsed.name}" has no size called "${size}". It has: ${forProduct.map((entry) => entry.name).join(', ') || 'none'}.`,
      })
      continue
    }

    const ingredient = ingredientByName.get(ingredientName.toLowerCase())
    if (!ingredient) {
      problems.push({ row: at, message: `There is no ingredient called "${ingredientName}". Import ingredients first.` })
      continue
    }

    const unitRaw = text(cell('Quantity Unit'))
    const unit = normaliseUnit(unitRaw)
    if (!unit) {
      problems.push({ row: at, message: `"${unitRaw || 'blank'}" is not a unit we recognise.` })
      continue
    }
    if (unitDimension(unit) !== ingredient.dimension) {
      problems.push({
        row: at,
        message: `${ingredient.name} is measured in ${ingredient.displayUnit}, so it cannot be used in ${unit}.`,
      })
      continue
    }

    const quantity = num(cell('Quantity Used'))
    if (!Number.isFinite(quantity) || quantity <= 0) {
      problems.push({ row: at, message: 'Quantity used must be a number greater than zero.' })
      continue
    }

    const key = `${variant.id}|${ingredient.id}`
    if (seen.has(key)) {
      duplicates++
      problems.push({ row: at, message: `${ingredient.name} is listed twice for ${drink}.` })
      continue
    }
    seen.add(key)

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
