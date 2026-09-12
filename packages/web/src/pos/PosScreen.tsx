import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { lowStockOf, type OrderTotals, type Product, type Sale } from '@pos/shared'
import { db } from '../db/database.ts'
import { loadMenu, stockLevels, type StockMap } from '../db/repo.ts'
import { Money } from '../components/ui/primitives.tsx'
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
import { ensureShift } from './shift.ts'
import { ProductSheet } from './ProductSheet.tsx'
import { PaymentSheet } from './PaymentSheet.tsx'
import { DiscountSheet } from './DiscountSheet.tsx'
import { ReceiptSheet } from './ReceiptSheet.tsx'
import { yesterdayAtSameTime, type TimingChoice } from './OrderEntryPanels.tsx'
import { MenuGrid } from './MenuGrid.tsx'
import { CartPanel } from './CartPanel.tsx'
import { countLines, tillPolicy } from '../db/till.ts'

/**
 * The till.
 *
 * Everything on this screen reads from the device's own database, so it
 * behaves the same whether or not there is a connection. The only thing the
 * network changes is the small indicator in the corner.
 *
 * Three widths, one till. On a phone the menu owns the screen and the order
 * is a bar along the bottom that opens as a sheet. From 640px the order is a
 * column beside the menu and stays there; from 1024px the column widens and
 * the grid goes to four across.
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

  const panelProps = {
    cart,
    totals,
    mayBackdate,
    onCheckout: () => setShowPayment(true),
    onDiscount: () => setShowDiscount(true),
    canDiscount: can('pos.discount.standard'),
    timing,
    customAt,
    onTiming: setTiming,
    onCustomAt: setCustomAt,
  }
  const counts = countLines(cart.cart.lines)
  const summary = [
    counts.cups > 0 ? `${counts.cups} ${counts.cups === 1 ? 'cup' : 'cups'}` : '',
    counts.snacks > 0 ? `${counts.snacks} ${counts.snacks === 1 ? 'snack' : 'snacks'}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex min-h-0 flex-1">
        <MenuGrid
          menu={menu}
          products={products}
          stock={stock ?? new Map()}
          lowStock={lowStock}
          categoryId={categoryId}
          search={search}
          onCategory={setCategoryId}
          onSearch={setSearch}
          onSelect={setActiveProduct}
        />

        {/* The order: a column from tablet width up, a sheet on a phone. */}
        <aside className="hidden w-[18rem] shrink-0 border-l border-line-strong bg-surface sm:flex sm:flex-col lg:w-[22rem]">
          <CartPanel {...panelProps} />
        </aside>
      </div>

      {/* The order bar. Espresso, so it reads as part of the chrome; the
          Charge button is the only caramel thing on the screen. */}
      {!cart.isEmpty ? (
        <div className="flex shrink-0 items-center gap-3 bg-chrome px-3 py-2.5 text-chrome-ink pad-safe-bottom sm:hidden">
          <button
            type="button"
            onClick={() => setShowCartOnMobile(true)}
            className="min-w-0 flex-1 text-left"
            aria-label={`View order, ${cart.itemCount} items`}
          >
            <Money className="block text-[1.0625rem] font-semibold leading-tight">{money(totals?.total ?? 0)}</Money>
            <span className="block truncate text-[0.6875rem] text-chrome-muted">
              {summary || `${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'}`} · view order
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowPayment(true)}
            className="rounded-md bg-accent px-4 py-2.5 text-[0.8125rem] font-bold text-accent-ink press"
          >
            Charge
          </button>
        </div>
      ) : null}

      {showCartOnMobile ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface pad-safe-top sm:hidden animate-slide-up">
          {/* The panel carries its own heading, so the overlay adds only a way
              out of it - two "Current order" titles was one too many. */}
          <CartPanel {...panelProps} onClose={() => setShowCartOnMobile(false)} />
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
