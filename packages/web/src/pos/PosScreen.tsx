import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import {
  BadgePercent,
  ClipboardCheck,
  Gift,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react'
import {
  lowStockOf,
  type BusinessSettings,
  type OrderTotals,
  type OrderTypeEntry,
  type Product,
  type Sale,
} from '@pos/shared'
import { db } from '../db/database.ts'
import { availabilityOf, loadMenu, stockLevels, type MenuData, type StockMap } from '../db/repo.ts'
import { Badge, Button, EmptyState } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings, useSyncStatus } from '../app/providers.tsx'
import { useCart } from './useCart.ts'
import {
  claimedValue,
  completeSale,
  loyaltyDiscount,
  totalsFor,
  type CartLine,
  type TenderInput,
} from './checkout.ts'
import { usageRates } from '../db/lowStock.ts'
import { listOrderTypes } from '../db/shopLists.ts'
import { ensureShift } from './shift.ts'
import { EndOfShiftSheet } from './EndOfShiftSheet.tsx'
import { ProductSheet } from './ProductSheet.tsx'
import { PaymentSheet } from './PaymentSheet.tsx'
import { DiscountSheet } from './DiscountSheet.tsx'
import { ReceiptSheet } from './ReceiptSheet.tsx'
import { LumpSumEntry, OrderTiming, yesterdayAtSameTime, type TimingChoice } from './OrderEntryPanels.tsx'
import { countLines, tillPolicy } from '../db/till.ts'
import { cn } from '../lib/utils.ts'

/**
 * The till.
 *
 * Everything on this screen reads from the device's own database, so it
 * behaves the same whether or not there is a connection. The only thing the
 * network changes is the small indicator in the corner.
 */
export function PosScreen() {
  const money = useMoney()
  const { settings } = useSettings()
  const { user, can } = useSession()

  // Backdating is both a shop-wide switch and a permission: the shop decides
  // whether the feature exists at all, and the roles decide who may use it.
  const mayBackdate = tillPolicy(settings).backdatingEnabled && can('pos.backdate')
  const status = useSyncStatus()
  const cart = useCart()

  const [categoryId, setCategoryId] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [showDiscount, setShowDiscount] = useState(false)
  const [showCartOnMobile, setShowCartOnMobile] = useState(false)
  const [timing, setTiming] = useState<TimingChoice>('NOW')
  const [customAt, setCustomAt] = useState(() => yesterdayAtSameTime())
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<{
    sale: Sale
    totals: OrderTotals
    lines: CartLine[]
    payments: TenderInput[]
    change: number
  } | null>(null)

  // The menu and the stock ledger both re-read whenever their tables change,
  // including when a change arrives from another device via sync.
  const menu = useLiveQuery(
    () =>
      db
        .transaction('r', [db.categories, db.products, db.productVariants, db.modifierGroups, db.modifierOptions, db.recipes, db.recipeIngredients, db.ingredients], () =>
          loadMenu(),
        ),
    [],
  )
  const stock = useLiveQuery(() => stockLevels(), [], new Map() as StockMap)

  // How fast each ingredient is going, so "low" can mean "about to run out"
  // rather than a number somebody typed in months ago. Read once for the
  // screen: it is the same answer for every tile on it.
  const rates = useLiveQuery(
    () => usageRates(lowStockOf(settings ?? {}).lookbackDays),
    [settings?.lowStock?.lookbackDays],
    new Map<string, number>(),
  )
  const lowStock = { settings, rates }

  const products = useMemo(() => {
    if (!menu) return []
    const term = search.trim().toLowerCase()
    return menu.products.filter((product) => {
      if (categoryId !== 'all' && product.categoryId !== categoryId) return false
      if (!term) return true
      return (
        product.name.toLowerCase().includes(term) ||
        product.description.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term)
      )
    })
  }, [menu, categoryId, search])

  /**
   * Lines marked as a loyalty claim are given away.
   *
   * They stay in the order at menu price so the receipt shows what they were
   * worth, and a matching discount takes that value straight back off. Their
   * stock and cost are untouched - the drink is still made.
   */
  const loyaltyValue = useMemo(
    () => cart.cart.lines.reduce((sum, line) => sum + claimedValue(line), 0),
    [cart.cart.lines],
  )

  const effectiveDiscounts = useMemo(
    () => (loyaltyValue > 0 ? [...cart.cart.discounts, loyaltyDiscount(loyaltyValue)] : cart.cart.discounts),
    [cart.cart.discounts, loyaltyValue],
  )

  const totals = useMemo(
    () => (settings ? totalsFor(cart.cart.lines, effectiveDiscounts, settings) : null),
    [cart.cart.lines, effectiveDiscounts, settings],
  )

  const occurredAt =
    timing === 'NOW' ? undefined : timing === 'YESTERDAY' ? yesterdayAtSameTime() : customAt

  async function handlePayment(payments: TenderInput[]): Promise<void> {
    if (!settings || !user || !menu || !totals) return
    setBusy(true)
    try {
      const shift = await ensureShift(user)

      // The claim was already decided line by line, and is carried in
      // `effectiveDiscounts`. Nothing about the payment method changes it.
      const result = await completeSale({
        lines: cart.cart.lines,
        discounts: effectiveDiscounts,
        payments,
        settings,
        cashier: user,
        shiftId: shift.id,
        orderType: cart.cart.orderType,
        customerName: cart.cart.customerName,
        note: cart.cart.note,
        menu,
        online: status.online,
        occurredAt,
      })

      setReceipt({
        sale: result.sale,
        totals: result.totals,
        lines: cart.cart.lines,
        payments,
        change: result.changeDue,
      })
      setShowPayment(false)
      setShowCartOnMobile(false)
      cart.clear()
      setTiming('NOW')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The sale could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  if (!menu || !settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading the menu…</div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex min-h-0 flex-1">
        {/* Menu */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="space-y-3 border-b border-line bg-surface px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search the menu"
                className="h-11 w-full rounded-xl border border-line bg-canvas pl-10 pr-9 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-subtle hover:bg-surface-sunken"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="scroll-pane -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
              <CategoryChip active={categoryId === 'all'} onClick={() => setCategoryId('all')}>
                All
              </CategoryChip>
              {menu.categories.map((category) => (
                <CategoryChip
                  key={category.id}
                  active={categoryId === category.id}
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </CategoryChip>
              ))}
            </div>
          </div>

          <div className="scroll-pane flex-1 px-4 py-4 pb-28 sm:pb-4">
            {products.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag className="h-8 w-8" aria-hidden="true" />}
                title={search ? 'Nothing matches that search' : 'No products in this category'}
                description={
                  search ? 'Try a different word, or clear the search.' : 'Add products from the menu settings.'
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => (
                  <ProductTile
                    key={product.id}
                    product={product}
                    menu={menu}
                    stock={stock ?? new Map()}
                    lowStock={lowStock}
                    inCart={0}
                    onSelect={() => setActiveProduct(product)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Order panel: a sidebar on a counter screen, a sheet on a phone. */}
        <aside
          className={cn(
            'w-[22rem] shrink-0 border-l border-line bg-surface',
            'hidden lg:flex lg:flex-col',
          )}
        >
          <CartPanel
            cart={cart}
            totals={totals}
            mayBackdate={mayBackdate}
            onCheckout={() => setShowPayment(true)}
            onDiscount={() => setShowDiscount(true)}
            canDiscount={can('pos.discount.standard')}
            timing={timing}
            customAt={customAt}
            onTiming={setTiming}
            onCustomAt={setCustomAt}
          />
        </aside>
      </div>

      {/* Mobile order bar */}
      {!cart.isEmpty ? (
        <div className="border-t border-line bg-surface px-4 py-3 pad-safe-bottom lg:hidden">
          <Button size="lg" full onClick={() => setShowCartOnMobile(true)}>
            <span className="flex flex-1 items-center gap-2">
              <span className="tabular flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-ink/20 px-1.5 text-xs font-semibold">
                {cart.itemCount}
              </span>
              View order
            </span>
            <span className="tabular font-semibold">{money(totals?.total ?? 0)}</span>
          </Button>
        </div>
      ) : null}

      {showCartOnMobile ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface pad-safe-top lg:hidden animate-slide-up">
          {/* The panel carries its own heading, so the overlay adds only a way
              out of it - two "Current order" titles was one too many. */}
          <CartPanel
            cart={cart}
            totals={totals}
            mayBackdate={mayBackdate}
            onCheckout={() => setShowPayment(true)}
            onDiscount={() => setShowDiscount(true)}
            canDiscount={can('pos.discount.standard')}
            timing={timing}
            customAt={customAt}
            onTiming={setTiming}
            onCustomAt={setCustomAt}
            onClose={() => setShowCartOnMobile(false)}
          />
        </div>
      ) : null}

      <ProductSheet
        product={activeProduct}
        menu={menu}
        stock={stock ?? new Map()}
        open={activeProduct !== null}
        onClose={() => setActiveProduct(null)}
        onAdd={cart.add}
      />

      {totals ? (
        <PaymentSheet
          open={showPayment}
          totals={totals}
          busy={busy}
          onClose={() => setShowPayment(false)}
          onConfirm={handlePayment}
        />
      ) : null}

      <DiscountSheet open={showDiscount} onClose={() => setShowDiscount(false)} onApply={cart.addDiscount} />

      <ReceiptSheet
        open={receipt !== null}
        sale={receipt?.sale ?? null}
        totals={receipt?.totals ?? null}
        lines={receipt?.lines ?? []}
        payments={receipt?.payments ?? []}
        change={receipt?.change ?? 0}
        onClose={() => setReceipt(null)}
      />
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors press no-select',
        active
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function ProductTile({
  product,
  menu,
  stock,
  lowStock,
  onSelect,
}: {
  product: Product
  menu: MenuData
  stock: StockMap
  /** The shop's low-stock rule, and how fast each ingredient is going. */
  lowStock: { settings: BusinessSettings | null | undefined; rates: Map<string, number> }
  inCart: number
  onSelect: () => void
}) {
  const money = useMoney()
  const variants = menu.variantsByProduct.get(product.id) ?? []
  const cheapest = variants.reduce<number | null>(
    (lowest, variant) => (lowest === null || variant.price < lowest ? variant.price : lowest),
    null,
  )

  // A product is only truly unavailable when none of its sizes can be made.
  const availabilities = variants.map((variant) => availabilityOf(variant.id, menu, stock, lowStock))
  const soldOut =
    !product.available || (availabilities.length > 0 && availabilities.every((entry) => entry.outOfStock))
  const low = !soldOut && availabilities.some((entry) => entry.low || (entry.makeable !== Infinity && entry.makeable <= 5))

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={soldOut}
      className={cn(
        'group relative flex min-h-[7rem] flex-col justify-between rounded-2xl border border-line bg-surface p-3.5 text-left shadow-card transition-all press no-select',
        'hover:border-brand/50 hover:shadow-raised',
        soldOut && 'opacity-55 shadow-none hover:border-line hover:shadow-none',
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="line-clamp-2 text-[0.9375rem] font-medium leading-snug text-ink">{product.name}</p>
        {variants.length > 1 ? (
          <p className="text-xs text-ink-subtle">{variants.length} sizes</p>
        ) : null}
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <span className="tabular text-[0.9375rem] font-semibold text-ink">
          {cheapest !== null ? money(cheapest) : '—'}
        </span>
        {soldOut ? (
          <Badge tone="danger">Sold out</Badge>
        ) : low ? (
          <Badge tone="warning">Low</Badge>
        ) : null}
      </div>
    </button>
  )
}

function CartPanel({
  cart,
  totals,
  onCheckout,
  onDiscount,
  canDiscount,
  timing,
  customAt,
  onTiming,
  onCustomAt,
  mayBackdate,
  onClose,
}: {
  cart: ReturnType<typeof useCart>
  totals: OrderTotals | null
  onCheckout: () => void
  onDiscount: () => void
  canDiscount: boolean
  timing: TimingChoice
  customAt: number
  onTiming: (next: TimingChoice) => void
  onCustomAt: (next: number) => void
  /** Whether this person may record an order for another day. */
  mayBackdate: boolean
  /** Present only where the panel is shown as an overlay. */
  onClose?: () => void
}) {
  const money = useMoney()
  const { settings } = useSettings()
  const { can } = useSession()
  const [endingShift, setEndingShift] = useState(false)

  const canSeeShift = can('shift.xreading') || can('shift.close') || can('shift.zreading')
  const orderTypes = useLiveQuery(() => listOrderTypes(), [], [] as OrderTypeEntry[])

  // Cups and snacks are counted separately, because a coffee shop measures
  // its day in cups and a pastry is not one.
  const counts = countLines(cart.cart.lines)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="font-medium text-ink">Current order</p>
          {counts.cups > 0 ? (
            <span className="tabular rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
              {counts.cups} {counts.cups === 1 ? 'cup' : 'cups'}
            </span>
          ) : null}
          {counts.snacks > 0 ? (
            <span className="tabular rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-muted">
              {counts.snacks} {counts.snacks === 1 ? 'snack' : 'snacks'}
            </span>
          ) : null}
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        ) : !cart.isEmpty ? (
          <Button variant="ghost" size="sm" onClick={cart.clear}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="scroll-pane min-h-0 flex-1">
        {cart.isEmpty ? (
          <EmptyState
            icon={<ShoppingBag className="h-7 w-7" aria-hidden="true" />}
            title="Nothing added yet"
            description="Tap an item on the menu to start the order."
          />
        ) : (
          <ul className="divide-y divide-line">
            {cart.cart.lines.map((line) => (
              <li key={line.id} className="px-4 py-3">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {line.productName}
                      {line.variantName ? <span className="text-ink-muted"> · {line.variantName}</span> : null}
                    </p>
                    {line.modifiers.length > 0 ? (
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {line.modifiers.map((modifier) => modifier.optionName).join(', ')}
                      </p>
                    ) : null}
                    {line.note ? <p className="mt-0.5 text-xs italic text-ink-subtle">“{line.note}”</p> : null}
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="tabular block text-sm font-medium text-ink">
                      {money(
                        (line.unitPrice + line.modifiers.reduce((sum, m) => sum + m.priceDelta, 0)) * line.quantity -
                          claimedValue(line),
                      )}
                    </span>
                    {claimedValue(line) > 0 ? (
                      <span className="block text-xs font-medium text-positive">
                        {line.loyaltyFreeQty} free · −{money(claimedValue(line))}
                      </span>
                    ) : null}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => cart.setQuantity(line.id, line.quantity - 1)}
                    aria-label="Fewer"
                  >
                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <span className="tabular w-8 text-center text-sm font-medium text-ink">{line.quantity}</span>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => cart.setQuantity(line.id, line.quantity + 1)}
                    aria-label="More"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>

                  {/* How many of this line go on the loyalty card. They are
                      still made, so their stock and cost stay exactly as they
                      are - only the money comes off. */}
                  {(line.loyaltyFreeQty ?? 0) === 0 ? (
                    <button
                      type="button"
                      onClick={() => cart.setLoyaltyQty(line.id, 1)}
                      className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-subtle transition-colors press hover:border-line-strong hover:text-ink"
                    >
                      <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                      Claim free
                    </button>
                  ) : (
                    <span className="ml-auto flex items-center gap-1 rounded-lg border border-positive bg-positive/10 py-0.5 pl-2 pr-0.5">
                      <Gift className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => cart.setLoyaltyQty(line.id, (line.loyaltyFreeQty ?? 0) - 1)}
                        className="rounded p-1 text-positive hover:bg-positive/15"
                        aria-label="Claim one fewer"
                      >
                        <Minus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <span className="tabular min-w-4 text-center text-xs font-semibold text-positive">
                        {line.loyaltyFreeQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => cart.setLoyaltyQty(line.id, (line.loyaltyFreeQty ?? 0) + 1)}
                        disabled={(line.loyaltyFreeQty ?? 0) >= line.quantity}
                        className="rounded p-1 text-positive hover:bg-positive/15 disabled:opacity-40"
                        aria-label="Claim one more"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <span className="pr-1.5 text-xs font-medium text-positive">free</span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* When the order happened, and the way to record a day that predates
          the system. Both are hidden unless the shop has turned backdating on
          and this person is allowed to use it - a control nobody can use is
          clutter on a screen that is used under pressure. */}
      {mayBackdate ? (
        <div className="shrink-0 space-y-4 border-t border-line px-4 py-3">
          <OrderTiming choice={timing} customAt={customAt} onChoice={onTiming} onCustomAt={onCustomAt} />
          {cart.isEmpty ? (
            <LumpSumEntry defaultAt={timing === 'CUSTOM' ? customAt : yesterdayAtSameTime()} />
          ) : null}
        </div>
      ) : null}

      {/* How the order is being taken. Only shown when the shop offers more
          than one way, because a single choice is not a choice. */}
      {orderTypes.length > 1 && !cart.isEmpty ? (
        <div className="shrink-0 border-t border-line px-4 py-3">
          <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">Order type</p>
          <div className="flex flex-wrap gap-1.5">
            {orderTypes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => cart.setOrderType(entry.code)}
                className={cn(
                  'rounded-xl border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors press',
                  cart.cart.orderType === entry.code
                    ? 'border-brand bg-brand-soft text-ink'
                    : 'border-line text-ink-muted hover:text-ink',
                )}
              >
                {entry.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Closing up. Only with an empty cart: an order half rung up is not a
          day that is over, and the summary would be read as if it were. */}
      {cart.isEmpty && canSeeShift ? (
        <div className="shrink-0 border-t border-line px-4 py-3">
          <Button variant="secondary" full onClick={() => setEndingShift(true)}>
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            End of shift
          </Button>
          <EndOfShiftSheet open={endingShift} onClose={() => setEndingShift(false)} />
        </div>
      ) : null}

      {!cart.isEmpty && totals ? (
        <div className="space-y-3 border-t border-line px-4 py-4 pad-safe-bottom">
          {totals.discounts.length > 0 ? (
            <ul className="space-y-1.5">
              {totals.discounts.map((discount) => (
                <li key={discount.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-positive">
                    <BadgePercent className="h-3.5 w-3.5" aria-hidden="true" />
                    {discount.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular text-positive">-{money(discount.amount)}</span>
                    <button
                      type="button"
                      onClick={() => cart.removeDiscount(discount.id)}
                      className="rounded-md p-0.5 text-ink-subtle hover:bg-surface-sunken"
                      aria-label={`Remove ${discount.label}`}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd className="tabular text-ink">{money(totals.subtotal)}</dd>
            </div>
            {totals.taxExemptTotal > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">VAT exempt</dt>
                <dd className="tabular text-positive">-{money(totals.taxExemptTotal)}</dd>
              </div>
            ) : null}
            {totals.taxTotal > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">
                  {settings?.tax.label} {settings?.tax.inclusive ? '(included)' : ''}
                </dt>
                <dd className="tabular text-ink">{money(totals.taxTotal)}</dd>
              </div>
            ) : null}
          </dl>

          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="font-medium text-ink">Total</span>
            <span className="tabular text-2xl font-semibold tracking-tight text-ink">{money(totals.total)}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" size="lg" onClick={onDiscount} disabled={!canDiscount}>
              <BadgePercent className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="lg" className="col-span-2" onClick={onCheckout}>
              Charge
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
