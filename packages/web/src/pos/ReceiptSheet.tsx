import { useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, CloudOff, Printer } from 'lucide-react'
import type { OrderTotals, Sale } from '@pos/shared'
import { Button } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings, useSyncStatus } from '../app/providers.tsx'
import { printerConfig, receiptForFreshSale } from '../db/receipts.ts'
import { printReceipt } from '../print/printing.ts'
import { toast } from 'sonner'
import type { CartLine, TenderInput } from './checkout.ts'
import { cn } from '../lib/utils.ts'

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
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-0 sm:m-auto sm:h-fit sm:max-w-sm sm:rounded-3xl sm:border sm:animate-scale-in">
          <div className="scroll-pane flex-1 px-6 py-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-positive/12 text-positive">
                <Check className="h-6 w-6" aria-hidden="true" />
              </span>
              <Dialog.Title className="text-base font-medium text-ink">Sale complete</Dialog.Title>

              <div className="w-full rounded-2xl bg-surface-sunken px-4 py-5">
                <p className="text-[0.8125rem] text-ink-muted">Queue number</p>
                <p className="tabular text-6xl font-semibold tracking-tight text-brand">{sale.queueNo}</p>
              </div>

              {change > 0 ? (
                <div className="w-full rounded-2xl bg-positive/10 px-4 py-3">
                  <p className="text-[0.8125rem] text-positive/80">Change due</p>
                  <p className="tabular text-3xl font-semibold text-positive">{money(change)}</p>
                </div>
              ) : null}
            </div>

            <div className="mt-6 space-y-4 border-t border-dashed border-line pt-5 text-sm">
              <div className="text-center">
                <p className="font-medium text-ink">{branding?.businessName}</p>
                {branding?.address ? <p className="text-xs text-ink-subtle">{branding.address}</p> : null}
                {branding?.taxId ? <p className="text-xs text-ink-subtle">TIN {branding.taxId}</p> : null}
              </div>

              <div className="flex justify-between text-xs text-ink-muted">
                <span>{sale.receiptNo}</span>
                <span>{new Date(sale.occurredAt).toLocaleString()}</span>
              </div>

              <ul className="space-y-2 border-t border-dashed border-line pt-3">
                {lines.map((line, index) => {
                  const lineTotals = totals.lines[index]
                  return (
                    <li key={line.id} className="flex justify-between gap-3">
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
                      <span className="tabular shrink-0 text-ink">{money(lineTotals?.lineSubtotal ?? 0)}</span>
                    </li>
                  )
                })}
              </ul>

              <dl className="space-y-1.5 border-t border-dashed border-line pt-3 text-sm">
                <Row label="Subtotal" value={money(totals.subtotal)} />
                {totals.discounts.map((discount) => (
                  <Row
                    key={discount.id}
                    label={discount.label}
                    value={`-${money(discount.amount)}`}
                    tone="positive"
                  />
                ))}
                {totals.taxExemptTotal > 0 ? (
                  <Row label="VAT exempt" value={`-${money(totals.taxExemptTotal)}`} tone="positive" />
                ) : null}
                {totals.taxTotal > 0 ? (
                  <Row label={`${settings?.tax.label ?? 'VAT'} (${settings?.tax.rate}%)`} value={money(totals.taxTotal)} />
                ) : null}
                <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-ink">
                  <dt>Total</dt>
                  <dd className="tabular">{money(totals.total)}</dd>
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
                <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
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
          </div>

          <footer className="grid grid-cols-2 gap-2 border-t border-line px-5 py-4 pad-safe-bottom">
            <Button variant="secondary" size="lg" onClick={() => void print()}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </Button>
            <Button size="lg" onClick={onClose} autoFocus>
              Next order
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn('tabular', tone === 'positive' ? 'text-positive' : 'text-ink')}>{value}</dd>
    </div>
  )
}
