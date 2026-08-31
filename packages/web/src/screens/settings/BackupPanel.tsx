import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  DatabaseBackup,
  Download,
  Share2,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import {
  buildBackup,
  buildUpdate,
  lastUpdateSentAt,
  rememberUpdateSent,
  canRestore,
  inspectBackup,
  problemsFor,
  restoreBackup,
  saveBackup,
  type BackupInspection,
  type RestoreMode,
  type RestoreSyncChoice,
} from '../../db/backup.ts'
import { Button, Field, Input } from '../../components/ui/primitives.tsx'
import { useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Backup and restore.
 *
 * Restoring is the only thing in this application that can destroy data on
 * purpose, so the flow is built to be hard to do by accident and impossible to
 * do blindly: the file is checked first, what it holds is shown against what is
 * already here, a safety copy of the current data downloads automatically, and
 * the word REPLACE has to be typed out.
 *
 * What happens with the server afterwards is asked as a plain question rather
 * than decided quietly, because there is no answer that is right in every
 * case and the wrong one is expensive.
 */
export function BackupPanel() {
  const { user, can } = useSession()
  const [busy, setBusy] = useState(false)
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [mode, setMode] = useState<RestoreMode>('MERGE')
  const [sync, setSync] = useState<RestoreSyncChoice>('RESYNC')
  const [confirmation, setConfirmation] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const mayBackUp = can('backup.run')
  // When this device last sent one, so the next carries on from there.
  const [sentAt, setSentAt] = useState<number | null>(null)
  useEffect(() => {
    void lastUpdateSentAt().then(setSentAt)
  }, [])
  const mayRestore = can('backup.restore')

  function reset(): void {
    setInspection(null)
    setConfirmation('')
    setMode('MERGE')
    setSync('RESYNC')
    if (input.current) input.current.value = ''
  }

  /**
   * Send on what has happened since last time.
   *
   * The whole shop in one file grows for as long as the shop trades, and a
   * phone that has been selling for months makes one too big to email. This is
   * the day's work: small enough to send from a phone by any means at all.
   */
  async function sendUpdate(): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      const since = sentAt ?? 0
      const at = Date.now()
      const file = await buildUpdate(user.name, since)

      if (file.manifest.totalRows === 0) {
        toast.info('Nothing has changed since the last update file.')
        return
      }

      saveBackup(file)
      await rememberUpdateSent(at)
      setSentAt(at)
      toast.success(`${file.manifest.totalRows.toLocaleString()} changes saved to a file.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The update could not be made.')
    } finally {
      setBusy(false)
    }
  }

  async function download(): Promise<void> {
    if (!user || busy) return
    setBusy(true)
    try {
      const file = await buildBackup(user.name)
      saveBackup(file)
      toast.success(`${file.manifest.totalRows.toLocaleString()} records saved.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The backup could not be made.')
    } finally {
      setBusy(false)
    }
  }

  async function choose(chosen: File | undefined): Promise<void> {
    if (!chosen) return
    setBusy(true)
    setConfirmation('')
    try {
      setInspection(await inspectBackup(chosen))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That file could not be read.')
      reset()
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (!user || !inspection || busy) return
    setBusy(true)
    try {
      // A safety copy first, always. If this turns out to be the wrong file,
      // it is the only way back to what was here a moment ago.
      if (mode === 'REPLACE') {
        saveBackup(await buildBackup(`${user.name} (before restore)`))
      }

      const outcome = await restoreBackup({ inspection, mode, sync, user })
      toast.success(
        `${outcome.written.toLocaleString()} records restored${outcome.skipped > 0 ? `, ${outcome.skipped.toLocaleString()} already here` : ''}.`,
      )
      reset()

      // The signed-in user, the settings, the device's cached identity and the
      // sync engine's cursor were all read once at boot and may all have just
      // changed underneath the app. Starting again is the only honest way to
      // make what is on screen match what is stored.
      setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The restore could not be completed.')
      setBusy(false)
    }
  }

  if (!mayBackUp && !mayRestore) {
    return (
      <p className="px-4 py-10 text-center text-sm text-ink-muted">
        Your role cannot make or restore backups. An owner or manager can.
      </p>
    )
  }

  const relevant = inspection ? problemsFor(inspection, mode) : []
  const fatal = relevant.filter((problem) => problem.severity === 'FATAL')
  const warnings = relevant.filter((problem) => problem.severity === 'WARNING')
  const ready = inspection !== null && canRestore(inspection, mode)
  const confirmed = mode === 'MERGE' || confirmation.trim().toUpperCase() === 'REPLACE'

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        {mayBackUp ? (
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
              <Share2 className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              Send an update to another device
            </h2>
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              Just what has happened since last time — today&rsquo;s sales, any prices you changed, staff you added.
              Small enough to email, message or AirDrop from a phone.
            </p>
            <p className="mt-2 text-[0.8125rem] text-ink-subtle">
              {sentAt
                ? `Covers everything since ${new Date(sentAt).toLocaleString()}.`
                : 'The first one covers everything this device holds. After that, each covers only what is new.'}
            </p>
            <p className="mt-2 text-[0.8125rem] text-ink-subtle">
              On the other device, open it under <strong className="text-ink">Restore</strong> below and choose
              <strong className="text-ink"> Catch up with another till</strong>. A device with nothing on it yet
              needs a full backup first, not an update.
            </p>
            <Button className="mt-3" onClick={() => void sendUpdate()} disabled={busy}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Working…' : 'Save an update file'}
            </Button>
          </section>
        ) : null}

        {mayBackUp ? (
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
              <DatabaseBackup className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              Make a full backup
            </h2>
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              Every sale, recipe, ingredient, staff record and setting this device holds, written to one file you
              keep. It is plain readable JSON, checksummed so a damaged copy is caught rather than trusted.
            </p>
            <p className="mt-2 text-[0.8125rem] text-ink-subtle">
              It does not contain this terminal&rsquo;s identity or its server password, so the same file can be
              restored onto any device without two tills ending up pretending to be the same one.
            </p>
            <p className="mt-2 flex items-start gap-1.5 text-[0.8125rem] text-warning">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              It does contain scrambled staff PINs and your customer and sales history. Keep it somewhere you would
              be willing to keep the till itself.
            </p>
            <Button className="mt-3" onClick={() => void download()} disabled={busy}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Working…' : 'Download a backup'}
            </Button>
          </section>
        ) : null}

        {mayRestore ? (
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
              <Upload className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              Restore from a backup
            </h2>
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              Choose a file and you will be shown exactly what is in it, next to what is already here, before
              anything is written.
            </p>
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              onChange={(event) => void choose(event.target.files?.[0])}
              className="mt-3 block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-ink hover:file:bg-brand/90"
            />
          </section>
        ) : null}

        {inspection ? (
          <>
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="text-sm font-medium text-ink">What is in this file</h3>
              <dl className="mt-3 space-y-1 text-[0.9375rem]">
                <Line label="Business" value={inspection.manifest.businessName} />
                <Line label="Taken" value={new Date(inspection.manifest.createdAt).toLocaleString()} />
                <Line label="By" value={inspection.manifest.createdByName} />
                <Line
                  label="From"
                  value={`${inspection.manifest.deviceLabel}${inspection.fromThisDevice ? ' (this device)' : ''}`}
                />
                <Line label="Records" value={inspection.manifest.totalRows.toLocaleString()} strong />
              </dl>

              <p
                className={cn(
                  'mt-3 flex items-center gap-1.5 text-[0.8125rem]',
                  inspection.checksumOk ? 'text-positive' : 'text-danger',
                )}
              >
                {inspection.checksumOk ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    The file is intact and unaltered.
                  </>
                ) : (
                  <>
                    <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                    The file does not match its own checksum.
                  </>
                )}
              </p>

              {fatal.map((problem, index) => (
                <p key={index} className="mt-2 rounded-xl bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">
                  {problem.message}
                </p>
              ))}
              {warnings.map((problem, index) => (
                <p key={index} className="mt-2 rounded-xl bg-warning/10 px-3 py-2 text-[0.8125rem] text-warning">
                  {problem.message}
                </p>
              ))}

              <div className="scroll-pane mt-4 max-h-64 overflow-y-auto rounded-xl border border-line">
                <table className="w-full text-left text-[0.8125rem]">
                  <thead className="sticky top-0 bg-surface-sunken">
                    <tr>
                      <th className="px-3 py-2 font-medium text-ink-muted">Records</th>
                      <th className="px-3 py-2 text-right font-medium text-ink-muted">In file</th>
                      <th className="px-3 py-2 text-right font-medium text-ink-muted">Here now</th>
                      <th className="px-3 py-2 text-right font-medium text-ink-muted">New</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {inspection.comparison
                      .filter((row) => row.inFile > 0 || row.onDevice > 0)
                      .map((row) => (
                        <tr key={row.entity}>
                          <td className="px-3 py-1.5 text-ink">{labelFor(row.entity)}</td>
                          <td className="tabular px-3 py-1.5 text-right text-ink-muted">{row.inFile}</td>
                          <td className="tabular px-3 py-1.5 text-right text-ink-muted">{row.onDevice}</td>
                          <td
                            className={cn(
                              'tabular px-3 py-1.5 text-right',
                              row.newHere > 0 ? 'font-medium text-positive' : 'text-ink-subtle',
                            )}
                          >
                            {row.newHere > 0 ? `+${row.newHere}` : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="text-sm font-medium text-ink">How should it go back?</h3>

              <div className="mt-3 space-y-2">
                <Choice
                  active={mode === 'MERGE'}
                  onClick={() => setMode('MERGE')}
                  title="Add what is missing"
                  detail={`Writes only the ${inspection.totalNewHere.toLocaleString()} records this device has never seen. Nothing already here is touched or overwritten.`}
                />
                <Choice
                  active={mode === 'CATCH_UP'}
                  onClick={() => setMode('CATCH_UP')}
                  title="Catch up with another till"
                  detail="Brings in everything the other device did, and lets its later changes to prices, staff and settings win. Sales are never overwritten. Use this to keep two tills in step by passing a file between them."
                />
                <Choice
                  active={mode === 'REPLACE'}
                  onClick={() => setMode('REPLACE')}
                  title="Replace everything"
                  detail="Empties every table on this device first, then writes the file. Anything recorded since this backup was taken will be gone."
                  danger
                />
              </div>

              <h3 className="mt-5 text-sm font-medium text-ink">And then what about the server?</h3>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">
                There is no answer that is right in every case, so it is worth a moment.
              </p>

              <div className="mt-3 space-y-2">
                <Choice
                  active={sync === 'RESYNC'}
                  onClick={() => setSync('RESYNC')}
                  title="Carry on syncing as normal"
                  detail="Reads the server again from the beginning. Where the server has a record, the server's copy wins. Right when this device was the thing that broke."
                />
                <Choice
                  active={sync === 'PUSH'}
                  onClick={() => setSync('PUSH')}
                  title="This device is the surviving copy"
                  detail="Sends every restored record up to the server. Only for a server that was lost and is being rebuilt — on a working shop this overwrites the other tills with old data."
                  danger
                />
                <Choice
                  active={sync === 'STANDALONE'}
                  onClick={() => setSync('STANDALONE')}
                  title="Keep this device off the server"
                  detail="Disconnects from the server so nothing restored can ever be pushed. Right for looking at old books on a spare device."
                />
              </div>

              {mode === 'REPLACE' ? (
                <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3">
                  <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-danger">
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    This cannot be undone
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-ink-muted">
                    A copy of everything currently on this device will download first, so there is a way back. Type{' '}
                    <strong className="text-ink">REPLACE</strong> to confirm.
                  </p>
                  <Field label="" className="mt-2">
                    <Input
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      placeholder="REPLACE"
                      autoComplete="off"
                    />
                  </Field>
                </div>
              ) : null}

              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={reset} disabled={busy}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  variant={mode === 'REPLACE' ? 'danger' : 'primary'}
                  onClick={() => void confirm()}
                  disabled={busy || !ready || !confirmed}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  {busy
                    ? 'Restoring…'
                    : mode === 'REPLACE'
                      ? 'Replace everything on this device'
                      : mode === 'CATCH_UP'
                        ? 'Catch this device up'
                        : `Add ${inspection.totalNewHere.toLocaleString()} missing records`}
                </Button>
              </div>

              {!ready ? (
                <p className="mt-2 text-[0.8125rem] text-danger">
                  This file cannot be restored the way you have chosen. Read the problems above.
                </p>
              ) : (
                <p className="mt-2 text-[0.8125rem] text-ink-subtle">
                  The app will restart itself once this is done, so that what is on screen matches what is stored.
                </p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}

function Choice({
  active,
  onClick,
  title,
  detail,
  danger,
}: {
  active: boolean
  onClick: () => void
  title: string
  detail: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'block w-full rounded-xl border px-4 py-3 text-left transition-colors press',
        active
          ? danger
            ? 'border-danger bg-danger/10'
            : 'border-brand bg-brand-soft'
          : 'border-line hover:border-line-strong',
      )}
    >
      <span className={cn('block text-sm font-medium', danger && active ? 'text-danger' : 'text-ink')}>{title}</span>
      <span className="mt-0.5 block text-[0.8125rem] text-ink-muted">{detail}</span>
    </button>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right', strong ? 'font-semibold text-ink' : 'text-ink')}>{value}</dd>
    </div>
  )
}

const TABLE_LABELS: Record<string, string> = {
  settings: 'Settings',
  users: 'Staff',
  devices: 'Devices',
  categories: 'Categories',
  products: 'Menu items',
  productVariants: 'Sizes and prices',
  modifierGroups: 'Modifier groups',
  modifierOptions: 'Modifier options',
  ingredients: 'Ingredients',
  suppliers: 'Suppliers',
  inventoryMovements: 'Stock movements',
  recipes: 'Recipes',
  recipeIngredients: 'Recipe lines',
  sales: 'Sales',
  saleItems: 'Sale lines',
  saleDiscounts: 'Discounts',
  payments: 'Payments',
  shifts: 'Shifts',
  cashMovements: 'Cash movements',
  registerReadings: 'X and Z readings',
  operatingExpenses: 'Running costs',
  salesTargets: 'Sales targets',
  auditLogs: 'Audit trail',
}

function labelFor(entity: string): string {
  return TABLE_LABELS[entity] ?? entity
}
