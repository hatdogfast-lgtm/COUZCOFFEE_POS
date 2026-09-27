import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Banknote, CreditCard, Gift, Loader2, Smartphone, TriangleAlert } from 'lucide-react'
import {
  changeDue,
  fromDecimal,
  quickTenderOptions,
  type Money,
  type OrderTotals,
  type PaymentKind,
  type PaymentMethod,
  type PaymentMethodEntry,
} from '@pos/shared'
import { Button, Sheet } from '../components/ui/primitives.tsx'
import { useMoney, useOnlineStatus, useSettings } from '../app/providers.tsx'
import type { TenderInput } from './checkout.ts'
import { listPaymentMethods } from '../db/shopLists.ts'
import { referenceRequired } from '../db/till.ts'
import { cn } from '../lib/utils.ts'

/**
 * Taking payment.
 *
 * Cash needs no connection and never has. For wallets and cards the sheet is
 * explicit about what the till actually knows: while offline it records the
 * operator's word that payment was taken, and says so, rather than displaying
 * a confirmation it has no basis for.
 */

/**
 * The picture on the button follows what a payment behaves like, so one the
 * shop invented looks right without anybody choosing an icon for it.
 */
const ICONS: Record<PaymentKind, typeof Banknote> = {
  CASH: Banknote,
  EWALLET: Smartphone,
  CARD: CreditCard,
  NON_CASH: Gift,
}

export function PaymentSheet({
  open,
  totals,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  totals: OrderTotals
  busy: boolean
  onClose: () => void
  onConfirm: (payments: TenderInput[]) => void
}) {
  const money = useMoney()
  const { settings } = useSettings()
  const online = useOnlineStatus()
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [tenderText, setTenderText] = useState('')
  const [reference, setReference] = useState('')

  useEffect(() => {
    if (!open) return
    setMethod('CASH')
    setTenderText('')
    setReference('')
  }, [open])

  // Which methods the shop offers, and how each behaves. Read from the shop's
  // own list rather than a fixed set, so "BPI QR" works the day it is added.
  const methods = useLiveQuery(() => listPaymentMethods(), [], [] as PaymentMethodEntry[])
  const current = methods.find((entry) => entry.code === method)
  const kind: PaymentKind = current?.kind ?? (method === 'CASH' ? 'CASH' : 'EWALLET')

  const label = current?.name ?? method
  const takesCash = kind === 'CASH'
  // Not money coming in at all: the order is given away.
  const claiming = kind === 'NON_CASH'

  const tendered: Money = useMemo(() => {
    if (!takesCash) return totals.total
    const parsed = Number(tenderText.replace(/[^\d.]/g, ''))
    return Number.isFinite(parsed) && parsed > 0 ? fromDecimal(parsed) : 0
  }, [takesCash, tenderText, totals.total])

  const change = changeDue(tendered, totals.total)
  const short = takesCash && tendered < totals.total
  const quick = useMemo(() => quickTenderOptions(totals.total), [totals.total])

  // A wallet payment taken with no connection is recorded, not verified.
  const unverified = !takesCash && !claiming && !online

  // A method the shop has marked as needing a reference cannot be settled
  // without one. Checkout refuses it too; this just stops the operator getting
  // as far as being refused.
  // Either the method itself says so, or the older shop-wide setting does.
  const needsReference =
    !claiming && (current?.requiresReference === true || referenceRequired(settings, method))
  const missingReference = needsReference && reference.trim().length === 0

  function confirm(): void {
    if (busy || short) return
    onConfirm([
      {
        method,
        // A loyalty claim brings in nothing: the order is given away, and the
        // redemption is recorded against it rather than as money received.
        amount: claiming ? 0 : totals.total,
        tendered: claiming ? 0 : takesCash ? tendered : totals.total,
        reference: reference.trim(),
      },
    ])
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Payment"
      dismissible={!busy}
      closeDisabled={busy}
      footer={
        <Button size="xl" full onClick={confirm} disabled={busy || short || missingReference}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          {busy
            ? 'Completing…'
            : claiming
              ? 'Complete as loyalty claim'
              : `Complete sale · ${money(totals.total)}`}
        </Button>
      }
    >
      <div className="space-y-5">
            <div className="rounded-xl bg-surface-sunken px-4 py-4 text-center">
              <p className="text-[0.8125rem] text-ink-muted">{claiming ? 'Loyalty claim' : 'Amount due'}</p>
              <p className="tabular text-4xl font-semibold tracking-tight text-ink">
                {claiming ? money(0) : money(totals.total)}
              </p>
              {claiming ? (
                <p className="mt-1 text-xs text-ink-subtle">
                  {money(totals.total)} given away. The drink is still made, so its cost is still recorded.
                </p>
              ) : null}
              {totals.discountTotal > 0 || totals.taxExemptTotal > 0 ? (
                <p className="mt-1 text-xs text-ink-subtle">
                  {totals.discountTotal > 0 ? `${money(totals.discountTotal)} discount` : null}
                  {totals.discountTotal > 0 && totals.taxExemptTotal > 0 ? ' · ' : null}
                  {totals.taxExemptTotal > 0 ? `${money(totals.taxExemptTotal)} VAT waived` : null}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-4 gap-2">
              {methods.map((entry) => {
                const Icon = ICONS[entry.kind] ?? Banknote
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setMethod(entry.code as PaymentMethod)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-full border px-2 py-3 transition-colors press',
                      method === entry.code ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <Icon className="h-5 w-5 text-ink-muted" aria-hidden="true" />
                    <span className="text-xs font-medium text-ink">{entry.name}</span>
                  </button>
                )
              })}
            </div>

            {takesCash ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {quick.map((amount) => (
                    <Button
                      key={amount}
                      variant="secondary"
                      onClick={() => setTenderText(String(amount / 100))}
                      className="tabular h-12"
                    >
                      {money(amount)}
                    </Button>
                  ))}
                </div>
                <label className="block space-y-1.5">
                  <span className="text-[0.8125rem] font-medium text-ink-muted">Cash received</span>
                  <input
                    value={tenderText}
                    onChange={(event) => setTenderText(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    autoFocus
                    className="figure h-14 w-full rounded-xl border border-line-strong bg-surface px-4 text-right text-2xl font-semibold text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
                  />
                </label>
                <div className="flex items-center justify-between rounded-xl bg-surface-sunken px-4 py-3">
                  <span className="text-sm text-ink-muted">Change</span>
                  <span
                    className={cn(
                      'tabular text-xl font-semibold',
                      short ? 'text-danger' : change > 0 ? 'text-positive' : 'text-ink',
                    )}
                  >
                    {short ? `${money(totals.total - tendered)} short` : money(change)}
                  </span>
                </div>
              </div>
            ) : (
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1 text-[0.8125rem] font-medium text-ink-muted">
                  {claiming ? `${label} number` : `${label} reference number`}
                  {needsReference ? (
                    <>
                      <span className="text-danger" aria-hidden="true">
                        •
                      </span>
                      <span className="sr-only">required</span>
                    </>
                  ) : (
                    <span className="text-ink-subtle">(optional)</span>
                  )}
                </span>
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder={
                    claiming
                      ? 'e.g. card number on the stamp card'
                      : needsReference
                        ? `Enter the ${label} reference (e.g., Ref #)`
                        : 'e.g. last 4 digits, or approval code'
                  }
                  maxLength={40}
                  className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
                />
              </label>
            )}

            {unverified ? (
              <div className="flex items-start gap-2.5 rounded-xl border-l-2 border-honey bg-honey/15 px-3.5 py-3 text-[0.8125rem] text-ink">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  This device is offline, so the payment cannot be confirmed with the provider. It will be recorded
                  as <span className="font-medium">taken but not verified</span>, and marked that way on the receipt
                  and in reports.
                </p>
              </div>
            ) : null}
          </div>

    </Sheet>
  )
}
