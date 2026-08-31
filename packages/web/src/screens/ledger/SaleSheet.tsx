import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { Ban, Minus, Plus, Printer, Undo2, X } from 'lucide-react'
import { PAYMENT_METHODS, type PaymentMethod, type Sale, type SaleItem } from '@pos/shared'
import {
  canRefund,
  canVoid,
  isRefund as isRefundSale,
  refundedSoFar,
  loadSaleDetail,
  refundableRemaining,
  refundSale,
  refundTotals,
  STATUS_LABELS,
  voidSale,
} from '../../db/ledger.ts'
import { Badge, Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings } from '../../app/providers.tsx'
import { receiptForSale, printerConfig } from '../../db/receipts.ts'
import { printReceipt } from '../../print/printing.ts'
import { cn, clockTime } from '../../lib/utils.ts'

/**
 * One transaction, in full, with the two ways to undo it.
 *
 * Void and refund are deliberately separated rather than merged into an
 * "undo": one says the order never really happened, the other says money is
 * going back for something that did. They have different consequences for the
 * books, and the person doing it should have to say which they mean.
 */

type Mode = 'VIEW' | 'VOID' | 'REFUND'

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  MAYA: 'Maya',
  CARD: 'Card',
  LOYALTY: 'Loyalty claim',
}

export function SaleSheet({
  sale,
  open,
  onClose,
}: {
  sale: Sale | null
  open: boolean
  onClose: () => void
}) {
  const money = useMoney()
  const { settings } = useSettings()
  const { user, can } = useSession()

  const [mode, setMode] = useState<Mode>('VIEW')
  const [reason, setReason] = useState('')
  const [returnStock, setReturnStock] = useState(true)
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('CASH')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const detail = useLiveQuery(
    () => (sale ? loadSaleDetail(sale.id) : Promise.resolve(null)),
    [sale?.id],
  )

  /**
   * Print the receipt again, from the stored sale.
   *
   * Rebuilt from what was recorded rather than from anything on screen, and
   * marked as a reprint on its face so a duplicate can never be presented as
   * a second sale.
   */
  async function reprint(): Promise<void> {
    if (!sale || !settings || busy) return
    setBusy(true)
    try {
      const route = printerConfig(settings).printRoute
      const receipt = await receiptForSale({
        saleId: sale.id,
        settings,
        reprint: true,
        // The thermal route needs the logo as dots; the browser prints the
        // picture itself, so converting there would be wasted work.
        withLogo: route !== 'BROWSER',
      })
      if (!receipt) throw new Error('That sale is no longer on this device.')
      await printReceipt(receipt, { route, logoDataUrl: settings.branding.logoDataUrl })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The receipt could not be printed.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open || !sale) return
    setMode('VIEW')
    setReason('')
    setReturnStock(true)
    setRefundMethod('CASH')
    setQuantities({})
  }, [open, sale?.id])

  const refundLines = useMemo(() => {
    if (!detail) return []
    return detail.items.map((item) => ({ item, quantity: quantities[item.id] ?? 0 }))
  }, [detail, quantities])

  const proposed = useMemo(() => refundTotals(refundLines), [refundLines])

  if (!sale) return null

  const voidCheck = canVoid(sale)
  const refundCheck = canRefund(sale)
  const remaining = refundableRemaining(sale)
  const isRefund = isRefundSale(sale)

  function setQuantity(item: SaleItem, next: number): void {
    setQuantities((current) => ({
      ...current,
      [item.id]: Math.max(0, Math.min(Math.abs(item.quantity), next)),
    }))
  }

  async function doVoid(): Promise<void> {
    if (!user || !sale || busy) return
    setBusy(true)
    try {
      await voidSale({ sale, reason, user, returnStock })
      toast.success('Sale voided.')
      setMode('VIEW')
      setReason('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be voided.')
    } finally {
      setBusy(false)
    }
  }

  async function doRefund(): Promise<void> {
    if (!user || !sale || busy) return
    setBusy(true)
    try {
      const result = await refundSale({
        sale,
        lines: refundLines,
        reason,
        user,
        method: refundMethod,
        returnStock,
      })
      toast.success(`Refunded ${money(result.amount)}.`)
      setMode('VIEW')
      setReason('')
      setQuantities({})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be refunded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[30rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:animate-slide-in-right">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="font-mono text-base font-semibold text-ink">
                {sale.receiptNo}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-ink-muted">
                {new Date(sale.occurredAt).toLocaleDateString()} {clockTime(sale.occurredAt)}
                {sale.queueNo ? ` · queue ${sale.queueNo}` : ''}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" disabled={busy}>
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane flex-1 space-y-5 px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              {sale.status !== 'COMPLETED' ? (
                <Badge tone={sale.status === 'VOIDED' ? 'danger' : 'warning'}>
                  {STATUS_LABELS[sale.status]}
                </Badge>
              ) : (
                <Badge tone="online">Completed</Badge>
              )}
              {isRefund ? <Badge tone="warning">This is a refund</Badge> : null}
              {sale.entryMode === 'LUMP_SUM' ? <Badge tone="neutral">Backfilled day</Badge> : null}
              {sale.createdAt - sale.occurredAt > 60_000 && sale.entryMode !== 'LUMP_SUM' ? (
                <Badge tone="neutral">Entered later</Badge>
              ) : null}
            </div>

            {sale.status === 'VOIDED' ? (
              <p className="rounded-xl bg-danger/10 px-3.5 py-3 text-[0.8125rem] text-danger">
                Voided {sale.voidedAt ? `on ${new Date(sale.voidedAt).toLocaleString()}` : ''}
                {sale.voidReason ? ` — ${sale.voidReason}` : ''}
              </p>
            ) : null}

            {refundedSoFar(sale) > 0 ? (
              <p className="rounded-xl bg-warning/10 px-3.5 py-3 text-[0.8125rem] text-warning">
                {money(refundedSoFar(sale))} of {money(sale.total)} refunded.{' '}
                {remaining > 0 ? `${money(remaining)} still refundable.` : 'Nothing left to refund.'}
              </p>
            ) : null}

            {/* What was sold */}
            <section className="space-y-2">
              <h3 className="text-[0.8125rem] font-medium text-ink-muted">Items</h3>
              {sale.entryMode === 'LUMP_SUM' ? (
                <p className="rounded-xl border border-line px-3.5 py-3 text-sm text-ink-muted">
                  A day's takings entered as one figure, covering {sale.itemCount} cups. No line detail exists for
                  it, and no stock was deducted.
                </p>
              ) : (detail?.items.length ?? 0) === 0 ? (
                <p className="py-3 text-sm text-ink-subtle">No lines recorded.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {detail?.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm text-ink">
                          {item.quantity}× {item.productName}
                          {item.variantName ? ` (${item.variantName})` : ''}
                        </span>
                        {item.modifiers.length > 0 ? (
                          <span className="block text-xs text-ink-subtle">
                            {item.modifiers.map((modifier) => modifier.optionName).join(', ')}
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular shrink-0 text-sm text-ink">{money(item.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <dl className="space-y-1.5 text-sm">
              <Row label="Subtotal" value={money(sale.subtotal)} />
              {detail?.discounts.map((discount) => (
                <Row key={discount.id} label={discount.label} value={`-${money(discount.amount)}`} tone="positive" />
              ))}
              {sale.taxExemptTotal > 0 ? (
                <Row label="VAT exempt" value={`-${money(sale.taxExemptTotal)}`} tone="positive" />
              ) : null}
              {sale.taxTotal > 0 ? (
                <Row label={settings?.tax.label ?? 'VAT'} value={money(sale.taxTotal)} />
              ) : null}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-ink">
                <dt>Total</dt>
                <dd className="tabular">{money(sale.total)}</dd>
              </div>
              {detail?.payments.map((payment) => (
                <Row
                  key={payment.id}
                  label={METHOD_LABELS[payment.method]}
                  value={money(payment.amount)}
                  note={payment.verification === 'RECORDED_LOCALLY' ? 'not verified' : undefined}
                />
              ))}
            </dl>

            {(detail?.refunds.length ?? 0) > 0 ? (
              <section className="space-y-2">
                <h3 className="text-[0.8125rem] font-medium text-ink-muted">Refunds against this sale</h3>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {detail?.refunds.map((entry) => (
                    <li key={entry.id} className="flex justify-between gap-3 px-3.5 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-ink">{entry.receiptNo}</span>
                        <span className="block text-xs text-ink-subtle">
                          {clockTime(entry.occurredAt)}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-danger">{money(entry.total)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Void */}
            {mode === 'VOID' ? (
              <section className="space-y-4 rounded-2xl border border-danger/30 bg-danger/5 p-4">
                <p className="text-sm text-ink">
                  Voiding cancels the whole sale. It stays on record, marked as voided, and drops out of every
                  report.
                </p>
                <Field label="Reason" hint="Required, and kept in the audit trail.">
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="e.g. rung up twice"
                    autoFocus
                    maxLength={140}
                  />
                </Field>
                <StockToggle
                  checked={returnStock}
                  onChange={setReturnStock}
                  hint="Turn this off if the drink was already made and thrown away."
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setMode('VIEW')} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={() => void doVoid()} disabled={busy || !reason.trim()}>
                    {busy ? 'Voiding…' : 'Void this sale'}
                  </Button>
                </div>
              </section>
            ) : null}

            {/* Refund */}
            {mode === 'REFUND' ? (
              <section className="space-y-4 rounded-2xl border border-warning/40 bg-warning/5 p-4">
                <p className="text-sm text-ink">Choose how much of each line to give back.</p>

                <ul className="space-y-2">
                  {detail?.items.map((item) => {
                    const chosen = quantities[item.id] ?? 0
                    return (
                      <li key={item.id} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{item.productName}</span>
                          <span className="block text-xs text-ink-subtle">
                            {item.quantity} sold · {money(item.lineTotal)}
                          </span>
                        </span>
                        <Button
                          variant="secondary"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setQuantity(item, chosen - 1)}
                          disabled={chosen <= 0}
                          aria-label="Fewer"
                        >
                          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <span className="tabular w-6 text-center text-sm font-medium text-ink">{chosen}</span>
                        <Button
                          variant="secondary"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setQuantity(item, chosen + 1)}
                          disabled={chosen >= Math.abs(item.quantity)}
                          aria-label="More"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </li>
                    )
                  })}
                </ul>

                <Field label="Reason" hint="Required, and kept in the audit trail.">
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="e.g. drink was cold"
                    maxLength={140}
                  />
                </Field>

                <Field label="Refund by">
                  <select
                    value={refundMethod}
                    onChange={(event) => setRefundMethod(event.target.value as PaymentMethod)}
                    className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[0.9375rem] text-ink focus:border-brand focus:outline-none"
                  >
                    {PAYMENT_METHODS.filter((entry) => entry !== 'LOYALTY').map((entry) => (
                      <option key={entry} value={entry}>
                        {METHOD_LABELS[entry]}
                      </option>
                    ))}
                  </select>
                </Field>

                <StockToggle
                  checked={returnStock}
                  onChange={setReturnStock}
                  hint="Usually off: a drink that was handed over is not back on the shelf."
                />

                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <span className="text-sm text-ink-muted">Refunding</span>
                  <span className="tabular text-xl font-semibold text-ink">{money(proposed.amount)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setMode('VIEW')} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void doRefund()}
                    disabled={busy || !reason.trim() || proposed.amount <= 0 || proposed.amount > remaining}
                  >
                    {busy ? 'Refunding…' : 'Refund'}
                  </Button>
                </div>
                {proposed.amount > remaining ? (
                  <p className="text-[0.8125rem] text-danger">
                    That is more than the {money(remaining)} still refundable on this sale.
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>

          {mode === 'VIEW' ? (
            <footer className="space-y-2 border-t border-line px-5 py-4 pad-safe-bottom">
              {can('pos.reprint') ? (
                <Button variant="secondary" full onClick={() => void reprint()} disabled={busy}>
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  Reprint receipt
                </Button>
              ) : null}

              {!isRefund ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMode('VOID')
                      setReturnStock(true)
                    }}
                    disabled={!can('pos.void') || !voidCheck.allowed}
                    title={voidCheck.allowed ? undefined : voidCheck.reason}
                  >
                    <Ban className="h-4 w-4" aria-hidden="true" />
                    Void
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMode('REFUND')
                      setReturnStock(false)
                    }}
                    disabled={!can('pos.refund') || !refundCheck.allowed}
                    title={refundCheck.allowed ? undefined : refundCheck.reason}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden="true" />
                    Refund
                  </Button>
                </div>
              ) : null}

              {!can('pos.void') && !can('pos.refund') ? (
                <p className="text-center text-xs text-ink-subtle">
                  A supervisor or manager can void or refund this.
                </p>
              ) : null}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Row({
  label,
  value,
  tone,
  note,
}: {
  label: string
  value: string
  tone?: 'positive'
  note?: string
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">
        {label}
        {note ? <span className="text-warning"> · {note}</span> : null}
      </dt>
      <dd className={cn('tabular', tone === 'positive' ? 'text-positive' : 'text-ink')}>{value}</dd>
    </div>
  )
}

function StockToggle({
  checked,
  onChange,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left"
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[0.625rem]',
          checked ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong',
        )}
      >
        {checked ? '✓' : ''}
      </span>
      <span>
        <span className="block text-sm font-medium text-ink">Put the stock back</span>
        <span className="block text-[0.8125rem] text-ink-subtle">{hint}</span>
      </span>
    </button>
  )
}
