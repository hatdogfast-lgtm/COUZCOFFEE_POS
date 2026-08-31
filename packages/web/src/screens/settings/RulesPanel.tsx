import { useState } from 'react'
import { toast } from 'sonner'
import { Boxes, Gift, Scale } from 'lucide-react'
import {
  lowStockOf,
  loyaltyOf,
  statutoryRulesOf,
  type BusinessSettings,
  type LowStockBasis,
  type StatutoryRule,
} from '@pos/shared'
import { updateSettings } from '../../db/settings.ts'
import { Field, Input } from '../../components/ui/primitives.tsx'
import { useSession, useSettings } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * The rules the shop runs by.
 *
 * These are the things that would otherwise need a developer: what a senior
 * discount actually does, when to say something is running out, what the
 * loyalty offer is. None of them are the code's business - they are the
 * shop's, and they change without anyone touching the app.
 */
export function RulesPanel() {
  const { settings } = useSettings()
  const { user, can } = useSession()
  const [busy, setBusy] = useState(false)

  const mayEdit = can('settings.edit')

  if (!settings) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  async function act(run: () => Promise<unknown>, done = 'Saved.'): Promise<void> {
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

  const save = (changes: Parameters<typeof updateSettings>[0]['changes'], what: string) =>
    act(() => updateSettings({ settings: settings!, changes, actorId: user?.id ?? '', what }))

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-5">
        {!mayEdit ? (
          <p className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] text-warning">
            You can see these rules but not change them.
          </p>
        ) : null}

        <StatutoryCard settings={settings} disabled={!mayEdit || busy} onSave={save} />
        <LowStockCard settings={settings} disabled={!mayEdit || busy} onSave={save} />
        <LoyaltyCard settings={settings} disabled={!mayEdit || busy} onSave={save} />
      </div>
    </div>
  )
}

type Save = (changes: Parameters<typeof updateSettings>[0]['changes'], what: string) => Promise<void>

function Card({ title, note, icon, children }: { title: string; note: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
        <span className="text-ink-muted">{icon}</span>
        {title}
      </h2>
      <p className="mb-4 mt-1 text-[0.8125rem] text-ink-muted">{note}</p>
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

/**
 * Statutory concessions.
 *
 * The Philippine senior-citizen rule lifts VAT and then takes 20% off; that is
 * the default, not an assumption baked into the till. A shop trading under
 * different law says so here.
 */
function StatutoryCard({
  settings,
  disabled,
  onSave,
}: {
  settings: BusinessSettings
  disabled: boolean
  onSave: Save
}) {
  const rules = statutoryRulesOf(settings)

  const replace = (code: string, changes: Partial<StatutoryRule>, what: string): void => {
    void onSave(
      { statutoryRules: rules.map((rule) => (rule.code === code ? { ...rule, ...changes } : rule)) },
      what,
    )
  }

  return (
    <Card
      title="Statutory concessions"
      note="What a legally required discount actually does. Sales already rung up keep the concession they were given."
      icon={<Scale className="h-4 w-4" aria-hidden="true" />}
    >
      {rules.map((rule) => (
        <div key={rule.code} className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-start justify-between gap-3">
            <input
              value={rule.label}
              disabled={disabled}
              onChange={(event) => replace(rule.code, { label: event.target.value }, `Renamed the ${rule.code} concession`)}
              className="min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium text-ink focus:outline-none disabled:opacity-100"
              aria-label={`${rule.code} name`}
            />
            <Toggle
              label={rule.enabled ? 'On' : 'Off'}
              checked={rule.enabled}
              disabled={disabled}
              onChange={() =>
                replace(rule.code, { enabled: !rule.enabled }, `${rule.label} concession turned ${rule.enabled ? 'off' : 'on'}`)
              }
            />
          </div>

          <Field label="Percentage off" className="w-32">
            <Input
              value={String(rule.rate)}
              disabled={disabled}
              inputMode="decimal"
              className="tabular h-10 text-right"
              onChange={(event) => {
                const rate = Number(event.target.value.replace(/[^\d.]/g, ''))
                if (Number.isFinite(rate) && rate >= 0 && rate <= 100) {
                  replace(rule.code, { rate }, `${rule.label} set to ${rate}%`)
                }
              }}
            />
          </Field>

          <Toggle
            label="Also lifts tax"
            hint={
              rule.liftsTax
                ? `Tax comes out of the price first, then ${rule.rate}% comes off what is left. This is the Philippine rule.`
                : `Just ${rule.rate}% off. Tax is charged as normal.`
            }
            checked={rule.liftsTax}
            disabled={disabled}
            onChange={() =>
              replace(rule.code, { liftsTax: !rule.liftsTax }, `${rule.label} ${rule.liftsTax ? 'no longer lifts' : 'now lifts'} tax`)
            }
          />

          <Toggle
            label="Needs an ID number"
            hint="Recorded against the sale and printed on the receipt, with a line to sign."
            checked={rule.requiresId}
            disabled={disabled}
            onChange={() =>
              replace(rule.code, { requiresId: !rule.requiresId }, `${rule.label} ID requirement changed`)
            }
          />
        </div>
      ))}
    </Card>
  )
}

const BASIS_OPTIONS: Array<{ value: LowStockBasis; label: string; hint: string }> = [
  { value: 'FIXED', label: 'A set amount', hint: 'The number on each ingredient.' },
  { value: 'USAGE', label: 'How fast it goes', hint: 'Worked out from what you actually use.' },
  { value: 'EITHER', label: 'Whichever comes first', hint: 'Warns on either one.' },
]

function LowStockCard({ settings, disabled, onSave }: { settings: BusinessSettings; disabled: boolean; onSave: Save }) {
  const rule = lowStockOf(settings)

  const change = (changes: Partial<typeof rule>, what: string): void => {
    void onSave({ lowStock: { ...rule, ...changes } }, what)
  }

  return (
    <Card
      title="Running low"
      note="When to warn that something is running out."
      icon={<Boxes className="h-4 w-4" aria-hidden="true" />}
    >
      <Toggle
        label="Warn when stock runs low"
        checked={rule.enabled}
        disabled={disabled}
        onChange={() => change({ enabled: !rule.enabled }, `Low stock warning turned ${rule.enabled ? 'off' : 'on'}`)}
      />

      {rule.enabled ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {BASIS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => change({ basis: option.value }, `Low stock measured by ${option.label}`)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition-colors press disabled:opacity-50',
                  rule.basis === option.value ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                )}
              >
                <span className="block text-sm font-medium text-ink">{option.label}</span>
                <span className="block text-[0.6875rem] text-ink-subtle">{option.hint}</span>
              </button>
            ))}
          </div>

          {rule.basis !== 'FIXED' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Warn me this many days ahead" hint="Days of stock left at the current rate.">
                <Input
                  value={String(rule.daysOfCover)}
                  disabled={disabled}
                  inputMode="numeric"
                  className="tabular text-right"
                  onChange={(event) => {
                    const days = Number(event.target.value.replace(/\D/g, ''))
                    if (days > 0 && days <= 90) change({ daysOfCover: days }, `Low stock warns ${days} days ahead`)
                  }}
                />
              </Field>
              <Field label="Measured over the last" hint="Days of trade to average the rate over.">
                <Input
                  value={String(rule.lookbackDays)}
                  disabled={disabled}
                  inputMode="numeric"
                  className="tabular text-right"
                  onChange={(event) => {
                    const days = Number(event.target.value.replace(/\D/g, ''))
                    if (days > 0 && days <= 180) change({ lookbackDays: days }, `Usage measured over ${days} days`)
                  }}
                />
              </Field>
            </div>
          ) : null}

          <p className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-ink-muted">
            {rule.basis === 'FIXED'
              ? 'A set amount never changes on its own, so it goes stale as trade changes. The other two keep up by themselves.'
              : `An ingredient nobody has used in the last ${rule.lookbackDays} days has no rate to measure, so it is left alone rather than guessed at.`}
          </p>
        </>
      ) : null}
    </Card>
  )
}

function LoyaltyCard({ settings, disabled, onSave }: { settings: BusinessSettings; disabled: boolean; onSave: Save }) {
  const loyalty = loyaltyOf(settings)

  const change = (changes: Partial<typeof loyalty>, what: string): void => {
    void onSave({ loyalty: { ...loyalty, ...changes } }, what)
  }

  return (
    <Card
      title="Loyalty"
      note="The offer you make. The till does not know who a customer is, so it states the deal — it cannot count anybody's cups for them."
      icon={<Gift className="h-4 w-4" aria-hidden="true" />}
    >
      <Toggle
        label="Offer a loyalty reward"
        checked={loyalty.enabled}
        disabled={disabled}
        onChange={() => change({ enabled: !loyalty.enabled }, `Loyalty turned ${loyalty.enabled ? 'off' : 'on'}`)}
      />

      {loyalty.enabled ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cups to earn it">
              <Input
                value={String(loyalty.cupsPerReward)}
                disabled={disabled}
                inputMode="numeric"
                className="tabular text-right"
                onChange={(event) => {
                  const cups = Number(event.target.value.replace(/\D/g, ''))
                  if (cups > 0 && cups <= 99) change({ cupsPerReward: cups }, `Loyalty set to ${cups} cups`)
                }}
              />
            </Field>
            <Field label="What they get">
              <Input
                value={loyalty.rewardLabel}
                disabled={disabled}
                maxLength={40}
                onChange={(event) => change({ rewardLabel: event.target.value }, 'Loyalty reward renamed')}
              />
            </Field>
          </div>

          <Toggle
            label="Print the offer on receipts"
            hint={`Adds “Buy ${loyalty.cupsPerReward} and get ${loyalty.rewardLabel}.” to the foot of every receipt.`}
            checked={loyalty.printOnReceipt}
            disabled={disabled}
            onChange={() =>
              change({ printOnReceipt: !loyalty.printOnReceipt }, 'Loyalty receipt line changed')
            }
          />

          <p className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-ink-muted">
            Free cups are still given at the till, per line, by whoever is serving. This says what the offer is; it
            does not keep anyone&rsquo;s balance, because the till has no record of who is buying.
          </p>
        </>
      ) : null}
    </Card>
  )
}
