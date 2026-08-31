import { beforeEach, describe, expect, test } from 'vitest'
import ExcelJS from 'exceljs'
import {
  costRateFromPurchase,
  fromDecimal,
  type Category,
  type Ingredient,
  type Product,
  type ProductVariant,
} from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import { loadRecipeFor } from './recipes.ts'
import {
  applyIngredients,
  applyRecipes,
  normaliseUnit,
  parseIngredients,
  parseRecipes,
  splitDrinkName,
} from './importing.ts'

/**
 * Importing a spreadsheet.
 *
 * These build a real .xlsx in memory and read it back, because the failures
 * worth catching are all in the messy middle: a heading that is spelled
 * slightly differently, "grams" instead of "g", a drink whose size is in
 * brackets, and rows that must be refused rather than half-imported.
 */

async function sheetFile(name: string, rows: unknown[][]): Promise<File> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet(name)
  for (const row of rows) sheet.addRow(row)
  const buffer = await book.xlsx.writeBuffer()
  return new File([buffer], `${name}.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const INGREDIENT_HEADER = [
  'Ingredient Name',
  'Purchase Unit',
  'Total Cost (₱)',
  'Total Quantity',
  'Total Quantity Unit',
  'Cost per Unit (AUTO)',
]

const RECIPE_HEADER = ['Drink Name', 'Size', 'Ingredient Name', 'Quantity Used', 'Quantity Unit']

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
}

beforeEach(reset)

describe('reading units the way people write them', () => {
  test('accepts the long spellings from a real sheet', () => {
    expect(normaliseUnit('grams')).toBe('g')
    expect(normaliseUnit('Grams')).toBe('g')
    expect(normaliseUnit('ml')).toBe('ml')
    expect(normaliseUnit('Liters')).toBe('L')
    expect(normaliseUnit('pcs')).toBe('pcs')
    expect(normaliseUnit('pieces')).toBe('pcs')
    expect(normaliseUnit('KG')).toBe('kg')
  })

  test('refuses something that is not a unit', () => {
    expect(normaliseUnit('scoops')).toBeNull()
    expect(normaliseUnit('')).toBeNull()
  })
})

describe('a drink name with the size in brackets', () => {
  test('is split into a name and a size', () => {
    expect(splitDrinkName('Caramel Macchiato (16oz)')).toEqual({ name: 'Caramel Macchiato', size: '16oz' })
    expect(splitDrinkName('Choco Milk (22oz)')).toEqual({ name: 'Choco Milk', size: '22oz' })
  })

  test('is left alone when there are no brackets', () => {
    expect(splitDrinkName('Butter Croissant')).toEqual({ name: 'Butter Croissant', size: '' })
  })
})

describe('importing ingredients', () => {
  test('reads the rows and works out the cost per unit itself', async () => {
    const file = await sheetFile('Ingredients', [
      INGREDIENT_HEADER,
      ['Jersey Full Cream Milk 1L', '1L', 85, 1000, 'ml', '=C2/D2'],
      ['Nescafe Gold', '100g jar', 294.12, 100, 'grams', ''],
    ])

    const result = await parseIngredients(file)

    expect(result.problems).toEqual([])
    expect(result.rows).toHaveLength(2)
    // 85.00 for 1000 ml, computed here rather than read from the AUTO column.
    expect(result.rows[0]?.costRate).toBe(costRateFromPurchase(fromDecimal(85), 1000, 'ml'))
    expect(result.rows[1]?.unit).toBe('g')
  })

  test('creates the ingredients, guessing packaging from the name', async () => {
    const file = await sheetFile('Ingredients', [
      INGREDIENT_HEADER,
      ['Fresh Milk', '1L', 85, 1000, 'ml', ''],
      ['Pet Cup 16oz', '50 pcs', 150, 50, 'pcs', ''],
    ])
    const parsed = await parseIngredients(file)
    const outcome = await applyIngredients(parsed.rows)

    expect(outcome.created).toBe(2)
    const stored = await db.ingredients.toArray()
    expect(stored.find((row) => row.name === 'Pet Cup 16oz')?.stockClass).toBe('PACKAGING')
    expect(stored.find((row) => row.name === 'Fresh Milk')?.stockClass).toBe('INGREDIENT')
  })

  test('re-importing updates the cost rather than duplicating the item', async () => {
    const first = await sheetFile('Ingredients', [INGREDIENT_HEADER, ['Fresh Milk', '1L', 85, 1000, 'ml', '']])
    await applyIngredients((await parseIngredients(first)).rows)

    const second = await sheetFile('Ingredients', [INGREDIENT_HEADER, ['Fresh Milk', '1L', 95, 1000, 'ml', '']])
    const outcome = await applyIngredients((await parseIngredients(second)).rows)

    expect(outcome.created).toBe(0)
    expect(outcome.updated).toBe(1)
    const stored = await db.ingredients.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.costRate).toBe(costRateFromPurchase(fromDecimal(95), 1000, 'ml'))
  })

  test('reports bad rows and imports the rest', async () => {
    const file = await sheetFile('Ingredients', [
      INGREDIENT_HEADER,
      ['Good One', '1L', 85, 1000, 'ml', ''],
      ['Bad Unit', '1 tub', 50, 10, 'scoops', ''],
      ['Bad Quantity', '1L', 50, 0, 'ml', ''],
      ['Good One', '1L', 85, 1000, 'ml', ''],
    ])

    const result = await parseIngredients(file)

    expect(result.rows).toHaveLength(1)
    expect(result.problems).toHaveLength(3)
    expect(result.duplicates).toBe(1)
    expect(result.problems.some((p) => /not a unit/i.test(p.message))).toBe(true)
    expect(result.problems.some((p) => /greater than zero/i.test(p.message))).toBe(true)
    expect(result.problems.some((p) => /more than once/i.test(p.message))).toBe(true)
  })

  test('a file with the wrong headings is refused with an explanation', async () => {
    const file = await sheetFile('Ingredients', [['Thing', 'Whatever'], ['x', 'y']])
    await expect(parseIngredients(file)).rejects.toThrow(/column headings/i)
  })

  test('blank spacer rows are skipped rather than flagged', async () => {
    const file = await sheetFile('Ingredients', [
      INGREDIENT_HEADER,
      ['Fresh Milk', '1L', 85, 1000, 'ml', ''],
      ['', '', '', '', '', ''],
      ['Sugar', '1kg', 60, 1000, 'g', ''],
    ])
    const result = await parseIngredients(file)
    expect(result.rows).toHaveLength(2)
    expect(result.problems).toEqual([])
  })
})

describe('importing recipes', () => {
  async function seedMenu(): Promise<void> {
    const category = stamp<Category>({ name: 'Hot', colour: '#000', icon: 'Coffee', sortOrder: 0, active: true })
    const product = stamp<Product>({
      categoryId: category.id, name: 'Caramel Macchiato', description: '', sku: '', imageDataUrl: null,
      active: true, available: true, sortOrder: 0, taxable: true, modifierGroupIds: [],
    })
    const variant = stamp<ProductVariant>({
      productId: product.id, name: '16oz', price: fromDecimal(185), sortOrder: 0, active: true, isDefault: true,
    })
    const milk = stamp<Ingredient>({
      name: 'Jersey Full Cream Milk 1L', sku: '', stockClass: 'INGREDIENT', dimension: 'VOLUME',
      displayUnit: 'ml', costRate: costRateFromPurchase(fromDecimal(85), 1000, 'ml'), supplierId: null,
      lowStockThresholdBase: 0, trackStock: true, active: true,
    })
    const beans = stamp<Ingredient>({
      name: 'Nescafe Gold', sku: '', stockClass: 'INGREDIENT', dimension: 'MASS',
      displayUnit: 'g', costRate: costRateFromPurchase(fromDecimal(294), 100, 'g'), supplierId: null,
      lowStockThresholdBase: 0, trackStock: true, active: true,
    })
    await commit([
      created('categories', category),
      created('products', product),
      created('productVariants', variant),
      created('ingredients', milk),
      created('ingredients', beans),
    ])
  }

  test('matches a drink, its size and its ingredients', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      RECIPE_HEADER,
      ['Caramel Macchiato', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
      ['Caramel Macchiato', '16oz', 'Nescafe Gold', 3, 'grams'],
    ])

    const result = await parseRecipes(file)
    expect(result.problems).toEqual([])
    expect(result.rows).toHaveLength(2)

    const variant = (await db.productVariants.toArray())[0]!
    await applyRecipes(result.rows, 'USER-1')

    const { components } = await loadRecipeFor(variant.id)
    expect(components).toHaveLength(2)
    expect(components.find((c) => c.baseQuantity === 150)).toBeDefined()
    expect(components.find((c) => c.baseQuantity === 3)).toBeDefined()
  })

  test('understands a size written in brackets, with no Size column', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      ['Drink Name', 'Ingredient Name', 'Quantity Used', 'Quantity Unit'],
      ['Caramel Macchiato (16oz)', 'Jersey Full Cream Milk 1L', 150, 'ml'],
    ])
    const result = await parseRecipes(file)
    expect(result.problems).toEqual([])
    expect(result.rows[0]?.size).toBe('16oz')
  })

  test('refuses a drink or ingredient it has never heard of', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      RECIPE_HEADER,
      ['Unicorn Frappe', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
      ['Caramel Macchiato', '16oz', 'Moon Dust', 5, 'g'],
      ['Caramel Macchiato', '99oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
    ])

    const result = await parseRecipes(file)
    expect(result.rows).toHaveLength(0)
    expect(result.problems.some((p) => /no product called/i.test(p.message))).toBe(true)
    expect(result.problems.some((p) => /no ingredient called/i.test(p.message))).toBe(true)
    expect(result.problems.some((p) => /no size called/i.test(p.message))).toBe(true)
  })

  test('refuses a unit that does not match how the ingredient is measured', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      RECIPE_HEADER,
      // Milk is a volume; grams is a mass.
      ['Caramel Macchiato', '16oz', 'Jersey Full Cream Milk 1L', 150, 'grams'],
    ])
    const result = await parseRecipes(file)
    expect(result.rows).toHaveLength(0)
    expect(result.problems[0]?.message).toMatch(/cannot be used in/i)
  })

  test('importing twice replaces the recipe rather than doubling it', async () => {
    await seedMenu()
    const rows = [RECIPE_HEADER, ['Caramel Macchiato', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml']]

    await applyRecipes((await parseRecipes(await sheetFile('R', rows))).rows, 'USER-1')
    await applyRecipes((await parseRecipes(await sheetFile('R', rows))).rows, 'USER-1')

    const variant = (await db.productVariants.toArray())[0]!
    const { components } = await loadRecipeFor(variant.id)
    expect(components).toHaveLength(1)
    expect(components[0]?.baseQuantity).toBe(150)
  })

  test('a section heading row with no ingredient is skipped', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      RECIPE_HEADER,
      ['COFFEE', '', '', '', ''],
      ['Caramel Macchiato', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
    ])
    const result = await parseRecipes(file)
    expect(result.rows).toHaveLength(1)
    expect(result.problems).toEqual([])
  })
})
