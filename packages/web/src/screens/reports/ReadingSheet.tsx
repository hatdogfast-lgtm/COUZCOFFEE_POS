import * as Dialog from '@radix-ui/react-dialog'
import { Printer, X } from 'lucide-react'
import type { ReadingSnapshot } from '../../db/readings.ts'
import { Button } from '../../components/ui/primitives.tsx'
import { useMoney, useSettings } from '../../app/providers.tsx'
import { printerConfig } from '../../db/receipts.ts'
import { printLinesInBrowser } from '../../print/printing.ts'
import { readingLines } from '../../db/readings.ts'
import { cn } from '../../lib/utils.ts'

/**
 * A reading, laid out the way it would be printed.
 *
 * Deliberately plain: this is the document someone signs, files, or hands to
 * an auditor, so it reads top to bottom in the order the figures are checked -
 * takings, then corrections, then how it was paid, then the drawer.
 */
export function ReadingSheet({
  snapshot,
  open,
  onClose,
}: {
  snapshot: ReadingSnapshot | null
  open: boolean
  onClose: () => void
}) {
  const money = useMoney()
  const { settings } = useSettings()
  if (!snapshot) return null

  const isZ = snapshot.type === 'Z'
  const variance = snapshot.cash.variance

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[30rem] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:animate-slide-in-right">
          <header className="flex items-center justify-between border-b border-line px-5 py-4 pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold text-ink">
                {isZ ? 'Z reading' : 'X reading'} #{snapshot.sequence}
              </Dialog.Title>
              <Dialog.Description className="truncate text-sm text-ink-muted">
                {snapshot.shiftCode} · {new Date(snapshot.takenAt).toLocaleString()}
              </Dialog.Description>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 rounded-xl p-2 text-ink-muted hover:bg-surface-sunken"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          <div className="scroll-pane flex-1 px-5 py-4" id="reading-print">
            <Row label="Shift opened" value={new Date(snapshot.openedAt).toLocaleString()} muted />
            <Row label="Opened by" value={snapshot.openedByName} muted />
            <Row label="Reading taken by" value={snapshot.takenByName} muted />

            <Section title="Takings" />
            <Row label="Gross sales" value={money(snapshot.grossSales)} />
            <Row label="Less discounts" value={`−${money(snapshot.discounts)}`} />
            <Row label="Net of tax" value={money(snapshot.netOfTax)} />
            <Row label="Tax" value={money(snapshot.tax)} />
            {snapshot.taxExempt !== 0 ? (
              <Row label="Tax lifted (senior / PWD)" value={money(snapshot.taxExempt)} muted />
            ) : null}
            <Row label="Total sales" value={money(snapshot.totalSales)} strong />

            <Section title="Counts" />
            <Row label="Transactions" value={String(snapshot.transactions)} />
            <Row label="Cups sold" value={String(snapshot.cupsSold ?? snapshot.itemsSold)} />
            {(snapshot.snacksSold ?? 0) > 0 ? (
              <Row label="Snacks sold" value={String(snapshot.snacksSold)} />
            ) : null}
            <Row label="Average sale" value={money(snapshot.averageSale)} />

            <Section title="Corrections" />
            <Row
              label={`Voids (${snapshot.voidCount})`}
              value={money(snapshot.voidAmount)}
              tone={snapshot.voidCount > 0 ? 'danger' : undefined}
            />
            <Row
              label={`Refunds (${snapshot.refundCount})`}
              value={`−${money(snapshot.refundAmount)}`}
              tone={snapshot.refundCount > 0 ? 'danger' : undefined}
            />

            <Section title="How it was paid" />
            {snapshot.payments.length === 0 ? (
              <p className="py-1 text-[0.8125rem] text-ink-subtle">Nothing taken yet.</p>
            ) : (
              snapshot.payments.map((line) => (
                <Row key={line.key} label={`${line.label} (${line.count})`} value={money(line.amount)} />
              ))
            )}

            {snapshot.discountLines.length > 0 ? (
              <>
                <Section title="Discounts given" />
                {snapshot.discountLines.map((line) => (
                  <Row key={line.key} label={`${line.label} (${line.count})`} value={money(line.amount)} />
                ))}
              </>
            ) : null}

            <Section title="The drawer" />
            <Row label="Opening float" value={money(snapshot.cash.openingFloat)} />
            <Row label="Cash sales" value={money(snapshot.cash.cashSales)} />
            {snapshot.cash.payIn > 0 ? <Row label="Money put in" value={money(snapshot.cash.payIn)} /> : null}
            {snapshot.cash.payOut > 0 ? (
              <Row label="Money taken out" value={`−${money(snapshot.cash.payOut)}`} />
            ) : null}
            {snapshot.cash.pettyCash > 0 ? (
              <Row label="Petty cash" value={`−${money(snapshot.cash.pettyCash)}`} />
            ) : null}
            {snapshot.cash.cashDrops > 0 ? (
              <Row label="Dropped to the safe" value={`−${money(snapshot.cash.cashDrops)}`} />
            ) : null}
            <Row label="Expected in drawer" value={money(snapshot.cash.expectedCash)} strong />

            {snapshot.cash.countedCash !== null ? (
              <>
                <Row label="Counted" value={money(snapshot.cash.countedCash)} strong />
                <Row
                  label={variance === 0 ? 'Balanced' : (variance ?? 0) > 0 ? 'Over' : 'Short'}
                  value={money(Math.abs(variance ?? 0))}
                  tone={variance === 0 ? 'positive' : 'danger'}
                  strong
                />
                {snapshot.cash.varianceReason ? (
                  <p className="mt-1 rounded-xl bg-surface-sunken px-3 py-2 text-[0.8125rem] text-ink-muted">
                    {snapshot.cash.varianceReason}
                  </p>
                ) : null}
              </>
            ) : null}

            {isZ && snapshot.grandTotal !== null ? (
              <>
                <Section title="Register" />
                <Row label="Total across every Z reading" value={money(snapshot.grandTotal)} strong />
              </>
            ) : null}

            <p className="mt-5 text-[0.8125rem] text-ink-subtle">
              {isZ
                ? 'This reading closed the shift. The figures are the ones recorded at that moment and do not change afterwards.'
                : 'An X reading is a look at the register part-way through. It changed nothing and the shift carried on.'}
            </p>
          </div>

          <footer className="border-t border-line px-5 py-3 pad-safe-bottom">
            <Button
              variant="secondary"
              full
              onClick={() => {
                const paperWidth = printerConfig(settings).paperWidth
                printLinesInBrowser(
                  // The same width the page is sized for, or the reading comes
                  // out as a narrow strip up one side of wide paper.
                  readingLines({
                    snapshot,
                    money: (amount) => money(amount),
                    branding: settings?.branding,
                    paperWidth,
                  }),
                  paperWidth,
                  settings?.branding.logoDataUrl,
                )
              }}
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ title }: { title: string }) {
  return (
    <h3 className="mb-1 mt-5 border-b border-line pb-1 text-[0.8125rem] font-medium uppercase tracking-wide text-ink-subtle">
      {title}
    </h3>
  )
}

function Row({
  label,
  value,
  strong,
  muted,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
  tone?: 'positive' | 'danger'
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className={cn('text-[0.9375rem]', muted ? 'text-ink-subtle' : 'text-ink-muted')}>{label}</span>
      <span
        className={cn(
          'tabular shrink-0 text-[0.9375rem]',
          strong ? 'font-semibold text-ink' : 'text-ink',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : '',
        )}
      >
        {value}
      </span>
    </div>
  )
}
