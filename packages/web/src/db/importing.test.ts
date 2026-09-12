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
import { loadRecipeFor, saveRecipe } from './recipes.ts'
import {
  applyMenu,
  DEFAULT_CATEGORY,
  MENU_RECIPE_COLUMNS,
  menuTemplate,
  normaliseUnit,
  parseMenu,
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

    const result = (await parseMenu(file)).ingredients

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
    const outcome = await applyMenu(await parseMenu(file), 'USER-1')

    expect(outcome.ingredients.created).toBe(2)
    const stored = await db.ingredients.toArray()
    expect(stored.find((row) => row.name === 'Pet Cup 16oz')?.stockClass).toBe('PACKAGING')
    expect(stored.find((row) => row.name === 'Fresh Milk')?.stockClass).toBe('INGREDIENT')
  })

  test('a strawberry is not a straw, and a wrapper is packaging', async () => {
    const file = await sheetFile('Ingredients', [
      INGREDIENT_HEADER,
      ['ZNW-STRAWBERRY SYRUP 1.25KG', '1L', 115, 1000, 'ml', ''],
      ['STRAWBERRY JAM (DOKING)', 'pack', 320, 3000, 'grams', ''],
      ['Indiv boba straw black 21cm 100PCS', 'pack', 50, 100, 'pcs', ''],
      ['MARBY WRAPPER 25 PCS', 'pack', 75, 100, 'pcs', ''],
      ['DOUBLE WALL BLACK 12OZ', 'pcs', 180, 50, 'pcs', ''],
    ])
    await applyMenu(await parseMenu(file), 'USER-1')

    const classOf = new Map((await db.ingredients.toArray()).map((row) => [row.name, row.stockClass]))
    expect(classOf.get('ZNW-STRAWBERRY SYRUP 1.25KG')).toBe('INGREDIENT')
    expect(classOf.get('STRAWBERRY JAM (DOKING)')).toBe('INGREDIENT')
    expect(classOf.get('Indiv boba straw black 21cm 100PCS')).toBe('PACKAGING')
    expect(classOf.get('MARBY WRAPPER 25 PCS')).toBe('PACKAGING')
    expect(classOf.get('DOUBLE WALL BLACK 12OZ')).toBe('PACKAGING')
  })

  test('re-importing updates the cost rather than duplicating the item', async () => {
    const first = await sheetFile('Ingredients', [INGREDIENT_HEADER, ['Fresh Milk', '1L', 85, 1000, 'ml', '']])
    await applyMenu(await parseMenu(first), 'USER-1')

    const second = await sheetFile('Ingredients', [INGREDIENT_HEADER, ['Fresh Milk', '1L', 95, 1000, 'ml', '']])
    const outcome = await applyMenu(await parseMenu(second), 'USER-1')

    expect(outcome.ingredients.created).toBe(0)
    expect(outcome.ingredients.updated).toBe(1)
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

    const result = (await parseMenu(file)).ingredients

    expect(result.rows).toHaveLength(1)
    expect(result.problems).toHaveLength(3)
    expect(result.duplicates).toBe(1)
    expect(result.problems.some((p) => /not a unit/i.test(p.message))).toBe(true)
    expect(result.problems.some((p) => /greater than zero/i.test(p.message))).toBe(true)
    expect(result.problems.some((p) => /more than once/i.test(p.message))).toBe(true)
  })

  test('a file with the wrong headings is refused with an explanation', async () => {
    const file = await sheetFile('Ingredients', [['Thing', 'Whatever'], ['x', 'y']])
    await expect(parseMenu(file)).rejects.toThrow(/column headings/i)
  })

  test('blank spacer rows are skipped rather than flagged', async () => {
    const file = await sheetFile('Ingredients', [
      INGREDIENT_HEADER,
      ['Fresh Milk', '1L', 85, 1000, 'ml', ''],
      ['', '', '', '', '', ''],
      ['Sugar', '1kg', 60, 1000, 'g', ''],
    ])
    const result = (await parseMenu(file)).ingredients
    expect(result.rows).toHaveLength(2)
    expect(result.problems).toEqual([])
  })
})

/** A shop with one drink in one size, and the two things it is made of. */
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
  // Shown by the kilo, so the template's unit handling is exercised, not assumed.
  const kilo = stamp<Ingredient>({
    name: 'Espresso Beans', sku: '1kg bag', stockClass: 'INGREDIENT', dimension: 'MASS',
    displayUnit: 'kg', costRate: costRateFromPurchase(fromDecimal(900), 1, 'kg'), supplierId: null,
    lowStockThresholdBase: 0, trackStock: true, active: true,
  })
  await commit([
    created('categories', category),
    created('products', product),
    created('productVariants', variant),
    created('ingredients', milk),
    created('ingredients', beans),
    created('ingredients', kilo),
  ])
}

/** The combined template's recipes sheet, minus the three computed columns. */
const MENU_HEADER = ['Drink Name', 'Category', 'Selling Price (₱)', 'Ingredient Name', 'Quantity Used', 'Quantity Unit']

describe('importing recipes', () => {
  test('matches a drink, its size and its ingredients', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      RECIPE_HEADER,
      ['Caramel Macchiato', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
      ['Caramel Macchiato', '16oz', 'Nescafe Gold', 3, 'grams'],
    ])

    const result = (await parseMenu(file)).recipes
    expect(result.problems).toEqual([])
    expect(result.rows).toHaveLength(2)

    const variant = (await db.productVariants.toArray())[0]!
    await applyMenu(await parseMenu(file), 'USER-1')

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
    const result = (await parseMenu(file)).recipes
    expect(result.problems).toEqual([])
    expect(result.rows[0]?.size).toBe('16oz')
  })

  test('refuses an ingredient it has never heard of, but not a drink', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      RECIPE_HEADER,
      ['Unicorn Frappe', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
      ['Caramel Macchiato', '16oz', 'Moon Dust', 5, 'g'],
      ['Caramel Macchiato', '99oz', 'Jersey Full Cream Milk 1L', 150, 'ml'],
    ])

    const result = (await parseMenu(file)).recipes
    // Both unknown drinks are new sizes with no price, so they are refused for that reason.
    expect(result.rows).toHaveLength(0)
    expect(result.problems.filter((p) => /needs a Selling Price/i.test(p.message))).toHaveLength(2)
    expect(result.problems.some((p) => /no ingredient called/i.test(p.message))).toBe(true)
  })

  test('refuses a unit that does not match how the ingredient is measured', async () => {
    await seedMenu()
    const file = await sheetFile('Recipes', [
      RECIPE_HEADER,
      // Milk is a volume; grams is a mass.
      ['Caramel Macchiato', '16oz', 'Jersey Full Cream Milk 1L', 150, 'grams'],
    ])
    const result = (await parseMenu(file)).recipes
    expect(result.rows).toHaveLength(0)
    expect(result.problems[0]?.message).toMatch(/cannot be used in/i)
  })

  test('importing twice replaces the recipe rather than doubling it', async () => {
    await seedMenu()
    const rows = [RECIPE_HEADER, ['Caramel Macchiato', '16oz', 'Jersey Full Cream Milk 1L', 150, 'ml']]

    await applyMenu(await parseMenu(await sheetFile('R', rows)), 'USER-1')
    await applyMenu(await parseMenu(await sheetFile('R', rows)), 'USER-1')

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
    const result = (await parseMenu(file)).recipes
    expect(result.rows).toHaveLength(1)
    expect(result.problems).toEqual([])
  })
})

describe('reading the workbook', () => {
  test('problems carry the sheet name and the row number Excel shows', async () => {
    // Row 3 is genuinely empty, so the bad row is row 4 in Excel.
    const file = await sheetFile('Ingredients', [
      INGREDIENT_HEADER,
      ['Good One', '1L', 85, 1000, 'ml', ''],
      [],
      ['Bad Unit', '1 tub', 50, 10, 'scoops', ''],
    ])
    const result = (await parseMenu(file)).ingredients
    expect(result.problems).toEqual([
      { sheet: 'Ingredients', row: 4, message: expect.stringMatching(/not a unit/i) },
    ])
  })

  test('the unit column may come before the quantity column', async () => {
    const file = await sheetFile('Ingredients', [
      ['Ingredient Name', 'Purchase Unit', 'Total Cost (₱)', 'Total Quantity Unit', 'Total Quantity', 'Cost per Unit (AUTO)'],
      ['Fresh Milk', '1L', 85, 'ml', 1000, ''],
    ])
    const result = (await parseMenu(file)).ingredients
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
    const result = (await parseMenu(file)).ingredients
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

    const result = (await parseMenu(file)).ingredients
    expect(result.problems).toEqual([])
    expect(result.rows[0]?.name).toBe('Fresh Milk')
  })
})

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
})
