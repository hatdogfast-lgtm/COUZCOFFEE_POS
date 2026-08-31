import { useRef, useState } from 'react'
import { FileUp, Loader2, TriangleAlert } from 'lucide-react'
import { inspectBackup, restoreBackup, type BackupInspection } from '../../db/backup.ts'
import { Button, Card } from '../../components/ui/primitives.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Starting a device from a backup file.
 *
 * A shop whose staff have been ringing up sales on one till and who now open
 * the website on the office computer have a file and nowhere to put it: the
 * setup screen offers a new shop or a server to join, and neither is what they
 * have. Making them invent a throwaway shop first, only to overwrite it a
 * minute later, is the kind of step that makes people distrust the whole
 * thing.
 *
 * This is a REPLACE onto an empty device, which is the one case where replace
 * is the safe choice: there is nothing here to lose. Once the shop exists,
 * later files come in through Settings, where catching up and replacing are
 * offered separately and the difference matters.
 */
export function StartFromBackup({ onDone }: { onDone: () => Promise<void> | void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose(file: File | undefined): Promise<void> {
    if (!file) return
    setError(null)
    setInspection(null)
    setBusy(true)
    try {
      setInspection(await inspectBackup(file))
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That file could not be read.')
    } finally {
      setBusy(false)
    }
  }

  async function start(): Promise<void> {
    if (!inspection || busy) return
    setBusy(true)
    setError(null)
    try {
      // Nobody is signed in yet, so the restore is recorded against whoever the
      // file says the owner is - the person who took the backup.
      const owner =
        (inspection.file.tables.users ?? []).find(
          (row) => row && typeof row === 'object' && (row as { role?: string }).role === 'OWNER',
        ) ?? null

      await restoreBackup({
        inspection,
        mode: 'REPLACE',
        sync: 'STANDALONE',
        user: (owner ?? { id: 'SETUP', name: 'Setup' }) as never,
      })
      await onDone()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That backup could not be restored.')
      setBusy(false)
    }
  }

  const fatal = inspection?.problems.filter((problem) => problem.severity === 'FATAL') ?? []
  const ready = inspection !== null && fatal.length === 0

  return (
    <Card className="p-6">
      <div className="space-y-5">
        <div>
          <h2 className="text-sm font-medium text-ink">Start from a backup</h2>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Take a backup on the till your staff use — Settings, then Backup — and open the file here. Everything
            they have rung up comes across: sales, stock, staff, the menu and your settings.
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={(event) => void choose(event.target.files?.[0])}
        />

        <Button variant="secondary" full onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileUp className="h-4 w-4" aria-hidden="true" />
          {inspection ? 'Choose a different file' : 'Choose the backup file'}
        </Button>

        {inspection ? (
          <div className="space-y-3">
            <dl className="divide-y divide-line rounded-xl border border-line">
              <Line label="Taken" value={new Date(inspection.manifest.createdAt).toLocaleString()} />
              <Line label="By" value={inspection.manifest.createdByName || 'Unknown'} />
              <Line label="Records" value={inspection.totalNewHere.toLocaleString()} />
              <Line label="Sales in it" value={(inspection.file.tables.sales ?? []).length.toLocaleString()} />
            </dl>

            {fatal.length > 0 ? (
              <p className="flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-[0.8125rem] text-danger">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{fatal.map((problem) => problem.message).join(' ')}</span>
              </p>
            ) : (
              <p className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-ink-muted">
                This device is empty, so the whole file goes in as it stands. You will sign in with the same PINs
                your staff already use.
              </p>
            )}
          </div>
        ) : null}

        {error ? <p className="text-[0.8125rem] text-danger">{error}</p> : null}

        <Button size="lg" full onClick={() => void start()} disabled={!ready || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Bringing it in…' : 'Start from this backup'}
        </Button>
      </div>
    </Card>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-3.5 py-2')}>
      <dt className="text-[0.8125rem] text-ink-muted">{label}</dt>
      <dd className="tabular text-[0.8125rem] text-ink">{value}</dd>
    </div>
  )
}
