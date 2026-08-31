import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Download, TriangleAlert, Upload } from 'lucide-react'
import {
  applyIngredients,
  applyRecipes,
  ingredientTemplate,
  INGREDIENT_COLUMNS,
  parseIngredients,
  parseRecipes,
  recipeTemplate,
  RECIPE_COLUMNS,
  type IngredientRow,
  type ParseResult,
  type RecipeRow,
} from '../../db/importing.ts'
import { Button } from '../../components/ui/primitives.tsx'
import { useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Bringing a spreadsheet in.
 *
 * The flow is deliberately upload, check, then confirm - never upload and
 * hope. Everything is validated first and the counts are shown before a single
 * row is written, because an import that half-succeeds silently is worse than
 * one that refuses.
 */

type Kind = 'INGREDIENTS' | 'RECIPES'

export function ImportPanel() {
  const { user, can } = useSession()
  const [kind, setKind] = useState<Kind>('INGREDIENTS')
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [ingredients, setIngredients] = useState<ParseResult<IngredientRow> | null>(null)
  const [recipes, setRecipes] = useState<ParseResult<RecipeRow> | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const mayImport = can('recipe.import') || can('inventory.adjust')
  const result = kind === 'INGREDIENTS' ? ingredients : recipes

  function reset(): void {
    setIngredients(null)
    setRecipes(null)
    setFileName('')
    if (input.current) input.current.value = ''
  }

  async function download(which: Kind): Promise<void> {
    try {
      const blob = which === 'INGREDIENTS' ? await ingredientTemplate() : await recipeTemplate()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = which === 'INGREDIENTS' ? 'ingredients-template.xlsx' : 'recipes-template.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('The template could not be built.')
    }
  }

  async function choose(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    setFileName(file.name)
    try {
      if (kind === 'INGREDIENTS') {
        setIngredients(await parseIngredients(file))
        setRecipes(null)
      } else {
        setRecipes(await parseRecipes(file))
        setIngredients(null)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That file could not be read.')
      reset()
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (!result || busy) return
    setBusy(true)
    try {
      if (kind === 'INGREDIENTS' && ingredients) {
        const outcome = await applyIngredients(ingredients.rows)
        toast.success(`${outcome.created} added, ${outcome.updated} updated.`)
      } else if (recipes) {
        const outcome = await applyRecipes(recipes.rows, user?.id ?? '')
        toast.success(`${outcome.recipes} recipes saved.`)
      }
      reset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The import could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  if (!mayImport) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        Your role cannot import data. A manager or owner can.
      </p>
    )
  }

  const columns = kind === 'INGREDIENTS' ? INGREDIENT_COLUMNS : RECIPE_COLUMNS

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-5">
      <div className="grid grid-cols-2 gap-2">
        {(['INGREDIENTS', 'RECIPES'] as Kind[]).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => {
              setKind(entry)
              reset()
            }}
            className={cn(
              'rounded-xl border px-4 py-3 text-left transition-colors press',
              kind === entry ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
            )}
          >
            <span className="block text-sm font-medium text-ink">
              {entry === 'INGREDIENTS' ? 'Ingredients and costs' : 'Recipes'}
            </span>
            <span className="block text-[0.8125rem] text-ink-subtle">
              {entry === 'INGREDIENTS'
                ? 'What you buy, and what it costs'
                : 'What goes into each drink or food item'}
            </span>
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-medium text-ink">1. Start from the template</h3>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">
          It has the exact column headings this reads. Paste your rows underneath and save it as .xlsx.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void download(kind)}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download the {kind === 'INGREDIENTS' ? 'ingredients' : 'recipes'} template
          </Button>
        </div>
        <div className="scroll-pane mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                {columns.map((column) => (
                  <th key={column} className="whitespace-nowrap px-2 py-1.5 font-medium text-ink-muted">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        {kind === 'RECIPES' ? (
          <p className="mt-2 text-[0.8125rem] text-ink-subtle">
            A drink name written as “Caramel Macchiato (16oz)” works too — the size in brackets is understood, so
            an existing sheet does not have to be split into two columns first.
          </p>
        ) : (
          <p className="mt-2 text-[0.8125rem] text-ink-subtle">
            Cost per unit is worked out here from the total cost and quantity, so that column can stay as the
            formula in your sheet — it is read, not trusted.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-medium text-ink">2. Upload the file</h3>
        <input
          ref={input}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void choose(event.target.files?.[0])}
          className="mt-3 block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-ink hover:file:bg-brand/90"
        />
        {fileName ? <p className="mt-2 text-[0.8125rem] text-ink-subtle">Read {fileName}.</p> : null}
      </section>

      {result ? (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-medium text-ink">3. Check before importing</h3>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <Count label="Rows found" value={result.totalRows} />
            <Count label="Ready to import" value={result.rows.length} tone="positive" />
            <Count
              label="Problems"
              value={result.problems.length}
              tone={result.problems.length > 0 ? 'danger' : 'default'}
            />
          </div>

          {result.problems.length > 0 ? (
            <div className="mt-4 space-y-1.5">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-danger">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                These rows will not be imported
              </p>
              <ul className="scroll-pane max-h-56 divide-y divide-line rounded-xl border border-line">
                {result.problems.map((problem, index) => (
                  <li key={index} className="flex gap-3 px-3 py-2 text-[0.8125rem]">
                    <span className="tabular shrink-0 text-ink-subtle">Row {problem.row}</span>
                    <span className="text-ink">{problem.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-[0.8125rem] text-positive">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Every row checks out.
            </p>
          )}

          {result.rows.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-[0.8125rem] font-medium text-ink-muted">A first look at what will be saved</p>
              <ul className="scroll-pane max-h-56 divide-y divide-line rounded-xl border border-line text-[0.8125rem]">
                {(kind === 'INGREDIENTS' ? ingredients?.rows ?? [] : []).slice(0, 40).map((row, index) => (
                  <li key={index} className="flex justify-between gap-3 px-3 py-2">
                    <span className="truncate text-ink">
                      {row.name}
                      <span className="text-ink-subtle"> · {row.totalQuantity} {row.unit}</span>
                    </span>
                    <span className="shrink-0 text-ink-muted">{row.existingId ? 'updates' : 'new'}</span>
                  </li>
                ))}
                {(kind === 'RECIPES' ? recipes?.rows ?? [] : []).slice(0, 40).map((row, index) => (
                  <li key={index} className="flex justify-between gap-3 px-3 py-2">
                    <span className="truncate text-ink">
                      {row.productName} <span className="text-ink-subtle">{row.size}</span>
                    </span>
                    <span className="shrink-0 text-ink-muted">
                      {row.ingredientName} · {row.quantity}
                      {row.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Start over
            </Button>
            <Button className="flex-1" onClick={() => void confirm()} disabled={busy || result.rows.length === 0}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              {busy
                ? 'Importing…'
                : `Import ${result.rows.length} ${kind === 'INGREDIENTS' ? 'ingredients' : 'recipe lines'}`}
            </Button>
          </div>

          {kind === 'RECIPES' ? (
            <p className="mt-2 text-[0.8125rem] text-ink-subtle">
              Importing replaces the whole recipe for each size in the file, so running it twice does not double
              anything up.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function Count({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'positive' | 'danger'
}) {
  return (
    <div className="rounded-xl bg-surface-sunken px-3 py-2.5">
      <p
        className={cn(
          'tabular text-xl font-semibold',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
    </div>
  )
}
