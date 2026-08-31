import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LayoutDashboard, Percent, TriangleAlert } from 'lucide-react'
import type { BusinessSettings, PaymentMethod } from '@pos/shared'
import { setDashboardTile, setTaxEnabled, updateSettings } from '../../db/settings.ts'
import { DASHBOARD_TILES, tileEnabled } from '../reports/tiles.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * How the business is configured.
 *
 * The switches here change what every future total looks like, so each one
 * says what it will actually do rather than leaving it to be discovered at the
 * till. Nothing here alters a sale that has already been rung up.
 */
export function GeneralPanel() {
  const { settings } = useSettings()
  const { user, can } = useSession()
  const money = useMoney()

  const mayEdit = can('settings.edit')
  const [busy, setBusy] = useState(false)

  if (!settings) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  async function act(run: () => Promise<unknown>, done: string): Promise<void> {
    if (busy || !mayEdit) return
    setBusy(true)
    try {
      await run()
      toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-5">
        {!mayEdit ? (
          <p className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] text-warning">
            You can see these settings but not change them.
          </p>
        ) : null}

        <TaxCard settings={settings} disabled={!mayEdit || busy} onAct={act} actorId={user?.id ?? ''} money={money} />
        <TillCard settings={settings} disabled={!mayEdit || busy} onAct={act} actorId={user?.id ?? ''} />
        <DashboardCard settings={settings} disabled={!mayEdit || busy} onAct={act} actorId={user?.id ?? ''} />
      </div>
    </div>
  )
}

type Act = (run: () => Promise<unknown>, done: string) => Promise<void>

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-ink">
        <span className="text-ink-muted">{icon}</span>
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="block text-[0.8125rem] text-ink-subtle">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-positive' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

function TaxCard({
  settings,
  disabled,
  onAct,
  actorId,
  money,
}: {
  settings: BusinessSettings
  disabled: boolean
  onAct: Act
  actorId: string
  money: (amount: number) => string
}) {
  const [rate, setRate] = useState(String(settings.tax.rate))
  const [label, setLabel] = useState(settings.tax.label)

  useEffect(() => {
    setRate(String(settings.tax.rate))
    setLabel(settings.tax.label)
  }, [settings.tax.rate, settings.tax.label])

  const rateNumber = Number(rate.replace(/[^\d.]/g, ''))
  const rateValid = Number.isFinite(rateNumber) && rateNumber >= 0 && rateNumber < 100

  // A 100.00 sale, shown both ways, so the setting is not abstract.
  const example = 10000
  const included = Math.round(example - example / (1 + rateNumber / 100))

  return (
    <Card title="Tax" icon={<Percent className="h-4 w-4" aria-hidden="true" />}>
      <Toggle
        label={`Charge ${settings.tax.label}`}
        hint={
          settings.tax.enabled
            ? 'Turning this off stops tax being worked out on new sales. Sales already recorded keep the tax they were rung up with.'
            : 'Currently off, so no tax is worked out on new sales.'
        }
        checked={settings.tax.enabled}
        disabled={disabled}
        onChange={() =>
          void onAct(
            () => setTaxEnabled({ settings, enabled: !settings.tax.enabled, actorId }),
            settings.tax.enabled ? `${settings.tax.label} is off.` : `${settings.tax.label} is on.`,
          )
        }
      />

      {settings.tax.enabled ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What it is called" hint="Appears on receipts and reports.">
              <Input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={12} disabled={disabled} />
            </Field>
            <Field label="Rate (%)" error={rateValid ? null : 'Enter a rate between 0 and 100.'}>
              <Input
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                inputMode="decimal"
                className="tabular text-right"
                disabled={disabled}
              />
            </Field>
          </div>

          <Toggle
            label="Menu prices already include it"
            hint={
              settings.tax.inclusive
                ? `A ${money(example)} item is ${money(example)} at the till, of which ${money(included)} is ${settings.tax.label}.`
                : `A ${money(example)} item becomes ${money(example + Math.round((example * rateNumber) / 100))} at the till.`
            }
            checked={settings.tax.inclusive}
            disabled={disabled}
            onChange={() =>
              void onAct(
                () =>
                  updateSettings({
                    settings,
                    changes: { tax: { ...settings.tax, inclusive: !settings.tax.inclusive } },
                    actorId,
                    what: settings.tax.inclusive ? 'Prices now exclude tax' : 'Prices now include tax',
                  }),
                'Saved.',
              )
            }
          />

          {(label !== settings.tax.label || rateNumber !== settings.tax.rate) && rateValid ? (
            <Button
              full
              disabled={disabled}
              onClick={() =>
                void onAct(
                  () =>
                    updateSettings({
                      settings,
                      changes: { tax: { ...settings.tax, label: label.trim() || 'Tax', rate: rateNumber } },
                      actorId,
                      what: `Tax set to ${rateNumber}%`,
                    }),
                  'Saved.',
                )
              }
            >
              Save tax changes
            </Button>
          ) : null}
        </>
      ) : (
        <p className="flex items-start gap-2 rounded-xl bg-surface-sunken px-3.5 py-3 text-[0.8125rem] text-ink-muted">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          With tax off, every new sale records nothing as tax and your reports show gross and net revenue as the
          same figure.
        </p>
      )}
    </Card>
  )
}

function TillCard({
  settings,
  disabled,
  onAct,
  actorId,
}: {
  settings: BusinessSettings
  disabled: boolean
  onAct: Act
  actorId: string
}) {
  return (
    <Card title="At the till" icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}>
      <Toggle
        label="Stop sales when something is out of stock"
        hint="A supervisor can still override it at the till. Turn this off to let anything be sold regardless of stock."
        checked={settings.blockSaleWhenOutOfStock}
        disabled={disabled}
        onChange={() =>
          void onAct(
            () =>
              updateSettings({
                settings,
                changes: { blockSaleWhenOutOfStock: !settings.blockSaleWhenOutOfStock },
                actorId,
                what: 'Out-of-stock blocking changed',
              }),
            'Saved.',
          )
        }
      />
      <Toggle
        label="Warn when stock runs low"
        hint="Marks items at or below their reorder level."
        checked={settings.lowStockWarningEnabled}
        disabled={disabled}
        onChange={() =>
          void onAct(
            () =>
              updateSettings({
                settings,
                changes: { lowStockWarningEnabled: !settings.lowStockWarningEnabled },
                actorId,
                what: 'Low stock warning changed',
              }),
            'Saved.',
          )
        }
      />

      <Toggle
        label="Count labour in what a drink costs"
        hint={
          settings.includeLabourInCost
            ? 'On. Recipe lines marked as labour are added to each drink’s cost, so margins are after paying whoever made it.'
            : 'Off. Only ingredients and packaging count. Turn this on once you have added a labour line to your recipes.'
        }
        checked={settings.includeLabourInCost === true}
        disabled={disabled}
        onChange={() =>
          void onAct(
            () =>
              updateSettings({
                settings,
                changes: { includeLabourInCost: !settings.includeLabourInCost },
                actorId,
                what: settings.includeLabourInCost ? 'Labour excluded from cost' : 'Labour included in cost',
              }),
            'Saved.',
          )
        }
      />

      <Toggle
        label="Allow recording past days"
        hint={
          settings.backdatingEnabled
            ? 'On. The till can date an order to another day and record a whole past day’s takings. Who may do it is set per person in Staff, under “Record past days and backdated orders”.'
            : 'Off. Every order is dated now. Turn this on only if you need to enter days the till missed — backdating rewrites the books.'
        }
        checked={settings.backdatingEnabled === true}
        disabled={disabled}
        onChange={() =>
          void onAct(
            () =>
              updateSettings({
                settings,
                changes: { backdatingEnabled: !settings.backdatingEnabled },
                actorId,
                what: settings.backdatingEnabled ? 'Backdating turned off' : 'Backdating turned on',
              }),
            'Saved.',
          )
        }
      />

      <div className="pt-1">
        <p className="text-[0.8125rem] font-medium text-ink">Payments that need a reference number</p>
        <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
          A sale by one of these will not go through until the reference is entered. Without it there is nothing to
          match against the wallet or card statement at the end of the day.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {REFERENCE_METHODS.map((method) => {
            const on = (settings.requireReferenceFor ?? []).includes(method)
            return (
              <button
                key={method}
                type="button"
                disabled={disabled}
                onClick={() =>
                  void onAct(
                    () =>
                      updateSettings({
                        settings,
                        changes: {
                          requireReferenceFor: on
                            ? (settings.requireReferenceFor ?? []).filter((entry) => entry !== method)
                            : [...(settings.requireReferenceFor ?? []), method],
                        },
                        actorId,
                        what: `Reference requirement changed for ${method}`,
                      }),
                    'Saved.',
                  )
                }
                className={cn(
                  'rounded-xl border px-3 py-2 text-sm font-medium transition-colors press disabled:opacity-50',
                  on ? 'border-brand bg-brand-soft text-ink' : 'border-line text-ink-muted hover:border-line-strong',
                )}
              >
                {METHOD_LABELS[method]}
                <span className="block text-[0.6875rem] font-normal text-ink-subtle">
                  {on ? 'Required' : 'Optional'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

/**
 * Which figures the reports dashboard shows.
 *
 * Turning one off hides the tile and nothing else - the figure is still worked
 * out, still on the receipts, still in the profit and loss below. This is about
 * what the owner wants to look at first, not about what is recorded.
 */
function DashboardCard({
  settings,
  disabled,
  onAct,
  actorId,
}: {
  settings: BusinessSettings
  disabled: boolean
  onAct: Act
  actorId: string
}) {
  const shown = DASHBOARD_TILES.filter((tile) => tileEnabled(settings, tile.id)).length

  return (
    <Card title="Reports dashboard" icon={<LayoutDashboard className="h-4 w-4" aria-hidden="true" />}>
      <p className="text-[0.8125rem] text-ink-muted">
        The tiles across the top of Reports. Turning one off only hides it — every figure is still worked out and
        still appears in the profit and loss.
      </p>

      {DASHBOARD_TILES.map((tile) => {
        const on = tileEnabled(settings, tile.id)
        // The last tile standing stays put; an empty row of figures is not a
        // setting anyone means to choose.
        const lastOne = on && shown === 1
        return (
          <Toggle
            key={tile.id}
            label={tile.label}
            hint={lastOne ? 'Kept on — the dashboard needs at least one figure.' : tile.hint}
            checked={on}
            disabled={disabled || lastOne}
            onChange={() =>
              void onAct(
                () => setDashboardTile({ tileId: tile.id, on: !on, label: tile.label, actorId }),
                'Saved.',
              )
            }
          />
        )
      })}
    </Card>
  )
}

/** Cash never has a reference, and a loyalty claim is not a payment. */
const REFERENCE_METHODS: PaymentMethod[] = ['GCASH', 'MAYA', 'CARD']

const METHOD_LABELS: Record<string, string> = {
  GCASH: 'GCash',
  MAYA: 'Maya',
  CARD: 'Card',
}
