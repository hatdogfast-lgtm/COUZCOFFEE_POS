import {
  DEFAULT_LOW_STOCK,
  DEFAULT_LOYALTY,
  DEFAULT_STATUTORY_RULES,
  RECEIPT_SECTIONS,
  costRateFromPurchase,
  fromDecimal,
  hashPin,
  newId,
  toBase,
  type Category,
  type Ingredient,
  type ModifierGroup,
  type ModifierOption,
  type Product,
  type ProductVariant,
  type Recipe,
  type RecipeIngredient,
  type Role,
  type Unit,
  type Dimension,
  type ServingUnit,
  type StockClass,
  type BusinessSettings,
  type InventoryMovement,
  type User,
} from '@pos/shared'
import brand from '../../brand.config.json'
import { db, META_KEYS, readMeta, writeMeta } from './database.ts'
import { commit, created, stamp } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * First-run setup.
 *
 * The business name, the owner and the owner's PIN all come from the person
 * setting the till up. Nothing here ships a default login, because a POS with
 * a known factory PIN is a POS anyone can open the drawer on.
 *
 * The starter menu is a convenience, not a commitment: it can be declined, and
 * everything in it is ordinary editable data.
 */

export function defaultSettings(businessName: string): BusinessSettings {
  return stamp<BusinessSettings>({
    branding: {
      businessName,
      legalName: businessName,
      tagline: brand.tagline,
      logoDataUrl: null,
      address: '',
      contactNumber: '',
      email: '',
      socialLinks: '',
      taxId: '',
      receiptFooter: 'Thank you. Please come again.',
      primaryColor: '#7A4A2C',
      secondaryColor: '#C18A4A',
      accentColor: '#168054',
      theme: 'system',
    },
    tax: { enabled: true, label: 'VAT', rate: 12, inclusive: true },
    receipt: {
      prefix: 'OR',
      nextNumber: 1,
      padding: 6,
      // Browser printing is the one default that is never wrong: it works with
      // whatever printer the device already knows about, and it is the only
      // route available on iOS. A shop with a Bluetooth printer picks it up in
      // Settings once, and 58mm is what the cheap rolls are.
      paperWidth: 58,
      printRoute: 'BROWSER',
      autoPrint: false,
      openDrawerOnCash: false,
    },
    queue: { prefix: '', padding: 3, resetDaily: true, start: 1 },
    currencyCode: 'PHP',
    currencySymbol: '₱',
    locale: 'en-PH',
    statutoryDiscountRate: 20,
    statutoryRules: DEFAULT_STATUTORY_RULES,
    receiptSections: RECEIPT_SECTIONS,
    lowStock: DEFAULT_LOW_STOCK,
    loyalty: DEFAULT_LOYALTY,
    lowStockWarningEnabled: true,
    blockSaleWhenOutOfStock: true,
    // Off until a shop asks for it: a cost that appears unbidden makes every
    // margin look wrong.
    includeLabourInCost: false,
    // Off until a shop asks for it: backdating rewrites the books.
    backdatingEnabled: false,
    // A GCash payment with no reference cannot be matched against the wallet
    // statement, which is exactly when it matters.
    requireReferenceFor: ['GCASH'],
    plannerPasscodeHash: null,
    dashboardTiles: {},
  })
}

export async function createOwner(name: string, pin: string): Promise<User> {
  const pinHash = await hashPin(pin)
  const owner = stamp<User>({
    name,
    role: 'OWNER' as Role,
    pinHash,
    active: true,
    employeeCode: 'OWNER',
    failedAttempts: 0,
    lockedUntil: null,
    permissionOverrides: {},
  })
  await commit([created('users', owner)])
  return owner
}

export async function createStaff(name: string, role: Role, pin: string, code: string): Promise<User> {
  const user = stamp<User>({
    name,
    role,
    pinHash: await hashPin(pin),
    active: true,
    employeeCode: code,
    failedAttempts: 0,
    lockedUntil: null,
    permissionOverrides: {},
  })
  await commit([created('users', user)])
  return user
}

// ------------------------------------------------------------ starter menu --

interface IngredientSpec {
  key: string
  name: string
  stockClass: StockClass
  dimension: Dimension
  displayUnit: Unit
  /** What a purchase costs, and how much of it that buys. */
  purchaseCost: number
  purchaseQty: number
  purchaseUnit: Unit
  openingQty: number
  openingUnit: Unit
  lowStock: number
}

const INGREDIENTS: IngredientSpec[] = [
  { key: 'beans', name: 'Espresso Beans', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'kg', purchaseCost: 85000, purchaseQty: 1, purchaseUnit: 'kg', openingQty: 5, openingUnit: 'kg', lowStock: 500 },
  { key: 'milk', name: 'Fresh Milk', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'L', purchaseCost: 9500, purchaseQty: 1, purchaseUnit: 'L', openingQty: 20, openingUnit: 'L', lowStock: 3000 },
  { key: 'oat', name: 'Oat Milk', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'L', purchaseCost: 18500, purchaseQty: 1, purchaseUnit: 'L', openingQty: 6, openingUnit: 'L', lowStock: 1000 },
  { key: 'almond', name: 'Almond Milk', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'L', purchaseCost: 17500, purchaseQty: 1, purchaseUnit: 'L', openingQty: 4, openingUnit: 'L', lowStock: 1000 },
  { key: 'soy', name: 'Soy Milk', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'L', purchaseCost: 14500, purchaseQty: 1, purchaseUnit: 'L', openingQty: 4, openingUnit: 'L', lowStock: 1000 },
  { key: 'caramel', name: 'Caramel Syrup', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'ml', purchaseCost: 32000, purchaseQty: 750, purchaseUnit: 'ml', openingQty: 2250, openingUnit: 'ml', lowStock: 300 },
  { key: 'vanilla', name: 'Vanilla Syrup', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'ml', purchaseCost: 30000, purchaseQty: 750, purchaseUnit: 'ml', openingQty: 1500, openingUnit: 'ml', lowStock: 300 },
  { key: 'hazelnut', name: 'Hazelnut Syrup', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'ml', purchaseCost: 30000, purchaseQty: 750, purchaseUnit: 'ml', openingQty: 750, openingUnit: 'ml', lowStock: 300 },
  { key: 'chocolate', name: 'Chocolate Powder', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'kg', purchaseCost: 42000, purchaseQty: 1, purchaseUnit: 'kg', openingQty: 2, openingUnit: 'kg', lowStock: 300 },
  { key: 'matcha', name: 'Matcha Powder', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'g', purchaseCost: 68000, purchaseQty: 500, purchaseUnit: 'g', openingQty: 1000, openingUnit: 'g', lowStock: 150 },
  { key: 'sugar', name: 'Sugar Syrup', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'ml', purchaseCost: 12000, purchaseQty: 1, purchaseUnit: 'L', openingQty: 3, openingUnit: 'L', lowStock: 500 },
  { key: 'ice', name: 'Ice', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'kg', purchaseCost: 6000, purchaseQty: 10, purchaseUnit: 'kg', openingQty: 40, openingUnit: 'kg', lowStock: 5000 },
  { key: 'cup12', name: 'Cup 12oz', stockClass: 'PACKAGING', dimension: 'COUNT', displayUnit: 'pcs', purchaseCost: 32000, purchaseQty: 100, purchaseUnit: 'pcs', openingQty: 400, openingUnit: 'pcs', lowStock: 50 },
  { key: 'cup16', name: 'Cup 16oz', stockClass: 'PACKAGING', dimension: 'COUNT', displayUnit: 'pcs', purchaseCost: 38000, purchaseQty: 100, purchaseUnit: 'pcs', openingQty: 500, openingUnit: 'pcs', lowStock: 50 },
  { key: 'cup22', name: 'Cup 22oz', stockClass: 'PACKAGING', dimension: 'COUNT', displayUnit: 'pcs', purchaseCost: 45000, purchaseQty: 100, purchaseUnit: 'pcs', openingQty: 300, openingUnit: 'pcs', lowStock: 50 },
  { key: 'lid', name: 'Lid', stockClass: 'PACKAGING', dimension: 'COUNT', displayUnit: 'pcs', purchaseCost: 15000, purchaseQty: 100, purchaseUnit: 'pcs', openingQty: 1000, openingUnit: 'pcs', lowStock: 100 },
  { key: 'straw', name: 'Straw', stockClass: 'PACKAGING', dimension: 'COUNT', displayUnit: 'pcs', purchaseCost: 8000, purchaseQty: 100, purchaseUnit: 'pcs', openingQty: 800, openingUnit: 'pcs', lowStock: 100 },
  { key: 'croissant', name: 'Butter Croissant', stockClass: 'RETAIL', dimension: 'COUNT', displayUnit: 'pcs', purchaseCost: 4500, purchaseQty: 1, purchaseUnit: 'pcs', openingQty: 24, openingUnit: 'pcs', lowStock: 5 },
  { key: 'cookie', name: 'Chocolate Chip Cookie', stockClass: 'RETAIL', dimension: 'COUNT', displayUnit: 'pcs', purchaseCost: 2500, purchaseQty: 1, purchaseUnit: 'pcs', openingQty: 30, openingUnit: 'pcs', lowStock: 6 },
  { key: 'banana_bread', name: 'Banana Bread Slice', stockClass: 'RETAIL', dimension: 'COUNT', displayUnit: 'pcs', purchaseCost: 3800, purchaseQty: 1, purchaseUnit: 'pcs', openingQty: 20, openingUnit: 'pcs', lowStock: 4 },
]

interface ProductSpec {
  key: string
  category: string
  name: string
  description: string
  /** Size name -> selling price in major units. */
  sizes: Array<[string, number]>
  /** Size name -> recipe, as ingredient key and quantity in the given unit. */
  recipe?: Record<string, Array<[string, number, Unit]>>
  modifiers?: string[]
}

const PRODUCTS: ProductSpec[] = [
  {
    key: 'espresso', category: 'hot', name: 'Espresso', description: 'Double shot, served short.',
    sizes: [['Solo', 90], ['Doppio', 120]],
    recipe: {
      Solo: [['beans', 9, 'g'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
      Doppio: [['beans', 18, 'g'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
    },
  },
  {
    key: 'americano', category: 'hot', name: 'Americano', description: 'Espresso lengthened with hot water.',
    sizes: [['12oz', 110], ['16oz', 130]],
    recipe: {
      '12oz': [['beans', 18, 'g'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
      '16oz': [['beans', 21, 'g'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs']],
    },
    modifiers: [],
  },
  {
    key: 'latte', category: 'hot', name: 'Cafe Latte', description: 'Espresso with steamed milk.',
    sizes: [['12oz', 140], ['16oz', 160]],
    recipe: {
      '12oz': [['beans', 18, 'g'], ['milk', 180, 'ml'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
      '16oz': [['beans', 18, 'g'], ['milk', 260, 'ml'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs']],
    },
    modifiers: ['milk', 'addons'],
  },
  {
    key: 'cappuccino', category: 'hot', name: 'Cappuccino', description: 'Equal parts espresso, milk and foam.',
    sizes: [['12oz', 140], ['16oz', 160]],
    recipe: {
      '12oz': [['beans', 18, 'g'], ['milk', 150, 'ml'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
      '16oz': [['beans', 18, 'g'], ['milk', 220, 'ml'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs']],
    },
    modifiers: ['milk', 'addons'],
  },
  {
    key: 'caramel_macchiato', category: 'hot', name: 'Caramel Macchiato', description: 'Vanilla, milk, espresso and caramel.',
    sizes: [['12oz', 165], ['16oz', 185]],
    recipe: {
      '12oz': [['beans', 18, 'g'], ['milk', 180, 'ml'], ['vanilla', 10, 'ml'], ['caramel', 15, 'ml'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
      '16oz': [['beans', 18, 'g'], ['milk', 260, 'ml'], ['vanilla', 15, 'ml'], ['caramel', 20, 'ml'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs']],
    },
    modifiers: ['milk', 'addons'],
  },
  {
    key: 'mocha', category: 'hot', name: 'Cafe Mocha', description: 'Espresso, chocolate and steamed milk.',
    sizes: [['12oz', 170], ['16oz', 190]],
    recipe: {
      '12oz': [['beans', 18, 'g'], ['milk', 170, 'ml'], ['chocolate', 20, 'g'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
      '16oz': [['beans', 18, 'g'], ['milk', 250, 'ml'], ['chocolate', 28, 'g'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs']],
    },
    modifiers: ['milk', 'addons'],
  },
  {
    key: 'iced_americano', category: 'iced', name: 'Iced Americano', description: 'Espresso over ice.',
    sizes: [['16oz', 140], ['22oz', 165]],
    recipe: {
      '16oz': [['beans', 18, 'g'], ['ice', 180, 'g'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs'], ['straw', 1, 'pcs']],
      '22oz': [['beans', 24, 'g'], ['ice', 260, 'g'], ['cup22', 1, 'pcs'], ['lid', 1, 'pcs'], ['straw', 1, 'pcs']],
    },
    modifiers: [],
  },
  {
    key: 'iced_latte', category: 'iced', name: 'Iced Latte', description: 'Espresso, cold milk and ice.',
    sizes: [['16oz', 165], ['22oz', 190]],
    recipe: {
      '16oz': [['beans', 18, 'g'], ['milk', 200, 'ml'], ['ice', 150, 'g'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs'], ['straw', 1, 'pcs']],
      '22oz': [['beans', 24, 'g'], ['milk', 280, 'ml'], ['ice', 220, 'g'], ['cup22', 1, 'pcs'], ['lid', 1, 'pcs'], ['straw', 1, 'pcs']],
    },
    modifiers: ['milk', 'addons'],
  },
  {
    key: 'iced_caramel', category: 'iced', name: 'Iced Caramel Macchiato', description: 'Layered vanilla, milk, espresso and caramel.',
    sizes: [['16oz', 185], ['22oz', 210]],
    recipe: {
      '16oz': [['beans', 18, 'g'], ['milk', 190, 'ml'], ['vanilla', 15, 'ml'], ['caramel', 20, 'ml'], ['ice', 150, 'g'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs'], ['straw', 1, 'pcs']],
      '22oz': [['beans', 24, 'g'], ['milk', 270, 'ml'], ['vanilla', 20, 'ml'], ['caramel', 25, 'ml'], ['ice', 220, 'g'], ['cup22', 1, 'pcs'], ['lid', 1, 'pcs'], ['straw', 1, 'pcs']],
    },
    modifiers: ['milk', 'addons'],
  },
  {
    key: 'matcha_latte', category: 'noncoffee', name: 'Matcha Latte', description: 'Ceremonial matcha with milk.',
    sizes: [['12oz', 165], ['16oz', 185]],
    recipe: {
      '12oz': [['matcha', 6, 'g'], ['milk', 200, 'ml'], ['sugar', 15, 'ml'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
      '16oz': [['matcha', 8, 'g'], ['milk', 280, 'ml'], ['sugar', 20, 'ml'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs']],
    },
    modifiers: ['milk'],
  },
  {
    key: 'hot_chocolate', category: 'noncoffee', name: 'Hot Chocolate', description: 'Rich chocolate with steamed milk.',
    sizes: [['12oz', 150], ['16oz', 170]],
    recipe: {
      '12oz': [['chocolate', 28, 'g'], ['milk', 220, 'ml'], ['cup12', 1, 'pcs'], ['lid', 1, 'pcs']],
      '16oz': [['chocolate', 36, 'g'], ['milk', 300, 'ml'], ['cup16', 1, 'pcs'], ['lid', 1, 'pcs']],
    },
    modifiers: ['milk'],
  },
  {
    key: 'croissant', category: 'pastries', name: 'Butter Croissant', description: 'Baked fresh each morning.',
    sizes: [['Regular', 95]],
    recipe: { Regular: [['croissant', 1, 'pcs']] },
  },
  {
    key: 'banana_bread', category: 'pastries', name: 'Banana Bread', description: 'Thick-cut slice.',
    sizes: [['Slice', 85]],
    recipe: { Slice: [['banana_bread', 1, 'pcs']] },
  },
  {
    key: 'cookie', category: 'snacks', name: 'Chocolate Chip Cookie', description: 'Soft-baked, sea salt finish.',
    sizes: [['Regular', 65]],
    recipe: { Regular: [['cookie', 1, 'pcs']] },
  },
]

const CATEGORIES: Array<{
  key: string
  name: string
  colour: string
  icon: string
  /** Drinks are counted in cups; food is counted by the piece. */
  servingUnit: ServingUnit
}> = [
  { key: 'hot', name: 'Hot Espresso', colour: '#8C4A2F', icon: 'Coffee', servingUnit: 'CUP' },
  { key: 'iced', name: 'Iced Espresso', colour: '#2F6F8C', icon: 'CupSoda', servingUnit: 'CUP' },
  { key: 'noncoffee', name: 'Non-Coffee', colour: '#4A8C5A', icon: 'Leaf', servingUnit: 'CUP' },
  { key: 'pastries', name: 'Pastries', colour: '#B5893C', icon: 'Croissant', servingUnit: 'PIECE' },
  { key: 'snacks', name: 'Snacks', colour: '#8C6F4A', icon: 'Cookie', servingUnit: 'PIECE' },
]

/**
 * Install the starter catalogue.
 *
 * Every write goes through the outbox like any other, so a shop that sets up
 * offline will push its whole menu the first time it reaches a server.
 */
export async function seedCatalogue(): Promise<void> {
  const already = await readMeta<boolean>(META_KEYS.seeded, false)
  if (already) return

  const writes: PendingWrite[] = []
  const now = Date.now()

  // Ingredients, priced from a realistic purchase quantity.
  const ingredientIds = new Map<string, string>()
  for (const spec of INGREDIENTS) {
    const ingredient = stamp<Ingredient>({
      name: spec.name,
      sku: spec.key.toUpperCase(),
      stockClass: spec.stockClass,
      dimension: spec.dimension,
      displayUnit: spec.displayUnit,
      costRate: costRateFromPurchase(spec.purchaseCost, spec.purchaseQty, spec.purchaseUnit),
      supplierId: null,
      lowStockThresholdBase: spec.lowStock,
      trackStock: true,
      active: true,
    })
    ingredientIds.set(spec.key, ingredient.id)
    writes.push(created('ingredients', ingredient))

    // Opening stock is a movement like any other, so the ledger is complete
    // from the very first row rather than starting from an unexplained number.
    writes.push(
      created(
        'inventoryMovements',
        stamp<InventoryMovement>({
          ingredientId: ingredient.id,
          type: 'OPENING',
          baseQuantity: toBase(spec.openingQty, spec.openingUnit),
          costRate: ingredient.costRate,
          reason: 'Opening stock',
          referenceType: null,
          referenceId: null,
          shiftId: null,
          userId: 'SETUP',
          occurredAt: now,
        }),
      ),
    )
  }

  // Modifier groups.
  const groupIds = new Map<string, string>()

  const milkGroup = stamp<ModifierGroup>({
    name: 'Milk', selection: 'SINGLE', required: false, minSelections: 0, maxSelections: 1, sortOrder: 1, active: true,
  })
  groupIds.set('milk', milkGroup.id)
  writes.push(created('modifierGroups', milkGroup))

  const milkOptions: Array<[string, number, string | null, number]> = [
    ['Whole Milk', 0, null, 0],
    ['Oat Milk', 3000, 'oat', 0],
    ['Almond Milk', 3000, 'almond', 0],
    ['Soy Milk', 2500, 'soy', 0],
  ]
  milkOptions.forEach(([name, delta, swapKey], index) => {
    const ingredientId = swapKey ? ingredientIds.get(swapKey) : null
    writes.push(
      created(
        'modifierOptions',
        stamp<ModifierOption>({
          groupId: milkGroup.id,
          name,
          priceDelta: delta,
          sortOrder: index,
          active: true,
          isDefault: index === 0,
          // An alternative milk draws on its own stock. The recipe's dairy is
          // still deducted; refining that swap is a recipe-editor concern.
          consumption: ingredientId ? [{ ingredientId, baseQuantity: 30 }] : [],
        }),
      ),
    )
  })

  const addonGroup = stamp<ModifierGroup>({
    name: 'Add-ons', selection: 'MULTI', required: false, minSelections: 0, maxSelections: 5, sortOrder: 3, active: true,
  })
  groupIds.set('addons', addonGroup.id)
  writes.push(created('modifierGroups', addonGroup))

  const addons: Array<[string, number, string, number]> = [
    ['Extra Espresso Shot', 4000, 'beans', 18],
    ['Caramel Syrup', 2500, 'caramel', 15],
    ['Vanilla Syrup', 2500, 'vanilla', 15],
    ['Hazelnut Syrup', 2500, 'hazelnut', 15],
  ]
  addons.forEach(([name, delta, key, quantity], index) => {
    const ingredientId = ingredientIds.get(key)
    writes.push(
      created(
        'modifierOptions',
        stamp<ModifierOption>({
          groupId: addonGroup.id,
          name,
          priceDelta: delta,
          sortOrder: index,
          active: true,
          isDefault: false,
          consumption: ingredientId ? [{ ingredientId, baseQuantity: quantity }] : [],
        }),
      ),
    )
  })

  // Categories.
  const categoryIds = new Map<string, string>()
  CATEGORIES.forEach((spec, index) => {
    const category = stamp<Category>({
      name: spec.name,
      colour: spec.colour,
      icon: spec.icon,
      servingUnit: spec.servingUnit,
      sortOrder: index,
      active: true,
    })
    categoryIds.set(spec.key, category.id)
    writes.push(created('categories', category))
  })

  // Products, their sizes, and the recipe behind each size.
  PRODUCTS.forEach((spec, productIndex) => {
    const categoryId = categoryIds.get(spec.category)
    if (!categoryId) return

    const product = stamp<Product>({
      categoryId,
      name: spec.name,
      description: spec.description,
      sku: spec.key.toUpperCase(),
      imageDataUrl: null,
      active: true,
      available: true,
      sortOrder: productIndex,
      taxable: true,
      modifierGroupIds: (spec.modifiers ?? []).map((key) => groupIds.get(key) ?? '').filter(Boolean),
    })
    writes.push(created('products', product))

    spec.sizes.forEach(([sizeName, price], sizeIndex) => {
      const variant = stamp<ProductVariant>({
        productId: product.id,
        name: sizeName,
        price: fromDecimal(price),
        sortOrder: sizeIndex,
        active: true,
        isDefault: sizeIndex === 0,
      })
      writes.push(created('productVariants', variant))

      const components = spec.recipe?.[sizeName]
      if (!components) return

      const recipe = stamp<Recipe>({
        variantId: variant.id, productId: product.id, yieldQuantity: 1, notes: '', active: true,
      })
      writes.push(created('recipes', recipe))

      components.forEach(([key, quantity, unit], order) => {
        const ingredientId = ingredientIds.get(key)
        if (!ingredientId) return
        writes.push(
          created(
            'recipeIngredients',
            stamp<RecipeIngredient>({
              recipeId: recipe.id,
              ingredientId,
              baseQuantity: toBase(quantity, unit),
              optional: false,
              sortOrder: order,
            }),
          ),
        )
      })
    })
  })

  await commit(writes, now)
  await writeMeta(META_KEYS.seeded, true)
}

/** Complete first-run setup: settings, owner, and optionally the demo menu. */
export async function completeSetup(input: {
  businessName: string
  ownerName: string
  pin: string
  includeStarterMenu: boolean
}): Promise<void> {
  const settings = defaultSettings(input.businessName.trim() || brand.businessName)
  await commit([created('settings', settings)])
  await createOwner(input.ownerName.trim() || 'Owner', input.pin)
  if (input.includeStarterMenu) {
    await seedCatalogue()
  } else {
    await writeMeta(META_KEYS.seeded, true)
  }
}

export async function isSetUp(): Promise<boolean> {
  const [settingsCount, userCount] = await Promise.all([db.settings.count(), db.users.count()])
  return settingsCount > 0 && userCount > 0
}

/** Used by the setup screen to show what the starter menu would install. */
export const STARTER_SUMMARY = {
  categories: CATEGORIES.length,
  products: PRODUCTS.length,
  variants: PRODUCTS.reduce((sum, spec) => sum + spec.sizes.length, 0),
  ingredients: INGREDIENTS.length,
}

export function unusedIdForTests(): string {
  return newId()
}
