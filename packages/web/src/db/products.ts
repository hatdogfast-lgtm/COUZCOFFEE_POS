import {
  type AuditLog,
  type Category,
  type Money,
  type Product,
  type ProductVariant,
  type ServingUnit,
} from '@pos/shared'
import { db } from './database.ts'
import { commit, created, deleted, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * Adding and editing what the shop sells.
 *
 * A product carries one or more sizes, and price and recipe both hang off the
 * size rather than the product - a 16oz latte is a different drink to a 12oz
 * one in both respects. Something sold as-is, like a cookie, simply has one
 * size, which keeps food and drink on the same model instead of needing two.
 */

export interface VariantDraft {
  /** Present when editing an existing size. */
  id?: string
  name: string
  price: Money
  isDefault: boolean
}

export interface ProductDraft {
  name: string
  description: string
  categoryId: string
  sku: string
  taxable: boolean
  available: boolean
  modifierGroupIds: string[]
  variants: VariantDraft[]
}

export async function listCategories(): Promise<Category[]> {
  const rows = await db.categories.toArray()
  return rows
    .filter((row) => row.deletedAt === null && row.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createCategory(input: {
  name: string
  userId: string
}): Promise<Category> {
  const name = input.name.trim()
  if (name.length === 0) throw new Error('Give the category a name.')

  const existing = await listCategories()
  if (existing.some((entry) => entry.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error(`There is already a category called "${name}".`)
  }

  const category = stamp<Category>({
    name,
    colour: '#8C6F4A',
    icon: 'Tag',
    sortOrder: existing.length,
    active: true,
  })
  await commit([created('categories', category)])
  return category
}

function validate(draft: ProductDraft): void {
  if (draft.name.trim().length === 0) throw new Error('Give the item a name.')
  if (!draft.categoryId) throw new Error('Choose a category.')
  if (draft.variants.length === 0) throw new Error('Add at least one size and price.')

  for (const variant of draft.variants) {
    if (variant.name.trim().length === 0) throw new Error('Every size needs a name.')
    if (!Number.isFinite(variant.price) || variant.price < 0) {
      throw new Error(`"${variant.name}" needs a price.`)
    }
  }

  const names = draft.variants.map((entry) => entry.name.trim().toLowerCase())
  if (new Set(names).size !== names.length) throw new Error('Two sizes have the same name.')
}

/** Exactly one size is the default, whatever the caller ticked. */
function withOneDefault(variants: VariantDraft[]): VariantDraft[] {
  const chosen = variants.findIndex((entry) => entry.isDefault)
  const index = chosen === -1 ? 0 : chosen
  return variants.map((entry, position) => ({ ...entry, isDefault: position === index }))
}

export async function createProduct(input: {
  draft: ProductDraft
  userId: string
}): Promise<{ product: Product; variants: ProductVariant[] }> {
  validate(input.draft)

  const now = Date.now()
  const count = await db.products.count()
  const writes: PendingWrite[] = []

  const product = stamp<Product>({
    categoryId: input.draft.categoryId,
    name: input.draft.name.trim(),
    description: input.draft.description.trim(),
    sku: input.draft.sku.trim(),
    imageDataUrl: null,
    active: true,
    available: input.draft.available,
    sortOrder: count,
    taxable: input.draft.taxable,
    modifierGroupIds: input.draft.modifierGroupIds,
  })
  writes.push(created('products', product))

  const variants = withOneDefault(input.draft.variants).map((entry, index) =>
    stamp<ProductVariant>({
      productId: product.id,
      name: entry.name.trim(),
      price: entry.price,
      sortOrder: index,
      active: true,
      isDefault: entry.isDefault,
    }),
  )
  for (const variant of variants) writes.push(created('productVariants', variant))

  writes.push(
    created(
      'auditLogs',
      stamp<AuditLog>({
        entityType: 'products',
        entityId: product.id,
        action: 'PRODUCT_CREATED',
        userId: input.userId,
        before: null,
        after: JSON.stringify({ name: product.name, sizes: variants.length }),
        reason: '',
        occurredAt: now,
      }),
    ),
  )

  await commit(writes, now)
  return { product, variants }
}

export async function updateProduct(input: {
  product: Product
  draft: ProductDraft
  userId: string
}): Promise<void> {
  validate(input.draft)

  const now = Date.now()
  const writes: PendingWrite[] = []

  writes.push(
    updated(
      'products',
      revise(
        input.product,
        {
          name: input.draft.name.trim(),
          description: input.draft.description.trim(),
          categoryId: input.draft.categoryId,
          sku: input.draft.sku.trim(),
          taxable: input.draft.taxable,
          available: input.draft.available,
          modifierGroupIds: input.draft.modifierGroupIds,
        },
        now,
      ),
    ),
  )

  const current = (await db.productVariants.where('productId').equals(input.product.id).toArray()).filter(
    (row) => row.deletedAt === null,
  )
  const wanted = withOneDefault(input.draft.variants)
  const keep = new Set(wanted.map((entry) => entry.id).filter(Boolean))

  wanted.forEach((entry, index) => {
    const existing = entry.id ? current.find((row) => row.id === entry.id) : undefined
    if (existing) {
      const changed =
        existing.name !== entry.name.trim() ||
        existing.price !== entry.price ||
        existing.isDefault !== entry.isDefault ||
        existing.sortOrder !== index
      if (changed) {
        writes.push(
          updated(
            'productVariants',
            revise(
              existing,
              { name: entry.name.trim(), price: entry.price, isDefault: entry.isDefault, sortOrder: index },
              now,
            ),
          ),
        )
      }
      return
    }
    writes.push(
      created(
        'productVariants',
        stamp<ProductVariant>({
          productId: input.product.id,
          name: entry.name.trim(),
          price: entry.price,
          sortOrder: index,
          active: true,
          isDefault: entry.isDefault,
        }),
      ),
    )
  })

  // A size that has been taken away is tombstoned, so the removal can travel.
  // Its recipe is left alone: nothing is gained by destroying it, and a size
  // brought back should not have to be built again from scratch.
  for (const existing of current) {
    if (keep.has(existing.id)) continue
    writes.push(deleted('productVariants', revise(existing, { deletedAt: now }, now)))
  }

  writes.push(
    created(
      'auditLogs',
      stamp<AuditLog>({
        entityType: 'products',
        entityId: input.product.id,
        action: 'PRODUCT_UPDATED',
        userId: input.userId,
        before: JSON.stringify({ name: input.product.name }),
        after: JSON.stringify({ name: input.draft.name.trim(), sizes: wanted.length }),
        reason: '',
        occurredAt: now,
      }),
    ),
  )

  await commit(writes, now)
}

/** Take something off the menu without losing the sales that reference it. */
export async function archiveProduct(input: { product: Product; userId: string }): Promise<void> {
  const now = Date.now()
  await commit(
    [
      updated('products', revise(input.product, { active: false }, now)),
      created(
        'auditLogs',
        stamp<AuditLog>({
          entityType: 'products',
          entityId: input.product.id,
          action: 'PRODUCT_ARCHIVED',
          userId: input.userId,
          before: JSON.stringify({ active: true }),
          after: JSON.stringify({ active: false }),
          reason: '',
          occurredAt: now,
        }),
      ),
    ],
    now,
  )
}

export async function loadProductDraft(product: Product): Promise<ProductDraft> {
  const variants = (await db.productVariants.where('productId').equals(product.id).toArray())
    .filter((row) => row.deletedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return {
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    sku: product.sku,
    taxable: product.taxable,
    available: product.available,
    modifierGroupIds: product.modifierGroupIds ?? [],
    variants: variants.map((entry) => ({
      id: entry.id,
      name: entry.name,
      price: entry.price,
      isDefault: entry.isDefault,
    })),
  }
}

/** A sensible starting point: one size, priced later. */
export function emptyDraft(categoryId: string): ProductDraft {
  return {
    name: '',
    description: '',
    categoryId,
    sku: '',
    taxable: true,
    available: true,
    modifierGroupIds: [],
    variants: [{ name: 'Regular', price: 0, isDefault: true }],
  }
}

/**
 * Say whether a category is served in a cup or by the piece.
 *
 * Kept on the category rather than on each product so a new drink is counted
 * correctly the moment it is filed, without anyone having to remember.
 */
export async function setServingUnit(input: {
  category: Category
  servingUnit: ServingUnit
  userId: string
}): Promise<Category> {
  const now = Date.now()
  const revised = revise<Category>(input.category, { servingUnit: input.servingUnit }, now)

  await commit(
    [
      updated('categories', revised),
      created(
        'auditLogs',
        stamp<AuditLog>(
          {
            entityType: 'categories',
            entityId: input.category.id,
            action: 'CATEGORY_SERVING_UNIT_CHANGED',
            userId: input.userId,
            before: JSON.stringify({ servingUnit: input.category.servingUnit ?? 'CUP' }),
            after: JSON.stringify({ servingUnit: input.servingUnit }),
            reason: `${input.category.name} counted as ${input.servingUnit === 'PIECE' ? 'pieces' : 'cups'}`,
            occurredAt: now,
          },
          now,
        ),
      ),
    ],
    now,
  )
  return revised
}
