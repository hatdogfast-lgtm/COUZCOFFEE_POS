import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BadgePercent, ClipboardCheck, Gift, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import type { OrderTotals, OrderTypeEntry } from '@pos/shared'
import { Button, EmptyState, Micro, Money } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings } from '../app/providers.tsx'
import type { useCart } from './useCart.ts'
import { claimedValue } from './checkout.ts'
import { listOrderTypes } from '../db/shopLists.ts'
import { EndOfShiftSheet } from './EndOfShiftSheet.tsx'
import { LumpSumEntry, OrderTiming, yesterdayAtSameTime, type TimingChoice } from './OrderEntryPanels.tsx'
import { countLines } from '../db/till.ts'
import { cn } from '../lib/utils.ts'

/**
 * The order half of the till.
 *
 * A column beside the menu on a tablet or laptop, and the sheet behind the
 * order bar on a phone. Same component in both places; only the frame around
 * it changes.
 */
export function CartPanel({
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
          <Micro className="text-ink">Current order</Micro>
          {counts.cups > 0 ? (
            <span className="figure rounded-sm bg-brand-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold text-brand">
              {counts.cups} {counts.cups === 1 ? 'cup' : 'cups'}
            </span>
          ) : null}
          {counts.snacks > 0 ? (
            <span className="figure rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] font-semibold text-ink-muted">
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
                    <Money className="block text-sm font-semibold text-ink">
                      {money(
                        (line.unitPrice + line.modifiers.reduce((sum, m) => sum + m.priceDelta, 0)) * line.quantity -
                          claimedValue(line),
                      )}
                    </Money>
                    {claimedValue(line) > 0 ? (
                      <Money className="block text-xs font-medium text-positive">
                        {line.loyaltyFreeQty} free · −{money(claimedValue(line))}
                      </Money>
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
                  <Money className="w-8 text-center text-sm font-semibold text-ink">{line.quantity}</Money>
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
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-subtle transition-colors press hover:text-ink"
                    >
                      <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                      Claim free
                    </button>
                  ) : (
                    <span className="ml-auto flex items-center gap-1 rounded-md border border-positive bg-positive/10 py-0.5 pl-2 pr-0.5">
                      <Gift className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => cart.setLoyaltyQty(line.id, (line.loyaltyFreeQty ?? 0) - 1)}
                        className="rounded-sm p-1 text-positive hover:bg-positive/15"
                        aria-label="Claim one fewer"
                      >
                        <Minus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <Money className="min-w-4 text-center text-xs font-semibold text-positive">
                        {line.loyaltyFreeQty}
                      </Money>
                      <button
                        type="button"
                        onClick={() => cart.setLoyaltyQty(line.id, (line.loyaltyFreeQty ?? 0) + 1)}
                        disabled={(line.loyaltyFreeQty ?? 0) >= line.quantity}
                        className="rounded-sm p-1 text-positive hover:bg-positive/15 disabled:opacity-40"
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
          <Micro className="mb-1.5">Order type</Micro>
          <div className="flex flex-wrap gap-1.5">
            {orderTypes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => cart.setOrderType(entry.code)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors press',
                  cart.cart.orderType === entry.code
                    ? 'border-brand bg-brand-soft text-ink'
                    : 'border-line-strong text-ink-muted hover:text-ink',
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
        <div className="space-y-3 border-t border-line-strong px-4 py-4 pad-safe-bottom">
          {totals.discounts.length > 0 ? (
            <ul className="space-y-1.5">
              {totals.discounts.map((discount) => (
                <li key={discount.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-positive">
                    <BadgePercent className="h-3.5 w-3.5" aria-hidden="true" />
                    {discount.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <Money className="text-positive">-{money(discount.amount)}</Money>
                    <button
                      type="button"
                      onClick={() => cart.removeDiscount(discount.id)}
                      className="rounded-sm p-0.5 text-ink-subtle hover:bg-surface-sunken"
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
              <dd>
                <Money className="text-ink">{money(totals.subtotal)}</Money>
              </dd>
            </div>
            {totals.taxExemptTotal > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">VAT exempt</dt>
                <dd>
                  <Money className="text-positive">-{money(totals.taxExemptTotal)}</Money>
                </dd>
              </div>
            ) : null}
            {totals.taxTotal > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">
                  {settings?.tax.label} {settings?.tax.inclusive ? '(included)' : ''}
                </dt>
                <dd>
                  <Money className="text-ink">{money(totals.taxTotal)}</Money>
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <Micro className="text-ink">Total</Micro>
            <Money className="text-2xl font-semibold text-ink">{money(totals.total)}</Money>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" size="lg" onClick={onDiscount} disabled={!canDiscount} aria-label="Discount">
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
