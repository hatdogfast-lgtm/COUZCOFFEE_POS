import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Bluetooth, Printer, Usb, Wallet } from 'lucide-react'
import { PAPER_WIDTHS, type PaperWidth, type PrintRoute } from '@pos/shared'
import {
  capabilities,
  forgetBluetoothPrinter,
  openDrawer,
  pairBluetoothPrinter,
  pairUsbPrinter,
  pairedPrinterName,
  previewLines,
  printReceipt,
  testReceipt,
} from '../../print/printing.ts'
import { printerConfig } from '../../db/receipts.ts'
import { updateReceiptSettings } from '../../db/settings.ts'
import { Button } from '../../components/ui/primitives.tsx'
import { useSession, useSettings } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * The receipt printer.
 *
 * Every option here changes something a person can see on paper, so each one
 * is shown against a live preview rendered by the same code that drives the
 * printer. Choosing 80mm and finding out at the counter that half the line is
 * missing is the failure this screen exists to prevent.
 */
export function PrinterPanel() {
  const { settings } = useSettings()
  const { can } = useSession()
  const [busy, setBusy] = useState(false)
  const [paired, setPaired] = useState<string | null>(pairedPrinterName())

  const able = useMemo(() => capabilities(), [])
  const config = printerConfig(settings)
  const mayEdit = can('settings.edit')

  const preview = useMemo(
    () =>
      previewLines(testReceipt(config.paperWidth, settings?.branding.businessName ?? 'Your shop')),
    [config.paperWidth, settings?.branding.businessName],
  )

  async function save(changes: Parameters<typeof updateReceiptSettings>[0]['changes']): Promise<void> {
    if (!settings || busy) return
    setBusy(true)
    try {
      await updateReceiptSettings({ settings, changes })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function pair(route: 'BLUETOOTH' | 'USB'): Promise<void> {
    setBusy(true)
    try {
      const name = route === 'BLUETOOTH' ? await pairBluetoothPrinter() : await pairUsbPrinter()
      setPaired(name)
      await save({ printRoute: route })
      toast.success(`Paired with ${name}.`)
    } catch (error) {
      // A person closing the chooser is not a failure worth shouting about.
      const message = error instanceof Error ? error.message : 'No printer was chosen.'
      if (!/cancell?ed|No device selected|user gesture/i.test(message)) toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  async function testPrint(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await printReceipt(testReceipt(config.paperWidth, settings?.branding.businessName ?? 'Your shop'), {
        route: config.printRoute,
        logoDataUrl: settings?.branding.logoDataUrl,
      })
      if (config.printRoute !== 'BROWSER') toast.success('Sent to the printer.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The test print could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  if (!settings) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  const ROUTES: Array<{ id: PrintRoute; label: string; detail: string; icon: typeof Printer; available: boolean }> = [
    {
      id: 'BROWSER',
      label: 'Through the print dialogue',
      detail:
        'Uses whatever printer this device already knows about, including a shared one. Works everywhere, including iPhones and iPads. Someone has to confirm each print.',
      icon: Printer,
      available: able.browser,
    },
    {
      id: 'BLUETOOTH',
      label: 'Bluetooth printer',
      detail: able.bluetooth
        ? 'For the counter-top thermal printers. Prints straight away, with no dialogue.'
        : 'This browser cannot reach Bluetooth devices. Chrome or Edge on Android, Windows or macOS can.',
      icon: Bluetooth,
      available: able.bluetooth,
    },
    {
      id: 'USB',
      label: 'USB printer',
      detail: able.usb
        ? 'For a printer plugged into this till. Prints straight away.'
        : 'This browser cannot reach USB devices. Chrome or Edge on a desktop can.',
      icon: Usb,
      available: able.usb,
    },
  ]

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Paper width</h2>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            The width of the roll. It decides how many characters fit on a line, so getting it wrong cuts the
            right-hand column off.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {PAPER_WIDTHS.map((width) => (
              <button
                key={width}
                type="button"
                disabled={!mayEdit || busy}
                onClick={() => void save({ paperWidth: width as PaperWidth })}
                className={cn(
                  'rounded-xl border px-4 py-3 text-left transition-colors press disabled:opacity-50',
                  config.paperWidth === width ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                )}
              >
                <span className="block text-sm font-medium text-ink">{width}mm</span>
                <span className="block text-[0.8125rem] text-ink-subtle">
                  {width === 58 ? '32 characters — the common small roll' : '48 characters — the wider roll'}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">How this till prints</h2>
          <div className="mt-3 space-y-2">
            {ROUTES.map((route) => (
              <button
                key={route.id}
                type="button"
                disabled={!mayEdit || busy || !route.available}
                onClick={() => (route.id === 'BROWSER' ? void save({ printRoute: 'BROWSER' }) : void pair(route.id))}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors press',
                  config.printRoute === route.id ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                  !route.available && 'opacity-55',
                )}
              >
                <route.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {route.label}
                    {config.printRoute === route.id && paired && route.id !== 'BROWSER' ? ` — ${paired}` : ''}
                  </span>
                  <span className="block text-[0.8125rem] text-ink-muted">{route.detail}</span>
                </span>
              </button>
            ))}
          </div>

          {config.printRoute !== 'BROWSER' && paired ? (
            <Button
              variant="ghost"
              className="mt-2"
              onClick={() => {
                forgetBluetoothPrinter()
                setPaired(null)
                void save({ printRoute: 'BROWSER' })
              }}
            >
              Forget this printer
            </Button>
          ) : null}
        </section>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">When to print</h2>
          <label className="mt-3 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={config.autoPrint}
              disabled={!mayEdit || busy}
              onChange={(event) => void save({ autoPrint: event.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
            />
            <span className="text-[0.8125rem]">
              <span className="block font-medium text-ink">Print automatically when a sale is finished</span>
              <span className="block text-ink-subtle">
                Off by default, because a queue does not want to wait for a print dialogue on every order.
              </span>
            </span>
          </label>

          <label className="mt-3 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={config.openDrawerOnCash}
              disabled={!mayEdit || busy || config.printRoute === 'BROWSER'}
              onChange={(event) => void save({ openDrawerOnCash: event.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
            />
            <span className="text-[0.8125rem]">
              <span className="block font-medium text-ink">Open the cash drawer on a cash sale</span>
              <span className="block text-ink-subtle">
                Needs a drawer wired to the printer. The print dialogue cannot do this.
              </span>
            </span>
          </label>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">What it will look like</h2>
            <div className="flex gap-2">
              {config.printRoute !== 'BROWSER' ? (
                <Button variant="ghost" onClick={() => void openDrawer(config.printRoute).catch(() => undefined)}>
                  <Wallet className="h-4 w-4" aria-hidden="true" />
                  Open drawer
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => void testPrint()} disabled={busy}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Test print
              </Button>
            </div>
          </div>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Laid out by the same code that drives the printer, so this is the paper, not an impression of it.
          </p>
          <pre className="scroll-pane mt-3 max-h-96 overflow-auto rounded-xl bg-surface-sunken p-3 font-mono text-[0.6875rem] leading-snug text-ink">
            {preview.join('\n')}
          </pre>
        </section>
      </div>
    </div>
  )
}
