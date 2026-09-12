import { useEffect, useRef } from 'react'
import { Check, CloudOff, Printer } from 'lucide-react'
import type { OrderTotals, Sale } from '@pos/shared'
import { Button, Micro, Money, Sheet } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings, useSyncStatus } from '../app/providers.tsx'
import { printerConfig, receiptForFreshSale } from '../db/receipts.ts'
import { printReceipt } from '../print/printing.ts'
import { toast } from 'sonner'
import type { CartLine, TenderInput } from './checkout.ts'

/**
 * The sale is done.
 *
 * The queue number is the largest thing on screen because it is the one piece
 * of information the next person in the queue actually needs. Everything else
 * is available but subordinate to it.
 */
export function ReceiptSheet({
  open,
  sale,
  totals,
  lines,
  payments,
  change,
  onClose,
}: {
  open: boolean
  sale: Sale | null
  totals: OrderTotals | null
  lines: CartLine[]
  payments: TenderInput[]
  change: number
  onClose: () => void
}) {
  const money = useMoney()
  const { settings } = useSettings()
  const { user } = useSession()
  const status = useSyncStatus()

  /**
   * Print what was just sold.
   *
   * Never allowed to take the sale down with it - the sale was complete the
   * moment it was committed, and a printer that is out of paper is a printer
   * problem, not a sale problem.
   */
  async function print(): Promise<void> {
    if (!sale || !totals || !settings) return
    try {
      const config = printerConfig(settings)
      await printReceipt(
        receiptForFreshSale({
          sale,
          settings,
          cashierName: user?.name ?? '',
          items: lines.map((line, index) => ({
            quantity: line.quantity,
            name: line.productName,
            detail:
              [line.variantName, line.modifiers.map((modifier) => modifier.optionName).join(', ')]
                .filter(Boolean)
                .join(' · ') || undefined,
            amount: totals.lines[index]?.lineTotal ?? 0,
          })),
          discounts: totals.discounts.map((discount) => ({ label: discount.label, amount: discount.amount })),
          payments: payments.map((payment) => ({
            label: payment.method,
            amount: payment.amount,
            reference: payment.reference || undefined,
          })),
          change,
          taxableSales: totals.taxableSales,
          taxExemptSales: totals.taxExemptSales,
          zeroRatedSales: totals.zeroRatedSales,
        }),
        {
          route: config.printRoute,
          openDrawer: config.openDrawerOnCash && payments.some((payment) => payment.method === 'CASH'),
          logoDataUrl: settings.branding.logoDataUrl,
        },
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The receipt could not be printed.')
    }
  }

  /**
   * Print by itself when the shop has asked for that.
   *
   * Keyed on the sale's own id so one sale prints exactly once, however many
   * times this component re-renders while the sheet is open.
   */
  const printedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open || !sale || !settings) return
    if (!printerConfig(settings).autoPrint) return
    if (printedFor.current === sale.id) return
    printedFor.current = sale.id
    void print()
  }, [open, sale?.id, settings?.id])

  if (!sale || !totals) return null

  const branding = settings?.branding
  const unverified = payments.some((payment) => payment.method !== 'CASH') && !status.online

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-positive/15 text-positive">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          Sale complete
        </span>
      }
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => void print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </Button>
          <Button size="lg" onClick={onClose} autoFocus>
            Next order
          </Button>
        </div>
      }
    >
      {/* The queue number is the largest thing on screen because it is the
          one piece of information the next person in the queue needs. */}
      <div className="text-center">
        <Micro>Queue number</Micro>
        <p className="font-display text-7xl font-medium leading-none tracking-tight text-brand">{sale.queueNo}</p>
      </div>

      {change > 0 ? (
        <div className="mt-5 rounded-md border border-positive/40 bg-positive/10 px-4 py-3 text-center">
          <Micro className="text-positive">Change due</Micro>
          <Money className="block text-3xl font-semibold text-positive">{money(change)}</Money>
        </div>
      ) : null}

      <div className="mt-6 space-y-4 border-t border-line pt-5 text-sm">
        <div className="text-center">
          <p className="font-display text-lg font-medium text-brand">{branding?.businessName}</p>
          {branding?.address ? <p className="text-xs text-ink-subtle">{branding.address}</p> : null}
          {branding?.taxId ? <p className="text-xs text-ink-subtle">TIN {branding.taxId}</p> : null}
        </div>

        <div className="flex justify-between">
          <Micro>{sale.receiptNo}</Micro>
          <Micro>{new Date(sale.occurredAt).toLocaleString()}</Micro>
        </div>

        <ul className="space-y-2 border-t border-line pt-3">
          {lines.map((line, index) => {
            const lineTotals = totals.lines[index]
            return (
              <li key={line.id} className="flex items-baseline gap-2">
                <span className="min-w-0">
                  <span className="block text-ink">
                    {line.quantity} × {line.productName}
                    {line.variantName ? ` (${line.variantName})` : ''}
                  </span>
                  {line.modifiers.length > 0 ? (
                    <span className="block text-xs text-ink-subtle">
                      {line.modifiers.map((modifier) => modifier.optionName).join(', ')}
                    </span>
                  ) : null}
                  {line.note ? <span className="block text-xs text-ink-subtle">“{line.note}”</span> : null}
                </span>
                <span className="mb-1 min-w-3 flex-1 border-b border-dotted border-line-strong" aria-hidden="true" />
                <Money className="shrink-0 text-ink">{money(lineTotals?.lineSubtotal ?? 0)}</Money>
              </li>
            )
          })}
        </ul>

        <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
          <Row label="Subtotal" value={money(totals.subtotal)} />
          {totals.discounts.map((discount) => (
            <Row key={discount.id} label={discount.label} value={`-${money(discount.amount)}`} tone="positive" />
          ))}
          {totals.taxExemptTotal > 0 ? (
            <Row label="VAT exempt" value={`-${money(totals.taxExemptTotal)}`} tone="positive" />
          ) : null}
          {totals.taxTotal > 0 ? (
            <Row label={`${settings?.tax.label ?? 'VAT'} (${settings?.tax.rate}%)`} value={money(totals.taxTotal)} />
          ) : null}
          <div className="flex items-baseline justify-between border-t border-line-strong pt-2">
            <dt>
              <Micro className="text-ink">Total</Micro>
            </dt>
            <dd>
              <Money className="text-lg font-semibold text-ink">{money(totals.total)}</Money>
            </dd>
          </div>
          {payments.map((payment, index) => (
            <Row
              key={index}
              label={payment.method === 'CASH' ? 'Cash' : payment.method}
              value={money(payment.tendered)}
            />
          ))}
          {change > 0 ? <Row label="Change" value={money(change)} /> : null}
        </dl>

        {unverified ? (
          <p className="rounded-md border-l-2 border-honey bg-honey/15 px-3 py-2 text-xs text-ink">
            Payment recorded on this device but not yet confirmed with the provider.
          </p>
        ) : null}

        {status.state === 'OFFLINE' ? (
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-subtle">
            <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
            Saved on this device. It will sync on its own.
          </p>
        ) : null}

        {branding?.receiptFooter ? (
          <p className="pt-2 text-center text-xs text-ink-subtle">{branding.receiptFooter}</p>
        ) : null}
      </div>
    </Sheet>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd>
        <Money className={tone === 'positive' ? 'text-positive' : 'text-ink'}>{value}</Money>
      </dd>
    </div>
  )
}
