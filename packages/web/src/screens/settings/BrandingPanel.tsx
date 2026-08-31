import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Image as ImageIcon, Trash2, Upload } from 'lucide-react'
import type { BrandingSettings } from '@pos/shared'
import { updateBranding } from '../../db/settings.ts'
import { prepareLogo } from '../../lib/image.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useSession, useSettings } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * What the shop is called and what it looks like.
 *
 * Everything here is stored on the settings record, which synchronises like
 * any other, so a logo uploaded on the office laptop is on the counter tablet
 * moments later without anyone rebuilding or redeploying anything.
 *
 * The colours and the theme are applied the instant they change, because a
 * colour you cannot see until you save is a colour you pick twice.
 */

type Draft = Pick<
  BrandingSettings,
  | 'businessName'
  | 'legalName'
  | 'tagline'
  | 'address'
  | 'contactNumber'
  | 'email'
  | 'socialLinks'
  | 'taxId'
  | 'receiptFooter'
>

const TEXT_FIELDS: Array<{ key: keyof Draft; label: string; hint?: string; max: number }> = [
  { key: 'businessName', label: 'Shop name', hint: 'In the app, on every receipt, and on the sign-in screen.', max: 80 },
  { key: 'tagline', label: 'Tagline', hint: 'Optional. Sits under the name.', max: 80 },
  { key: 'legalName', label: 'Registered name', hint: 'If it differs from the trading name. Printed on receipts.', max: 120 },
  { key: 'address', label: 'Address', max: 140 },
  { key: 'contactNumber', label: 'Contact number', max: 40 },
  { key: 'email', label: 'Email', max: 80 },
  { key: 'socialLinks', label: 'Social', hint: 'However you want it to read on a receipt.', max: 120 },
  { key: 'taxId', label: 'Tax identification number', hint: 'Printed as VAT REG TIN.', max: 40 },
  { key: 'receiptFooter', label: 'Receipt footer', hint: 'The last line before the thank-you.', max: 140 },
]

const COLOURS: Array<{ key: 'primaryColor' | 'secondaryColor' | 'accentColor'; label: string; detail: string }> = [
  { key: 'primaryColor', label: 'Primary', detail: 'Buttons, the active tab, anything the eye should land on.' },
  { key: 'secondaryColor', label: 'Secondary', detail: 'Highlights and softer accents.' },
  { key: 'accentColor', label: 'Accent', detail: 'Reserved for positive figures like profit and margin.' },
]

const THEMES: Array<{ id: BrandingSettings['theme']; label: string; detail: string }> = [
  { id: 'system', label: 'Match the device', detail: 'Follows the phone or tablet.' },
  { id: 'light', label: 'Always light', detail: 'For a bright counter.' },
  { id: 'dark', label: 'Always dark', detail: 'Easier at night, and kinder to a tablet battery.' },
]

export function BrandingPanel() {
  const { settings } = useSettings()
  const { user, can } = useSession()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const mayEdit = can('settings.edit')

  // The form follows the record until someone starts typing in it.
  useEffect(() => {
    if (!settings) return
    setDraft((current) =>
      current
        ? current
        : {
            businessName: settings.branding.businessName,
            legalName: settings.branding.legalName,
            tagline: settings.branding.tagline,
            address: settings.branding.address,
            contactNumber: settings.branding.contactNumber,
            email: settings.branding.email,
            socialLinks: settings.branding.socialLinks,
            taxId: settings.branding.taxId,
            receiptFooter: settings.branding.receiptFooter,
          },
    )
  }, [settings?.id])

  if (!settings || !draft) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>
  }

  const branding = settings.branding
  const dirty = TEXT_FIELDS.some((field) => draft[field.key] !== branding[field.key])

  async function apply(changes: Partial<BrandingSettings>, note?: string): Promise<void> {
    if (!settings || !user || busy) return
    setBusy(true)
    try {
      await updateBranding({ settings, changes, actorId: user.id })
      if (note) toast.success(note)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function chooseLogo(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    try {
      const logoDataUrl = await prepareLogo(file)
      await updateBranding({ settings: settings!, changes: { logoDataUrl }, actorId: user!.id })
      toast.success('Logo saved. It will reach your other devices on the next sync.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That image could not be used.')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        {/* ------------------------------------------------------------ logo -- */}
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Logo</h2>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Shown in the app header and printed on receipts. Shrunk automatically, because it travels to every till
            inside the settings record.
          </p>

          <div className="mt-3 flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-sunken">
              {branding.logoDataUrl ? (
                <img src={branding.logoDataUrl} alt="Shop logo" className="h-full w-full object-contain" />
              ) : (
                <ImageIcon className="h-7 w-7 text-ink-subtle" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                disabled={!mayEdit || busy}
                onChange={(event) => void chooseLogo(event.target.files?.[0])}
                className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-ink hover:file:bg-brand/90 disabled:opacity-50"
              />
              {branding.logoDataUrl ? (
                <Button
                  variant="ghost"
                  disabled={!mayEdit || busy}
                  onClick={() => void apply({ logoDataUrl: null }, 'Logo removed.')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove
                </Button>
              ) : (
                <p className="text-[0.8125rem] text-ink-subtle">
                  A square image works best. PNG keeps a transparent background.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- details -- */}
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">The shop</h2>
          <div className="mt-3 space-y-3">
            {TEXT_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} hint={field.hint}>
                <Input
                  value={draft[field.key] ?? ''}
                  maxLength={field.max}
                  disabled={!mayEdit || busy}
                  onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                />
              </Field>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              full
              disabled={!mayEdit || busy || !dirty}
              onClick={() => void apply(draft, 'Saved. Your other devices will pick this up on the next sync.')}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </Button>
            {dirty ? (
              <Button
                variant="secondary"
                onClick={() =>
                  setDraft({
                    businessName: branding.businessName,
                    legalName: branding.legalName,
                    tagline: branding.tagline,
                    address: branding.address,
                    contactNumber: branding.contactNumber,
                    email: branding.email,
                    socialLinks: branding.socialLinks,
                    taxId: branding.taxId,
                    receiptFooter: branding.receiptFooter,
                  })
                }
              >
                Undo
              </Button>
            ) : null}
          </div>
        </section>

        {/* -------------------------------------------------------- colours -- */}
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Colours</h2>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Applied as you pick them, so you can see the till in your own colours before you walk away from it.
          </p>

          <div className="mt-3 space-y-3">
            {COLOURS.map((colour) => (
              <div key={colour.key} className="flex items-center gap-3">
                <input
                  type="color"
                  value={branding[colour.key]}
                  disabled={!mayEdit || busy}
                  onChange={(event) => void apply({ [colour.key]: event.target.value })}
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-line bg-surface p-1 disabled:opacity-50"
                  aria-label={colour.label}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{colour.label}</p>
                  <p className="text-[0.8125rem] text-ink-subtle">{colour.detail}</p>
                </div>
                <code className="tabular shrink-0 text-[0.8125rem] text-ink-muted">{branding[colour.key]}</code>
              </div>
            ))}
          </div>

          <Button
            variant="ghost"
            className="mt-3"
            disabled={!mayEdit || busy}
            onClick={() =>
              void apply(
                { primaryColor: '#7A4A2C', secondaryColor: '#C18A4A', accentColor: '#168054' },
                'Back to the original colours.',
              )
            }
          >
            Reset to the original colours
          </Button>
        </section>

        {/* ---------------------------------------------------------- theme -- */}
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Light or dark</h2>
          <div className="mt-3 space-y-2">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                disabled={!mayEdit || busy}
                onClick={() => void apply({ theme: theme.id })}
                className={cn(
                  'block w-full rounded-xl border px-4 py-3 text-left transition-colors press disabled:opacity-50',
                  branding.theme === theme.id ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                )}
              >
                <span className="block text-sm font-medium text-ink">{theme.label}</span>
                <span className="block text-[0.8125rem] text-ink-muted">{theme.detail}</span>
              </button>
            ))}
          </div>
        </section>

        <p className="pb-2 text-center text-[0.8125rem] text-ink-subtle">
          Everything here is stored with the shop, not with this device — so the web app, the Android app and the
          iPhone all show the same thing once they have synced.
        </p>
      </div>
    </div>
  )
}
