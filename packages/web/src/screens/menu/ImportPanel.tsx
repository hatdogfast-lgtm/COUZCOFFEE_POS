import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Download, Sparkles, TriangleAlert, Upload } from 'lucide-react'
import {
  applyMenu,
  INGREDIENT_COLUMNS,
  MENU_RECIPE_COLUMNS,
  menuTemplate,
  parseMenu,
  type DrinkPlan,
  type MenuParse,
  type RecipeRow,
} from '../../db/importing.ts'
import { Button } from '../../components/ui/primitives.tsx'
import { useMoney, useSession } from '../../app/providers.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Bringing the menu in from one spreadsheet.
 *
 * The flow is deliberately upload, check, then confirm - never upload and
 * hope. Everything is validated first and what will happen is listed before
 * a single row is written: every drink the file would add to the menu is
 * named, with its price, so a typo is seen here rather than found at the till.
 */

export function ImportPanel() {
  const { user, can } = useSession()
  const money = useMoney()
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parse, setParse] = useState<MenuParse | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // Creating priced menu items is a manager's job, whatever else a role may do to stock.
  const mayImport = can('recipe.import')

  function reset(): void {
    setParse(null)
    setFileName('')
    if (input.current) input.current.value = ''
  }

  async function download(): Promise<void> {
    try {
      const blob = await menuTemplate()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'menu-template.xlsx'
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
      setParse(await parseMenu(file))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That file could not be read.')
      reset()
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (!parse || busy) return
    setBusy(true)
    try {
      const outcome = await applyMenu(parse, user?.id ?? '')
      const parts = [
        outcome.ingredients.created > 0 ? `${outcome.ingredients.created} ingredients added` : '',
        outcome.ingredients.updated > 0 ? `${outcome.ingredients.updated} updated` : '',
        outcome.products > 0 ? `${outcome.products} drinks added to the menu` : '',
        outcome.sizes > 0 ? `${outcome.sizes} sizes` : '',
        outcome.recipes > 0 ? `${outcome.recipes} recipes saved` : '',
      ].filter(Boolean)
      toast.success(parts.length > 0 ? `${parts.join(', ')}.` : 'Nothing needed importing.')
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
        Your role cannot import the menu. A manager or owner can.
      </p>
    )
  }

  const ready = parse ? parse.ingredients.rows.length + parse.recipes.rows.length : 0
  const problems = parse ? [...parse.ingredients.problems, ...parse.recipes.problems] : []
  const newDrinks = parse ? parse.drinks.filter((drink) => drink.variantId === null) : []
  const existingDrinks = parse ? parse.drinks.filter((drink) => drink.variantId !== null) : []

  // Every recipe line under its drink, so a wrong quantity or a mis-read
  // ingredient is seen here rather than found in the till's costings.
  const linesByDrink = new Map<string, RecipeRow[]>()
  for (const row of parse?.recipes.rows ?? []) {
    const list = linesByDrink.get(row.drinkKey) ?? []
    list.push(row)
    linesByDrink.set(row.drinkKey, list)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-5">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-medium text-ink">1. Start from the template</h3>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">
          One workbook, two sheets. Put what you buy on <strong>Ingredients</strong> and what goes into each
          drink on <strong>Recipes</strong>, then save it as .xlsx. It comes filled with what the shop already has.
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void download()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download the menu template
          </Button>
        </div>

        <ColumnGuide title="Ingredients sheet" columns={INGREDIENT_COLUMNS} />
        <p className="mt-2 text-[0.8125rem] text-ink-subtle">
          Cost per unit — per gram, millilitre or piece, whatever you bought it in — is worked out here from
          the total cost and quantity, so that column can stay as the formula in your sheet: it is read, not
          trusted. A row with only a name, like “ICE”, is treated as a heading and skipped.
        </p>

        <ColumnGuide title="Recipes sheet" columns={MENU_RECIPE_COLUMNS} />
        <p className="mt-2 text-[0.8125rem] text-ink-subtle">
          Write the drink as “Caramel Macchiato (16oz)” — the size in brackets is understood. A drink that is
          not on the menu yet is added to it, so give it a <strong>Selling Price</strong> on its first line and,
          if you like, a <strong>Category</strong>; blank means “Drinks”. The last three columns work themselves out.
        </p>
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
        {fileName ? (
          <p className="mt-2 text-[0.8125rem] text-ink-subtle">
            Read {fileName}
            {parse
              ? ` — ${
                  parse.sheets.ingredients && parse.sheets.recipes
                    ? 'both sheets found'
                    : parse.sheets.ingredients
                      ? 'ingredients only'
                      : 'recipes only'
                }.`
              : '.'}
          </p>
        ) : null}
      </section>

      {parse ? (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-medium text-ink">3. Check before importing</h3>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Ingredients" value={parse.ingredients.rows.length} tone="positive" />
            <Count label="Drinks" value={parse.drinks.length} tone="positive" />
            <Count label="Recipe lines" value={parse.recipes.rows.length} tone="positive" />
            <Count label="Problems" value={problems.length} tone={problems.length > 0 ? 'danger' : 'default'} />
          </div>

          {problems.length > 0 ? (
            <div className="mt-4 space-y-1.5">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-danger">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                These rows will not be imported
              </p>
              <ul className="scroll-pane max-h-56 divide-y divide-line rounded-xl border border-line">
                {problems.map((problem, index) => (
                  <li key={index} className="flex gap-3 px-3 py-2 text-[0.8125rem]">
                    <span className="tabular shrink-0 text-ink-subtle">
                      {problem.sheet} · Row {problem.row}
                    </span>
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

          {newDrinks.length > 0 || parse.newCategories.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-muted">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Will be added to the menu
              </p>
              <ul className="scroll-pane max-h-72 divide-y divide-line rounded-xl border border-line text-[0.8125rem]">
                {parse.newCategories.map((name) => (
                  <li key={`category:${name}`} className="flex justify-between gap-3 px-3 py-2">
                    <span className="text-ink">
                      {name} <span className="text-ink-subtle">· new category</span>
                    </span>
                  </li>
                ))}
                {newDrinks.map((drink) => (
                  <DrinkPreview
                    key={drink.key}
                    drink={drink}
                    lines={linesByDrink.get(drink.key) ?? []}
                    note={drink.productId === null ? `new drink in ${drink.category}` : 'new size'}
                    trailing={<span className="tabular shrink-0 font-medium text-ink">{money(drink.price ?? 0)}</span>}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {existingDrinks.length > 0 || parse.ingredients.rows.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-[0.8125rem] font-medium text-ink-muted">
                Ingredients, and drinks already on the menu
              </p>
              <ul className="scroll-pane max-h-72 divide-y divide-line rounded-xl border border-line text-[0.8125rem]">
                {existingDrinks.map((drink) => (
                  <DrinkPreview
                    key={drink.key}
                    drink={drink}
                    lines={linesByDrink.get(drink.key) ?? []}
                    note="recipe replaced"
                    trailing={<span className="shrink-0 text-ink-muted">price kept</span>}
                  />
                ))}
                {parse.ingredients.rows.map((row) => (
                  <li key={`ingredient:${row.name}`} className="flex justify-between gap-3 px-3 py-2">
                    <span className="truncate text-ink">
                      {row.name}
                      <span className="text-ink-subtle">
                        {' '}
                        · {row.totalQuantity} {row.unit}
                      </span>
                    </span>
                    <span className="shrink-0 text-ink-muted">{row.existingId ? 'cost updated' : 'new'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Start over
            </Button>
            <Button className="flex-1" onClick={() => void confirm()} disabled={busy || ready === 0}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Importing…' : `Import ${ready} ${ready === 1 ? 'row' : 'rows'}`}
            </Button>
          </div>

          {parse.recipes.rows.length > 0 ? (
            <p className="mt-2 text-[0.8125rem] text-ink-subtle">
              Importing replaces the whole recipe for each size in the file, so running it twice does not double
              anything up. Prices of sizes already on the menu are left as they are.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

/** One drink in the check step: what will happen to it, and every line that goes into it. */
function DrinkPreview({
  drink,
  lines,
  note,
  trailing,
}: {
  drink: DrinkPlan
  lines: RecipeRow[]
  note: string
  trailing: React.ReactNode
}) {
  return (
    <li className="px-3 py-2">
      <div className="flex justify-between gap-3">
        <span className="truncate text-ink">
          {drink.name} <span className="text-ink-subtle">{drink.size}</span>
          <span className="text-ink-subtle">
            {' '}
            · {note} · {lines.length} {lines.length === 1 ? 'ingredient' : 'ingredients'}
          </span>
        </span>
        {trailing}
      </div>
      <ul className="mt-1 space-y-0.5 pl-3 text-xs text-ink-muted">
        {lines.map((line) => (
          <li key={`${line.drinkKey}|${line.ingredientName}`} className="flex justify-between gap-3">
            <span className="truncate">{line.ingredientName}</span>
            <span className="tabular shrink-0">
              {line.quantity} {line.unit}
              {line.ingredientId === null ? ' · new' : ''}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}

function ColumnGuide({ title, columns }: { title: string; columns: readonly string[] }) {
  return (
    <div className="mt-3">
      <p className="text-[0.8125rem] font-medium text-ink-muted">{title}</p>
      <div className="scroll-pane mt-1 overflow-x-auto">
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
