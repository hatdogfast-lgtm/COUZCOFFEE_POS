import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { fromDecimal, newId, type DiscountType } from '@pos/shared'
import { Button, Field, Input } from '../components/ui/primitives.tsx'
import { useSession, useSettings } from '../app/providers.tsx'
import type { CartDiscount } from './checkout.ts'
import { cn } from '../lib/utils.ts'

/**
 * Applying a discount.
 *
 * Senior citizen and PWD concessions ask for the identification number the
 * law requires to be recorded, and are the only kinds that also lift VAT. The
 * discretionary kinds are gated on permission, so a cashier cannot discount
 * an order at will.
 */

const OPTIONS: Array<{ type: DiscountType; label: string; blurb: string; statutory: boolean }> = [
  { type: 'SENIOR', label: 'Senior Citizen', blurb: 'VAT exempt, plus the statutory rate', statutory: true },
  { type: 'PWD', label: 'PWD', blurb: 'VAT exempt, plus the statutory rate', statutory: true },
  { type: 'PERCENT', label: 'Percentage off', blurb: 'A share of the order total', statutory: false },
  { type: 'FIXED', label: 'Amount off', blurb: 'A flat reduction', statutory: false },
]

export function DiscountSheet({
  open,
  onClose,
  onApply,
}: {
  open: boolean
  onClose: () => void
  onApply: (discount: CartDiscount) => void
}) {
  const { settings } = useSettings()
  const { can, user } = useSession()
  const [type, setType] = useState<DiscountType>('SENIOR')
  const [value, setValue] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [beneficiary, setBeneficiary] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) return
    setType('SENIOR')
    setValue('')
    setReferenceNo('')
    setBeneficiary('')
    setReason('')
  }, [open])

  const selected = OPTIONS.find((option) => option.type === type)
  const statutory = selected?.statutory ?? false
  const allowed = statutory ? can('pos.discount.standard') : can('pos.discount.override')
  const statutoryRate = settings?.statutoryDiscountRate ?? 20

  const numeric = Number(value.replace(/[^\d.]/g, ''))
  const valid = statutory
    ? referenceNo.trim().length > 0 && beneficiary.trim().length > 0
    : Number.isFinite(numeric) && numeric > 0 && (type !== 'PERCENT' || numeric <= 100)

  function apply(): void {
    if (!valid || !allowed) return
    onApply({
      id: newId(),
      type,
      label: selected?.label ?? 'Discount',
      value: statutory ? statutoryRate : type === 'FIXED' ? fromDecimal(numeric) : numeric,
      referenceNo: referenceNo.trim(),
      beneficiaryName: beneficiary.trim(),
      authorizedBy: statutory ? null : (user?.id ?? null),
      reason: reason.trim(),
    })
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-overlay animate-slide-up sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-3xl sm:border sm:animate-scale-in">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="text-lg font-semibold text-ink">Apply a discount</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane flex-1 space-y-5 px-5 py-5">
            <div className="grid grid-cols-2 gap-2">
              {OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => setType(option.type)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors press',
                    type === option.type ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span className="block text-sm font-medium text-ink">{option.label}</span>
                  <span className="block text-xs text-ink-subtle">{option.blurb}</span>
                </button>
              ))}
            </div>

            {statutory ? (
              <div className="space-y-4">
                <div className="rounded-xl bg-surface-sunken px-3.5 py-3 text-[0.8125rem] text-ink-muted">
                  VAT is removed from the sale first, then {statutoryRate}% is taken off the VAT-exempt amount.
                  Both figures are printed separately on the receipt.
                </div>
                <Field label="ID number" hint="Recorded on the receipt as required.">
                  <Input
                    value={referenceNo}
                    onChange={(event) => setReferenceNo(event.target.value)}
                    placeholder="e.g. SC-123456"
                    maxLength={40}
                    autoFocus
                  />
                </Field>
                <Field label="Name on the ID">
                  <Input
                    value={beneficiary}
                    onChange={(event) => setBeneficiary(event.target.value)}
                    placeholder="Full name"
                    maxLength={80}
                  />
                </Field>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label={type === 'PERCENT' ? 'Percentage' : 'Amount'}>
                  <Input
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    inputMode="decimal"
                    placeholder={type === 'PERCENT' ? '10' : '50.00'}
                    className="tabular text-right text-lg"
                    autoFocus
                  />
                </Field>
                <Field label="Reason" hint="Kept in the audit trail.">
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="e.g. staff meal, service recovery"
                    maxLength={120}
                  />
                </Field>
              </div>
            )}

            {!allowed ? (
              <p className="rounded-xl bg-warning/10 px-3.5 py-3 text-[0.8125rem] text-warning">
                Your role cannot apply this kind of discount. A supervisor or manager needs to sign in.
              </p>
            ) : null}
          </div>

          <footer className="border-t border-line px-5 py-4 pad-safe-bottom">
            <Button size="lg" full onClick={apply} disabled={!valid || !allowed}>
              Apply discount
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
