# UI Redesign — Plan B: Every Remaining Screen on the Plan A Vocabulary

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the 33 `.tsx` files Plan A did not touch — Dashboard, Sales ledger, Menu (six tabs), Reports (four tabs), Staff, Settings (seven tabs), Setup, the Sync sheet, the loading state and the charts — onto the Counter vocabulary built in Plan A, put the end-of-day report and the shift reading in the Roastery voice, and retire every private copy of a chip, tab strip, toggle, select and dialog frame in favour of one shared primitive each — with `npm test` unchanged and green throughout.

**Architecture:** Plan A moved the tokens, radius scale, type and the `Sheet`; most of what is left is *class recipes* (the old `rounded-xl`/`rounded-2xl`/`rounded-full` shapes, `text-sm font-medium` headings, hand-rolled `<select>`s and tinted-text notices) plus ten dialogs that still carry their own Radix scaffold. Task 0 adds the missing shared pieces to `primitives.tsx` — `Chip`, `TabStrip`, `SearchInput`, `Select`, `Textarea`, `Toggle`, `Choice`, `Notice`, `Panel`, `LineRow`, `Loading`, and an `actions` slot on `Sheet` — so every later task is a substitution against a named primitive rather than a fresh invention. Screens are then rebuilt one navigation entry at a time, each ending with typecheck, tests, a look at three widths, and a commit. The two Roastery surfaces (`EndOfDayPanel`, `ReadingSheet`) get structural rewrites in the register the receipt and lock screen already use: Fraunces headings, letterspaced micro-labels, dotted leaders, hairlines.

**Tech Stack:** React 18, Tailwind 3.4, class-variance-authority, Radix Dialog + Radix Switch (already in `package.json`), lucide-react, IBM Plex Sans / Plex Mono / Fraunces via `@fontsource` (installed in Plan A), Vitest.

**Spec:** `docs/rework/ui-redesign.md` (palette, contrast rules, responsive system, scope, "Not yet built — Plan B") and `docs/rework/README.md` (the logic freeze). Direction confirmed 2026-09-12: hybrid — Counter on everything worked, Roastery on everything read. Plan A: `docs/superpowers/plans/2026-09-12-ui-redesign-a-foundation-till.md`. Mockups: `https://claude.ai/code/artifact/f08ab82d-344b-47b0-a56e-11facc990df9`.

## Global Constraints

- **No `.ts` file changes.** None. Plan A took its one declared exception (`seed.ts`); this plan takes none. `packages/shared`, `packages/server`, every `*.test.ts`, `src/db/**`, `src/sync/**`, `src/print/**`, `src/lib/**`: untouched. `src/app/providers.tsx` is plumbing and is not touched.
- `npm test` (from `packages/web`) must pass **unchanged** at the end of every task — the same *Test Files* and *Tests* counts as the baseline recorded in Task 0 Step 0. `npm run typecheck` clean at the end of every task. `npm run contrast` exits 0 (nothing here changes tokens, so it cannot regress; run it anyway in Task 0 and Task 8).
- **Behaviour does not change.** Every prop, handler, `useState`, `useEffect`, `useLiveQuery`, permission check (`can(...)`), toast, `disabled` condition, `autoFocus`, `maxLength`, `inputMode`, `aria-*` and `role` in a rewritten file is carried over; only markup and classes change. When a step says "replace the frame", the JSX *inside* the frame is moved, not rewritten. When a local component is deleted in favour of a shared one, every call site's props map 1:1 and the mapping is written out in the step.
- **Contrast rules (from the spec, unchanged):** Caramel (`accent`) and Honey (`honey`) are fills only — never text, never a small icon. Words that must read as a warning use `text-warning` (`#8A6314` light), never `text-honey`. Coloured notices are `text-ink` on a tinted ground with a coloured left rule (the `Notice` primitive) — **not** `text-danger` on `bg-danger/10` and **not** `text-warning` on `bg-warning/10`, both of which lose ~10% of their ratio over their own tint. Tinted badges keep the 10% tint at most. Cards have a real border (`border-line`); nothing is told from the page by fill alone.
- **Shape and type (from Plan A):** 6px on things tapped in a rush (`rounded-md`: chips, tiles, inputs, buttons), 8px on cards (`rounded-lg`), 12px only on sheets. Hairlines, not shadows. Section headings are `Micro` (11px, letterspaced, uppercase). Every money figure and count that sits in a column is `Money` / `.figure` (Plex Mono, tabular). Fraunces (`font-display`) appears **only** on the two Roastery surfaces in this plan — `EndOfDayPanel` and `ReadingSheet` — and nowhere else.
- **Legacy shapes are gone when this plan ends.** The acceptance grep in Task 8 Step 5 spells out the exact commands: no `rounded-full border` chips, no `rounded-t-3xl`/`rounded-3xl`, no `bg-black/45` scrims, no `Dialog.Root` outside `primitives.tsx`, no `bg-warning/10` or `bg-danger/10` under `src/screens`, no `<select` outside `primitives.tsx`.
- Responsive: `< 640px` phone, `640–1024px` tablet, `≥ 1024px` laptop. Tailwind `sm` = 640, `lg` = 1024. Panels that are read (`max-w-2xl` / `max-w-3xl` centred columns) keep their column; lists that are worked (ledger, products, stock) stay full-bleed.
- Commit after each task with the message given. Do not commit `docs/`, `dist/`, or `android/app/build/`.
- All commands run from `packages/web`.
- **The look step.** Each task ends with a look in the Browser pane: `preview_start` with `name: "web"` (from `.claude/launch.json`, port 5173), then `resize_window` to `mobile` (375), `{width: 820, height: 1100}` (tablet), and `desktop`, in both `colorScheme: "light"` and `"dark"`. First run on a fresh profile lands on Setup: pick *Start fresh*, business name `Couz Coffee`, owner `Owner`, PIN `1234`, keep *Start with an example coffee menu* on, then sign in with `1234`. Take a screenshot at each width; the step says what to check.

---

### Task 0: Baseline, the shared vocabulary, the loading state, the charts

**Files:**
- Modify: `src/components/ui/primitives.tsx` (append new exports; add one prop to `Sheet`)
- Modify: `src/App.tsx:67-73` (the loading state)
- Modify: `src/components/charts/Charts.tsx` (`ColumnChart` empty state and tooltip; `BarList` figure; `StatTile`; `HeroFigure`)

**Interfaces:**
- Consumes: `cn` from `src/lib/utils.ts`; `Button`, `Micro`, `Money`, `Spinner`, `Sheet` already in `primitives.tsx`; `@radix-ui/react-switch` (in `package.json`; Step 1 confirms it is installed).
- Produces (every later task imports from `'../components/ui/primitives.tsx'` or `'../../components/ui/primitives.tsx'`):
  - `Chip({ active, onClick, children, disabled?, size?: 'sm' | 'md', className? })`
  - `TabStrip<T extends string>({ tabs: ReadonlyArray<{ id: T; label: string }>, active: T, onChange: (id: T) => void })`
  - `SearchInput({ value, onChange: (next: string) => void, placeholder?, autoFocus?, className? })`
  - `Select` — `forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'sm' | 'md' }>`; `className` sizes the wrapper
  - `Textarea` — `forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>`
  - `Toggle({ label, hint?, checked, disabled?, onChange: (next: boolean) => void, className? })` — a Radix `Switch`, `role="switch"`
  - `Choice({ active, onClick, title, detail?, icon?, disabled?, danger?, className? })` — the option tile
  - `Notice({ tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'positive', icon?, children, className?, ...div props })`
  - `Panel({ title?, note?, icon?, actions?, level?: 2 | 3, flush?, children, className? })` — a bordered section with a `Micro` heading
  - `LineRow({ label, value, note?, tone?: 'positive' | 'danger', strong?, muted?, leader?, className? })` — one `dt`/`dd` line; **must sit inside a `<dl>`**
  - `Loading({ label? })`
  - `Sheet` gains `actions?: ReactNode`, rendered in the header between the title block and the close button.

- [ ] **Step 0: Record the baseline**

Run: `git status --short` — expect only `?? ../../.claude/` and `?? ../../docs/`. If anything else is listed, stop and ask the owner.

Run: `npm test` and write down the last two summary lines (`Test Files  N passed (N)` and `Tests  M passed (M)`). Those two numbers are the acceptance criterion for every task in this plan. Run `npm run typecheck` — expect no output. Run `npm run contrast` — expect exit 0.

- [ ] **Step 1: Confirm Radix Switch is installed**

Run from the repo root: `ls node_modules/@radix-ui/react-switch/package.json`. Expected: the path prints. If it does not, run `npm install` from the repo root and check again — the package is already declared in `packages/web/package.json`, so no dependency is added.

- [ ] **Step 2: Extend `src/components/ui/primitives.tsx`**

Change the imports at the top of the file to:

```tsx
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '../../lib/utils.ts'
```

In `Sheet`, add the `actions` prop. The props type gains one entry after `footer?: ReactNode`:

```tsx
  /** Header controls beside the close button - an edit pencil, a print icon. */
  actions?: ReactNode
```

and the destructuring gains `actions,` after `footer,`. In the header JSX, the `<Dialog.Close asChild>…</Dialog.Close>` block becomes:

```tsx
            <div className="flex shrink-0 items-center gap-1">
              {actions}
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close" disabled={closeDisabled}>
                  <X className="h-5 w-5" aria-hidden="true" />
                </Button>
              </Dialog.Close>
            </div>
```

Then append the following at the end of the file:

```tsx
/**
 * The pieces every screen after the till turned out to need.
 *
 * Each of these existed three or four times over as a private copy in a
 * screen, drifting a little each time. One copy here means one shape - the
 * Counter shape: 6px corners, a firm hairline, ink on cream - and one place
 * the contrast rules are applied.
 */

/** A filter chip. Solid espresso when it is the one in force. */
export function Chip({
  active,
  onClick,
  children,
  disabled = false,
  size = 'md',
  className,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-md border font-semibold transition-colors press no-select disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'px-2.5 py-1 text-[0.6875rem]' : 'px-3 py-1.5 text-xs',
        active
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-line-strong bg-surface text-ink-muted hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** The row of tabs under the chrome on Menu, Reports and Settings. */
export function TabStrip<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: ReadonlyArray<{ id: T; label: string }>
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="shrink-0 border-b border-line bg-surface px-3">
      <div role="tablist" className="scroll-pane -mx-1 flex gap-1 overflow-x-auto px-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'micro shrink-0 border-b-2 px-3 pb-2.5 pt-3 transition-colors no-select',
              active === tab.id ? 'border-brand text-brand' : 'border-transparent text-ink-subtle hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The search box the till already has, for every other list. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus = false,
  className,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
        aria-hidden="true"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="h-10 w-full rounded-md border border-line-strong bg-surface pl-9 pr-9 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ink-subtle hover:bg-surface-sunken"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

/** The native `size` (rows shown) is dropped: nothing here is a list box, and the name is wanted for height. */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** `sm` is 40px, for a select sitting in a dense row. */
  size?: 'sm' | 'md'
}

/**
 * A native select in the Input's clothes. The browser draws the list, which
 * is the right call on a phone; the chevron is ours because the native one
 * cannot be recoloured. `className` sizes the wrapper, so `w-20` works.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, size = 'md', ...props }, ref) => (
  <span className={cn('relative block', className)}>
    <select
      ref={ref}
      className={cn(
        'w-full appearance-none rounded-md border border-line-strong bg-surface pl-3.5 pr-8 text-[0.9375rem] text-ink',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-50 transition-colors',
        size === 'sm' ? 'h-10 text-sm' : 'h-11',
      )}
      {...props}
    />
    <ChevronDown
      className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
      aria-hidden="true"
    />
  </span>
))
Select.displayName = 'Select'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-md border border-line-strong bg-surface px-3.5 py-2.5 text-[0.9375rem] text-ink',
        'placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
        'disabled:opacity-50 transition-colors',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

/** A labelled switch. On is espresso, like every other selected thing. */
export function Toggle({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
  className,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="block text-[0.8125rem] text-ink-subtle">{hint}</span> : null}
      </span>
      <SwitchPrimitive.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
        className="relative h-6 w-11 shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-brand disabled:opacity-50"
      >
        <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-surface shadow-card transition-transform data-[state=checked]:translate-x-[1.375rem]" />
      </SwitchPrimitive.Root>
    </div>
  )
}

/** One of a few options laid out as tiles: a role, a paper width, a basis. */
export function Choice({
  active,
  onClick,
  title,
  detail,
  icon,
  disabled = false,
  danger = false,
  className,
}: {
  active: boolean
  onClick: () => void
  title: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  /** A destructive choice: berry when chosen, so it cannot be mistaken. */
  danger?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors press disabled:pointer-events-none disabled:opacity-50',
        active
          ? danger
            ? 'border-danger bg-danger/10'
            : 'border-brand bg-brand-soft'
          : 'border-line-strong bg-surface hover:bg-surface-sunken',
        className,
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0 text-ink-muted">{icon}</span> : null}
      <span className="min-w-0">
        <span className={cn('block text-sm font-medium', danger && active ? 'text-danger' : 'text-ink')}>{title}</span>
        {detail ? <span className="block text-[0.8125rem] text-ink-subtle">{detail}</span> : null}
      </span>
    </button>
  )
}

const noticeStyles = cva('rounded-md border-l-2 px-3.5 py-2.5 text-[0.8125rem] text-ink', {
  variants: {
    tone: {
      neutral: 'border-line-strong bg-surface-sunken',
      info: 'border-brand bg-brand-soft',
      /** Honey is a fill, so the rule is honey and the words are ink. */
      warning: 'border-honey bg-honey/15',
      danger: 'border-danger bg-danger/10',
      positive: 'border-positive bg-positive/10',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface NoticeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof noticeStyles> {
  icon?: ReactNode
}

/**
 * A short notice. Ink on a tint with a coloured rule, because text in the
 * tone's own colour over its own tint is the one pair the contrast script
 * cannot measure and the one that loses.
 */
export function Notice({ tone, icon, className, children, ...props }: NoticeProps) {
  return (
    <div className={cn(noticeStyles({ tone }), icon && 'flex items-start gap-2', className)} {...props}>
      {icon ? <span className="mt-0.5 shrink-0 text-ink-muted">{icon}</span> : null}
      {icon ? <span className="min-w-0 flex-1">{children}</span> : children}
    </div>
  )
}

/** A bordered section with a micro heading. `flush` lets a list run edge to edge. */
export function Panel({
  title,
  note,
  icon,
  actions,
  level = 2,
  flush = false,
  children,
  className,
}: {
  title?: ReactNode
  note?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  level?: 2 | 3
  flush?: boolean
  children: ReactNode
  className?: string
}) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {title ? (
        <header
          className={cn(
            'flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5',
            flush ? 'border-b border-line pb-3' : 'pb-1',
          )}
        >
          <div className="min-w-0">
            <Heading className="micro flex items-center gap-1.5 text-ink">
              {icon ? <span className="text-ink-subtle">{icon}</span> : null}
              {title}
            </Heading>
            {note ? <p className="mt-1 text-[0.8125rem] text-ink-muted">{note}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? '' : cn('px-4 pb-4', title ? 'pt-2' : 'pt-4')}>{children}</div>
    </section>
  )
}

/**
 * One line of a statement: a label and a figure. Inside a `<dl>`.
 * `leader` draws the dotted rule of a menu board between them - the
 * Roastery surfaces use it; nothing worked at a rush does.
 */
export function LineRow({
  label,
  value,
  note,
  tone,
  strong = false,
  muted = false,
  leader = false,
  className,
}: {
  label: ReactNode
  value: string
  /** A short qualifier after the label, in the warning colour. */
  note?: string
  tone?: 'positive' | 'danger'
  strong?: boolean
  muted?: boolean
  leader?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', className)}>
      <dt className={cn('min-w-0 text-sm', strong ? 'font-medium text-ink' : muted ? 'text-ink-subtle' : 'text-ink-muted')}>
        {label}
        {note ? <span className="text-warning"> · {note}</span> : null}
      </dt>
      {leader ? <span className="mb-1 min-w-3 flex-1 border-b border-dotted border-line-strong" aria-hidden="true" /> : null}
      <dd className="shrink-0">
        <Money
          className={cn(
            'text-sm',
            strong && 'font-semibold',
            tone === 'positive'
              ? 'text-positive'
              : tone === 'danger'
                ? 'text-danger'
                : muted
                  ? 'text-ink-muted'
                  : 'text-ink',
          )}
        >
          {value}
        </Money>
      </dd>
    </div>
  )
}

/** The wait between a screen mounting and its first query answering. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 py-16 text-sm text-ink-muted" role="status">
      <Spinner />
      {label}
    </div>
  )
}
```

- [ ] **Step 3: The loading state in `src/App.tsx`**

Lines 67–73 become:

```tsx
  if (phase === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-brand">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }
```

(One class: `text-ink-muted` → `text-brand`. The spinner is the first thing anyone sees and should already be the shop's colour.)

- [ ] **Step 4: `src/components/charts/Charts.tsx`**

Four substitutions, in order:

| Line | Old | New |
|---|---|---|
| 56 | `'flex items-center justify-center rounded-xl bg-surface-sunken text-sm text-ink-subtle'` | `'flex items-center justify-center rounded-md border border-dashed border-line-strong text-sm text-ink-subtle'` |
| 122 | `rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-raised` | `rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-xs shadow-raised` |
| 123 | `<span className="block font-medium text-ink tabular">` | `<span className="figure block font-medium text-ink">` |
| 199 | `<span className="tabular text-sm font-medium text-ink">{row.display}</span>` | `<span className="figure text-sm font-medium text-ink">{row.display}</span>` |

Then replace `StatTile` (lines 214–247) with:

```tsx
/**
 * A headline figure.
 *
 * The dashboard leads with numbers, not charts: a single current value is a
 * stat tile's job, and a one-bar chart would say less in more space.
 */
export function StatTile({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'positive' | 'danger'
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5">
      <p className="micro text-ink-subtle">{label}</p>
      <p
        className={cn(
          'figure mt-1 text-2xl font-semibold',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
      {detail ? <p className="mt-0.5 text-[0.8125rem] text-ink-muted">{detail}</p> : null}
    </div>
  )
}
```

and `HeroFigure` (lines 249–266) with:

```tsx
/** The one number the dashboard leads with. */
export function HeroFigure({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: ReactNode
}) {
  return (
    <div>
      <p className="micro text-ink-subtle">{label}</p>
      <p className="figure mt-1 text-[2.75rem] font-semibold leading-none text-ink">{value}</p>
      {detail ? <div className="mt-2 text-sm text-ink-muted">{detail}</div> : null}
    </div>
  )
}
```

(The old comment argued for proportional digits on a standalone number. Plan A decided every figure is Plex Mono; the till already does this and the dashboard should not disagree with the till.)

- [ ] **Step 5: Typecheck, tests, contrast**

Run: `npm run typecheck` — expect no output. Run: `npm test` — expect the Step 0 counts. Run: `npm run contrast` — expect exit 0.

- [ ] **Step 6: Look**

Open the preview. Nothing visible has changed yet beyond the loading spinner's colour and the dashboard's stat tiles (Reports → Dashboard): the tile labels are now micro-caps and the figures monospaced. Confirm the tiles still read at 375px (two columns) and that the tooltip on the revenue chart shows a mono figure.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/primitives.tsx src/App.tsx src/components/charts/Charts.tsx
git commit -m "Shared chips, tabs, search, selects, toggles, choices, notices, panels and line rows on the Counter tokens

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1: The dashboard and the profit and loss

**Files:**
- Modify: `src/screens/DashboardScreen.tsx`
- Modify: `src/screens/reports/ProfitAndLoss.tsx`

**Interfaces:**
- Consumes: `Chip`, `Loading`, `Notice`, `Panel`, `Money`, `Select`, `Choice`, `LineRow` from Task 0; `StatTile`, `HeroFigure`, `ColumnChart`, `BarList` from Task 0's `Charts.tsx`.
- Behaviour preserved: `preset` / `ranking` state, the `lastGood` ref and `settling` opacity, `TILE_COLUMNS`, every `useLiveQuery`, `ExpenseForm`'s state and its save call, the delete confirm.

- [ ] **Step 1: `DashboardScreen.tsx`**

Import line 16 becomes `import { Badge, Chip, Loading, Money, Notice, Panel } from '../components/ui/primitives.tsx'`.

Line 112: `return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading…</div>` → `return <Loading />`.

Lines 200–218 (the sticky filter row) become:

```tsx
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-3 py-2.5">
        <div className="scroll-pane -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {RANGE_PRESETS.filter((entry) => entry !== 'CUSTOM').map((entry) => (
            <Chip key={entry} active={preset === entry} onClick={() => setPreset(entry)}>
              {RANGE_LABELS[entry]}
            </Chip>
          ))}
        </div>
      </div>
```

Lines 262–283 (the two explanatory paragraphs): each `<p className="rounded-xl bg-surface-sunken px-4 py-3 text-[0.8125rem] text-ink-muted">` becomes `<Notice tone="neutral">` with a matching `</Notice>`; the inner `<span className="font-medium text-ink">` spans stay. (The `Notice` is `text-ink`; the surrounding words move from muted to ink, which is the point — they are explanations, not captions.)

The five `<section className="rounded-2xl border border-line bg-surface p-4">` blocks (lines 287, 312, 334, 348, 370) become `Panel`s. The heading `<h2>`s and their `mb-4` wrappers are removed — `Panel` renders the heading:

- Revenue chart (287–309):
```tsx
        <Panel
          title={`Revenue by ${analytics.range.granularity === 'HOUR' ? 'hour' : 'day'}`}
          actions={
            analytics.peak ? (
              <p className="text-[0.8125rem] text-ink-muted">
                Busiest: <span className="font-medium text-ink">{analytics.peak.label}</span> ·{' '}
                <Money className="text-ink">{money(analytics.peak.revenue)}</Money>
              </p>
            ) : undefined
          }
        >
          {/* the existing <ColumnChart …/> with its props unchanged */}
        </Panel>
```
- Top products (312–332): `<Panel title="Top products" actions={<div className="flex gap-0.5 rounded-md border border-line-strong bg-surface p-0.5">…</div>}>` — the four ranking buttons keep their `key`, `onClick` and labels; their class becomes `cn('rounded-sm px-2 py-1 text-xs font-semibold transition-colors', ranking === entry.value ? 'bg-brand text-brand-ink' : 'text-ink-subtle hover:text-ink')`. Body: the existing `<BarList rows={productRows} emptyMessage="No products sold in this period." />`.
- Revenue by category (334–346): `<Panel title="Revenue by category">` around the unchanged `BarList`.
- How people paid (348–368): `<Panel title="How people paid">` around the unchanged `BarList` and the unchanged unverified paragraph.
- Staff (370–382): `<Panel title="Staff">` around the unchanged `BarList`.

`cn` stays imported (the `TILE_COLUMNS` grid, the `settling` wrapper and the ranking buttons use it).

- [ ] **Step 2: `ProfitAndLoss.tsx`**

Import line 20 becomes `import { Button, Choice, Field, Input, LineRow, Money, Notice, Panel, Select } from '../../components/ui/primitives.tsx'`.

Replace the outer frame. Line 67 `<section className="rounded-2xl border border-line bg-surface">` and the `<header>` at 68–79 become:

```tsx
    <Panel
      title="Profit and loss"
      note={analytics.range.label}
      flush
      actions={/* the existing "Add expense" Button, moved here verbatim with its permission guard and onClick */}
    >
```

and the closing `</section>` becomes `</Panel>`. The body `div` at 81 keeps `px-4 py-4` and gains a `<dl className="space-y-0.5">` wrapper around every `Line`/`Total` (the `LineRow`s below need a `dl` parent; the paragraphs and the warning notice sit outside the `dl`, after it).

Lines 127–129: `<p className="mt-3 flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-3 text-[0.8125rem] text-warning">` + its icon → `<Notice tone="warning" className="mt-3" icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}>` … `</Notice>` (the icon's `mt-0.5 shrink-0` classes are now the `Notice`'s job).

Line 140: `<h3 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle">` → `<h3 className="micro mb-2 text-ink-subtle">`.

Line 157: `<span className="tabular text-sm text-ink">{money(expense.amount)}</span>` → `<Money className="text-sm text-ink">{money(expense.amount)}</Money>`. Line 166: `rounded-lg p-1.5` → `rounded-sm p-1.5`.

Replace every `Line` and `Total` call site with `LineRow`, then delete the local `Line` (184–203) and `Total` (205–236):

| Old | New |
|---|---|
| `<Line label={…} value={…} />` | `<LineRow label={…} value={…} />` |
| `<Line label={…} value={…} muted />` | `<LineRow label={…} value={…} muted />` |
| `<Line label={…} value={…} strong />` | `<LineRow label={…} value={…} strong />` |
| `<Total label={…} value={…} detail={…} tone={…} />` | `<LineRow label={<span>{…label}<span className="block text-[0.8125rem] font-normal text-ink-subtle">{…detail}</span></span>} value={…} strong tone={…} className="mt-2 border-t border-line pt-2" />` |
| `<Total … emphasis />` | the same, with `className="mt-2 border-t border-line-strong pt-2 [&_dd_span]:text-base"` |

(`Total`'s `tone` was `'positive' | 'danger' | undefined`; `LineRow` takes the same union.)

In `ExpenseForm` (238–): line 281 `<h3 className="text-sm font-medium text-ink">` → `<h3 className="micro text-ink">`. The category buttons at 287–303 are chips, not tiles: the grid `<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">` becomes `<div className="flex flex-wrap gap-1.5">` and each `<button …>` becomes `<Chip key={entry.id} active={chosen?.code === entry.code} onClick={() => setCategory(entry.code)}>{entry.name}</Chip>` (swap `Choice` for `Chip` in this file's import). The `<select>` at 332–345 becomes `<Select value={…} onChange={…}>` with the same `<option>`s and the same handlers.

- [ ] **Step 3: Typecheck, tests**

Run: `npm run typecheck` — no output. Run: `npm test` — baseline counts.

- [ ] **Step 4: Look**

Reports → Dashboard at 375 / 820 / desktop, light and dark. Check: the range chips are 6px squares, not pills; every section heading is micro-caps; the P&L totals are mono and right-aligned in one column; the warning about uncosted sales is ink on a honey tint with a honey rule; in dark the tint still reads; tap *Add expense* and confirm the kind tiles and the *Who for?* select render.

- [ ] **Step 5: Commit**

```bash
git add src/screens/DashboardScreen.tsx src/screens/reports/ProfitAndLoss.tsx
git commit -m "Dashboard and profit and loss on Panel, Chip, Notice and LineRow

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The sales ledger and the sale sheet

**Files:**
- Modify: `src/screens/LedgerScreen.tsx`
- Rewrite the frame of: `src/screens/ledger/SaleSheet.tsx`

**Interfaces:**
- Consumes: `Chip`, `SearchInput`, `Select`, `Loading`, `Notice`, `LineRow`, `Money`, `Sheet`, `Toggle` from Task 0.
- Behaviour preserved: all four filters and the `filters` memo; the `live` query keeping the open sheet fresh; `SaleSheet`'s `mode`/`reason`/`returnStock`/`refundMethod`/`quantities`/`busy` state, the reset effect, `reprint`, `doVoid`, `doRefund`, every `disabled` expression, the `title` tooltips on Void/Refund, `autoFocus` on the void reason.

- [ ] **Step 1: `LedgerScreen.tsx`**

Import line 8 becomes `import { Badge, Chip, EmptyState, Loading, Money, SearchInput, Select } from '../components/ui/primitives.tsx'`. Line 3 becomes `import { Receipt } from 'lucide-react'`.

Lines 73–95 (the outer filter block's opening and the search box) become:

```tsx
      <div className="shrink-0 space-y-2.5 border-b border-line bg-surface px-3 py-2.5">
        <SearchInput value={query} onChange={setQuery} placeholder="Receipt, queue number, customer or item" />
```

Lines 97–103: `gap-2` → `gap-1.5`; the `<Chip>` usages stay as written — the shared `Chip` has the same props as the local one, which is deleted (207–230).

Lines 107–130: each `<select … className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:border-brand focus:outline-none">` becomes `<Select size="sm" className="w-auto min-w-[9rem]" value={…} onChange={…}>` with the same options.

Lines 133–136: `<span className="tabular font-medium text-ink">{money(takings)}</span>` → `<Money className="font-medium text-ink">{money(takings)}</Money>`.

Line 142: the Loading div → `<Loading />`.

Lines 162–164: `font-mono text-[0.8125rem] text-ink` → `figure text-[0.8125rem] text-ink`; `tabular text-xs text-ink-subtle` → `figure text-xs text-ink-subtle`.

Lines 182–193: `<span className={cn('tabular shrink-0 text-[0.9375rem] font-medium', …)}>` → `<Money className={cn('shrink-0 text-[0.9375rem] font-medium', …)}>` with the same three-way tone expression, and `</span>` → `</Money>`.

- [ ] **Step 2: `SaleSheet.tsx` — the frame**

Import line 19 becomes `import { Badge, Button, Field, Input, LineRow, Money, Notice, Select, Sheet, Toggle } from '../../components/ui/primitives.tsx'`. Delete `import * as Dialog from '@radix-ui/react-dialog'` and drop `X` from the lucide import.

Replace lines 166–188 (from `return (` through the body `div`'s opening tag) and lines 421–471 (from the body `div`'s closing tag through the end of the return) so the return reads:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="side"
      dismissible={!busy}
      closeDisabled={busy}
      title={<Money className="text-base">{sale.receiptNo}</Money>}
      description={
        <>
          {new Date(sale.occurredAt).toLocaleDateString()} {clockTime(sale.occurredAt)}
          {sale.queueNo ? ` · queue ${sale.queueNo}` : ''}
        </>
      }
      footer={
        mode === 'VIEW' ? (
          <div className="space-y-2">
            {/* the three existing footer children, moved verbatim: the Reprint button
                with its can('pos.reprint') guard, the Void/Refund grid, the
                "A supervisor or manager…" line */}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {/* the existing body children, from the badge row to the REFUND section,
            moved verbatim except for the substitutions in Step 3 */}
      </div>
    </Sheet>
  )
```

The old `onOpenChange={(next) => !next && !busy && onClose()}` is `dismissible={!busy}`; the old close button's `disabled={busy}` is `closeDisabled={busy}`. `Sheet`'s footer carries its own `pad-safe-bottom`, so the old footer classes go.

- [ ] **Step 3: `SaleSheet.tsx` — the body**

| Line | Old | New |
|---|---|---|
| 205–209 | `<p className="rounded-xl bg-danger/10 px-3.5 py-3 text-[0.8125rem] text-danger">` … `</p>` | `<Notice tone="danger">` … `</Notice>` |
| 212–216 | `<p className="rounded-xl bg-warning/10 px-3.5 py-3 text-[0.8125rem] text-warning">` … `</p>` | `<Notice tone="warning">` … `</Notice>` |
| 220 | `<h3 className="text-[0.8125rem] font-medium text-ink-muted">Items</h3>` | `<h3 className="micro text-ink-subtle">Items</h3>` |
| 222 | `rounded-xl border border-line px-3.5 py-3 text-sm text-ink-muted` | `rounded-md border border-line px-3.5 py-3 text-sm text-ink-muted` |
| 229 | `divide-y divide-line rounded-xl border border-line` | `divide-y divide-line rounded-md border border-line` |
| 243 | `<span className="tabular shrink-0 text-sm text-ink">…</span>` | `<Money className="shrink-0 text-sm text-ink">…</Money>` |
| 250 | `<dl className="space-y-1.5 text-sm">` | `<dl className="space-y-0.5">` |
| 251–259 | every `<Row … />` | `<LineRow … />` with identical props (`label`, `value`, `tone`) |
| 261–264 | the Total `div` | `<LineRow label="Total" value={money(sale.total)} strong className="mt-1 border-t border-line-strong pt-2 [&_dd_span]:text-base" />` |
| 265–272 | `<Row … note={…} />` | `<LineRow … note={…} />` |
| 277 | `text-[0.8125rem] font-medium text-ink-muted` | `micro text-ink-subtle` |
| 278 | `rounded-xl border border-line` | `rounded-md border border-line` |
| 282 | `font-mono text-xs text-ink` | `figure text-xs text-ink` |
| 288 | `<span className="tabular shrink-0 text-danger">…</span>` | `<Money className="shrink-0 text-danger">…</Money>` |
| 297 | `space-y-4 rounded-2xl border border-danger/30 bg-danger/5 p-4` | `space-y-4 rounded-md border-l-2 border-danger bg-danger/5 p-4` |
| 329 | `space-y-4 rounded-2xl border border-warning/40 bg-warning/5 p-4` | `space-y-4 rounded-md border-l-2 border-honey bg-honey/10 p-4` |
| 336 | `flex items-center gap-2 rounded-xl bg-surface px-3 py-2` | `flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2` |
| 353 | `tabular w-6 text-center text-sm font-medium text-ink` | `figure w-6 text-center text-sm font-medium text-ink` |
| 379–389 | the `<select …>` | `<Select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as PaymentMethod)}>` + the same options |
| 398–401 | the Refunding line | `<div className="flex items-baseline justify-between border-t border-line pt-3"><span className="micro text-ink-subtle">Refunding</span><Money className="text-xl font-semibold text-ink">{money(proposed.amount)}</Money></div>` |

Replace both `<StockToggle checked={returnStock} onChange={setReturnStock} hint="…" />` with

```tsx
                <Toggle
                  label="Put the stock back"
                  hint="…the same hint string as before…"
                  checked={returnStock}
                  onChange={setReturnStock}
                  className="rounded-md border border-line bg-surface p-3"
                />
```

Delete the local `Row` (474–494) and `StockToggle` (496–525). Run `grep -c "cn(" src/screens/ledger/SaleSheet.tsx`; the refund-line `disabled` expressions do not use it but the `Money` tone on the ledger row did — if the count is 0, drop the `cn` import.

- [ ] **Step 4: Typecheck, tests**

Run: `npm run typecheck`. Run: `npm test` — baseline counts.

- [ ] **Step 5: Look**

Sales tab at three widths. Ring up one sale on the till first so there is a row. Check: the search box matches the till's; the chips are squares; the selects show our chevron; a row's receipt number is mono; open a sale — on the phone it is a bottom sheet, on tablet/laptop it docks right; the void and refund panels have a coloured left rule and dark text; the stock toggle is a real switch.

- [ ] **Step 6: Commit**

```bash
git add src/screens/LedgerScreen.tsx src/screens/ledger/SaleSheet.tsx
git commit -m "Sales ledger on SearchInput, Chip and Select; the sale sheet on the shared Sheet with LineRow and Toggle

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: The menu — tabs, products, categories, options, the product editor, import

**Files:**
- Modify: `src/screens/MenuScreen.tsx`
- Modify: `src/screens/menu/CategoriesPanel.tsx`
- Modify: `src/screens/menu/OptionsPanel.tsx`
- Rewrite the frame of: `src/screens/menu/ProductEditor.tsx`
- Modify: `src/screens/menu/ImportPanel.tsx`

**Interfaces:**
- Consumes: `TabStrip`, `SearchInput`, `Chip`, `Choice`, `Toggle`, `Panel`, `Notice`, `Loading`, `Money`, `Sheet`, `Select` from Task 0.
- Behaviour preserved: the permission-filtered `tabs` memo and the `active` fallback in `MenuScreen`; the product search and list; `CategoriesPanel`'s cup/snack choice handlers; every `run`/`onRun` call in `OptionsPanel`, the `window.confirm`, the inline name inputs and their `onBlur` saves; `ProductEditor`'s `draft`, `set`, `setVariant`, `save`, `archiveProduct`, `mayEdit` gating, `addingCategory`; `ImportPanel`'s parse/confirm flow.

- [ ] **Step 1: `MenuScreen.tsx` — the tab strip**

Add `TabStrip` to the primitives import (line 6). Replace lines 46–65 (the outer `div`'s opening and the whole tab block) with:

```tsx
    <div className="flex h-full flex-col">
      <TabStrip tabs={tabs} active={active} onChange={setTab} />
```

`tabs` already has the shape `{ id, label }` (plus `allowed`, which `TabStrip` ignores). `setTab` is `Dispatch<SetStateAction<Tab>>`, which is assignable to `(id: Tab) => void`. Remove the `cn` import if nothing else in the file uses it (`grep -c "cn(" src/screens/MenuScreen.tsx` — the product row at 187 uses it, so it stays).

In `ProductsPanel`: line 131 → `return <Loading />` (add `Loading` to the import). Lines 136–158 (the toolbar and search box) become:

```tsx
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Search the menu" className="flex-1" />
```

Drop `Search, X` from the lucide import. Line 205: `<span className="tabular shrink-0 text-sm text-ink">` → `<Money className="shrink-0 text-sm text-ink">` with the matching close tag.

- [ ] **Step 2: `CategoriesPanel.tsx`**

Import line 8 becomes `import { Chip, EmptyState, Loading, Panel } from '../../components/ui/primitives.tsx'`.

Line 47 → `return <Loading />`. Lines 55–66 (the "What counts as a cup" section): `<section className="rounded-2xl border border-line bg-surface p-4"><h2 className="text-sm font-medium text-ink">What counts as a cup</h2>` → `<Panel title="What counts as a cup">`; the two `<p>`s inside lose their `mt-1`/`mt-2` and become `<p className="text-[0.8125rem] text-ink-muted">` and `<p className="mt-2 text-[0.8125rem] text-ink-subtle">`; `</section>` → `</Panel>`. Line 73: `divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface` → `divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface`.

Replace the local `Choice` (117–145) with the shared `Chip`: each `<Choice active={…} disabled={…} onClick={…} icon={…} label="…" />` becomes

```tsx
<Chip active={…} disabled={…} onClick={…}>
  <span className="flex items-center gap-1.5">{…the same icon…}{…the same label…}</span>
</Chip>
```

(`Chip` carries `aria-pressed`, as the old `Choice` did.) Delete the local `Choice` and the `cn` import if unused.

- [ ] **Step 3: `OptionsPanel.tsx`**

Import line 15 becomes `import { Button, Chip, Choice, EmptyState, Field, Input, Loading, Panel } from '../../components/ui/primitives.tsx'`.

Line 55 → `return <Loading />`. Lines 61–78 (the "Options offered" header section): `<section className="rounded-2xl border border-line bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-medium text-ink">Options offered</h2><p className="mt-1 …">…</p></div>{…the New group Button…}</div>` → `<Panel title="Options offered" note={/* the same paragraph text */} actions={/* the same Button */}>`; keep the `adding` form (79–130) as the Panel's child; `</section>` → `</Panel>`.

Line 79: `mt-3 space-y-3 rounded-xl border border-line p-3` → `space-y-3 rounded-md border border-line p-3`. Lines 92–110 (the SINGLE/MULTI buttons): each becomes

```tsx
                  <Choice
                    key={entry}
                    active={selection === entry}
                    onClick={() => setSelection(entry)}
                    title={entry === 'SINGLE' ? 'Choose one' : 'Choose any'}
                    detail={entry === 'SINGLE' ? 'Like milk — one answer only' : 'Like add-ons — several at once'}
                  />
```

In `GroupCard` (167–): line 190 `<section className={cn('rounded-2xl border bg-surface', group.active ? 'border-line' : 'border-line opacity-60')}>` → `<section className={cn('rounded-lg border border-line bg-surface', !group.active && 'opacity-60')}>`. Lines 230 and 274: `rounded-lg p-2` → `rounded-sm p-2`, `rounded-lg p-1.5` → `rounded-sm p-1.5`. Line 252: `<span className="tabular shrink-0 text-[0.8125rem] text-ink-muted">` → `<span className="figure shrink-0 text-[0.8125rem] text-ink-muted">`.

Replace the two `<Toggle label="…" on={…} disabled={…} onClick={…} />` at 210–221 with `<Chip size="sm" active={…on…} disabled={…} onClick={…}>{…label…}</Chip>` (same expressions), and delete the local `Toggle` (330–355).

- [ ] **Step 4: `ProductEditor.tsx` — the frame**

Import line 18 becomes `import { Button, Chip, Field, Input, Sheet, Toggle } from '../../components/ui/primitives.tsx'`. Delete the `@radix-ui/react-dialog` import and drop `X` from the lucide import.

Replace lines 95–110 (from `<Dialog.Root` through the body `div`'s opening tag) and lines 338–352 (from the body's closing `</div>` through `</Dialog.Root>`) so the return reads:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="side"
      dismissible={!busy}
      closeDisabled={busy}
      title={/* the existing Dialog.Title child expression, e.g. creating ? 'New item' : product.name — copy it verbatim */}
      footer={
        mayEdit ? (
          <>
            {/* the existing Save Button and the creating ? <p>…</p> : null, moved verbatim;
                the <p> keeps its classes */}
          </>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {/* the existing body children, moved verbatim except for Step 5 */}
      </div>
    </Sheet>
  )
```

- [ ] **Step 5: `ProductEditor.tsx` — the body**

| Line | Old | New |
|---|---|---|
| 132 | `<span className="text-[0.8125rem] font-medium text-ink-muted">Category</span>` | `<span className="micro block text-ink-subtle">Category</span>` |
| 133 | `flex flex-wrap gap-2` | `flex flex-wrap gap-1.5` |
| 135–148 | the category `<button …>` | `<Chip key={category.id} active={draft.categoryId === category.id} disabled={!mayEdit} onClick={() => set({ categoryId: category.id })}>{category.name}</Chip>` |
| 151–157 | the dashed "New" button | `<button type="button" onClick={() => setAddingCategory(true)} className="shrink-0 rounded-md border border-dashed border-line-strong px-3 py-1.5 text-xs font-semibold text-ink-subtle hover:text-ink"><Plus className="inline h-3.5 w-3.5" aria-hidden="true" /> New</button>` |
| 197 | `<span className="text-[0.8125rem] font-medium text-ink-muted">` (the Sizes heading) | `<span className="micro block text-ink-subtle">` |
| 233 | `className="tabular w-28 text-right"` (the price Input) | `className="figure w-28 text-right"` |
| 241–246 | the Default/Set button's class | `cn('shrink-0 rounded-md border px-2 py-2 text-[0.6875rem] font-semibold transition-colors', variant.isDefault ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong text-ink-subtle hover:text-ink')` |
| 256 | `shrink-0 rounded-lg p-2 text-ink-subtle hover:bg-danger/10 hover:text-danger` | `shrink-0 rounded-sm p-2 text-ink-subtle hover:bg-danger/10 hover:text-danger` |
| 273 | `<span className="text-[0.8125rem] font-medium text-ink-muted">Options offered</span>` | `<span className="micro block text-ink-subtle">Options offered</span>` |
| 274 | `flex flex-wrap gap-2` | `flex flex-wrap gap-1.5` |
| 278–297 | the group `<button …>` | `<Chip key={group.id} active={on} disabled={!mayEdit} onClick={/* the same set({ modifierGroupIds: … }) expression */}>{group.name}</Chip>` |
| 302 | `space-y-3 rounded-xl border border-line p-4` | `space-y-3 rounded-md border border-line p-4` |
| 303–316 | the two `<Row label hint checked disabled onChange />` | `<Toggle label hint checked disabled onChange />` — identical props; `Toggle`'s `onChange` receives a boolean the old zero-arg handlers ignore, which TypeScript allows |

Delete the local `Row` (356–396). Keep `cn` (the Default/Set button uses it).

- [ ] **Step 6: `ImportPanel.tsx`**

Import line 14 becomes `import { Button, Money, Notice, Panel } from '../../components/ui/primitives.tsx'`.

Each of the three numbered `<section className="rounded-2xl border border-line bg-surface p-4"><h3 className="text-sm font-medium text-ink">N. …</h3>` (119–120, 147–148, 173–174) becomes `<Panel level={3} title="N. …">`; the `</section>` closes as `</Panel>`. Inside, the first `<p className="mt-1 …">` loses `mt-1`.

Line 154 (the file input): `file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-ink hover:file:bg-brand/90` → `file:rounded-md file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-semibold file:text-accent-ink hover:file:bg-accent/90` (the primary action is Caramel with dark ink, like every primary button).

Line 185: `<p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-danger">` stays (danger words on plain surface are measured and pass). Lines 189, 213, 239: `rounded-xl border border-line` → `rounded-md border border-line`. Line 192: `tabular shrink-0 text-ink-subtle` → `figure shrink-0 text-ink-subtle`. Line 209 and 236: `text-[0.8125rem] font-medium text-ink-muted` → `micro text-ink-subtle`. Line 227: `<span className="tabular shrink-0 font-medium text-ink">{money(drink.price ?? 0)}</span>` → `<Money className="shrink-0 font-medium text-ink">{money(drink.price ?? 0)}</Money>`. Line 315: `tabular shrink-0` → `figure shrink-0`.

`Count` (347–): line 357 `rounded-xl bg-surface-sunken px-3 py-2.5` → `rounded-md border border-line bg-surface px-3 py-2.5`; the value line at 359 gains `figure` in its class list; line 366 `text-[0.8125rem] text-ink-muted` → `micro text-ink-subtle`.

`ColumnGuide` (326–): line 329 `text-[0.8125rem] font-medium text-ink-muted` → `micro text-ink-subtle`; line 335 `font-medium text-ink-muted` → `micro text-ink-subtle`.

- [ ] **Step 7: Typecheck, tests**

Run: `npm run typecheck`. Run: `npm test` — baseline counts.

- [ ] **Step 8: Look**

Menu tab, every sub-tab, at three widths. Check: the tab strip is micro-caps with an espresso underline and scrolls sideways on the phone; the product search matches the till's; open a product — sheet on the phone, docked on tablet/laptop; the category and option chips are squares, the two toggles are real switches; Categories' cup/snack choices are chips; Options' Required/On chips are small squares; Import's three steps are panels with micro headings and the file button is Caramel.

- [ ] **Step 9: Commit**

```bash
git add src/screens/MenuScreen.tsx src/screens/menu/CategoriesPanel.tsx src/screens/menu/OptionsPanel.tsx src/screens/menu/ProductEditor.tsx src/screens/menu/ImportPanel.tsx
git commit -m "Menu: TabStrip, product editor on the shared Sheet, chips and switches for categories and options, import on Panel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Recipes and stock — the two lists, the recipe editor, the ingredient editor and sheet

**Files:**
- Modify: `src/screens/RecipesScreen.tsx`
- Rewrite the frame of: `src/screens/recipes/RecipeEditor.tsx` (and move its ingredient picker onto a second `Sheet`)
- Modify: `src/screens/InventoryScreen.tsx`
- Rewrite the frame of: `src/screens/inventory/IngredientEditor.tsx`
- Rewrite the frame of: `src/screens/inventory/IngredientSheet.tsx`

**Interfaces:**
- Consumes: `SearchInput`, `Chip`, `Choice`, `Toggle`, `Notice`, `Loading`, `Money`, `Sheet` (with `actions`), `Select`, `Textarea`, `Panel`, `LineRow`, `Micro` from Task 0.
- Behaviour preserved: `RecipesScreen`'s `onlyMissing` filter and its `missingCount`; `RecipeEditor`'s `components`/`notes`/`priceMinor`/`picking`/`search` state, `saveRecipe`, `updateVariantPrice`, the `canEdit`/`canPrice` gates, the margin suggestion buttons; `InventoryScreen`'s `stockClass` filter and `summary`; `IngredientEditor`'s draft and `trackStock`; `IngredientSheet`'s movement modes and quantity/unit handling.

- [ ] **Step 1: `RecipesScreen.tsx`**

Import line 7 becomes `import { Badge, EmptyState, Loading, Money, Notice, SearchInput } from '../components/ui/primitives.tsx'`; drop `Search, X` from lucide.

Line 135 → `return <Loading />`. Lines 140–162 become:

```tsx
      <div className="shrink-0 space-y-2.5 border-b border-line bg-surface px-3 py-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Search products" />
```

Lines 164–182 (the missing-recipe bar) become:

```tsx
        {missingCount > 0 || onlyMissing ? (
          <button
            type="button"
            onClick={() => setOnlyMissing((value) => !value)}
            className="block w-full text-left"
          >
            <Notice
              tone="warning"
              icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}
              className={cn('transition-colors', onlyMissing ? 'bg-honey/25' : 'hover:bg-honey/20')}
            >
              <span className="flex items-center gap-3">
                <span className="flex-1">
                  {onlyMissing
                    ? 'Showing only sizes with no recipe.'
                    : `${missingCount} ${missingCount === 1 ? 'size has' : 'sizes have'} no recipe, so nothing is deducted from stock when sold.`}
                </span>
                <span className="shrink-0 font-semibold underline">{onlyMissing ? 'Show all' : 'Show them'}</span>
              </span>
            </Notice>
          </button>
        ) : null}
```

Line 194: `text-xs font-medium text-ink-muted lg:grid` → `micro text-ink-subtle lg:grid`. In `Cell` (275–): line 278 `text-[0.6875rem] text-ink-subtle lg:hidden` → `micro text-ink-subtle lg:hidden`; line 280 `'tabular block text-[0.9375rem]'` → `'figure block text-[0.9375rem]'`. Line 238: `text-[0.6875rem] text-ink-subtle` → `micro text-ink-subtle`; the margin value on 241–: add `figure` to its class list.

- [ ] **Step 2: `RecipeEditor.tsx` — the frame and the picker**

Import line 27 becomes `import { Button, Field, Input, Money, SearchInput, Select, Sheet, Textarea } from '../../components/ui/primitives.tsx'`. Delete the `@radix-ui/react-dialog` import; drop `Search, X` from lucide.

Replace lines 223–241 (from `<Dialog.Root` through the body `div`'s opening tag) and lines 409–488 (from the footer through `</Dialog.Root>`) so the return reads:

```tsx
  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        placement="side"
        title={/* the existing Dialog.Title child, verbatim */}
        description={variant.name}
        footer={
          canEdit || canPrice ? (
            <Button size="lg" full onClick={() => void save()} disabled={busy || !loaded}>
              {busy ? 'Saving…' : 'Save recipe'}
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          {/* the existing body children (the cost card, price, components list, notes),
              moved verbatim except for Step 3 */}
        </div>
      </Sheet>

      {/* The ingredient picker: its own sheet over the editor, rather than a
          pane painted over the editor's frame. */}
      <Sheet
        open={open && picking}
        onClose={() => {
          setPicking(false)
          setSearch('')
        }}
        placement="side"
        title="Add an ingredient"
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search ingredients"
          autoFocus
        />
        <div className="-mx-5 mt-3">
          {/* the existing picker list from lines 448–483, moved verbatim: the
              "nothing matches" <p> and the <ul className="divide-y divide-line"> */}
        </div>
      </Sheet>
    </>
  )
```

The picker's old header had a Cancel icon button whose `onClick` reset `picking` and `search`; that is now the second sheet's `onClose`. Radix stacks the second dialog above the first.

- [ ] **Step 3: `RecipeEditor.tsx` — the body**

| Line | Old | New |
|---|---|---|
| 243 | `space-y-3 rounded-2xl border border-line bg-surface-sunken p-4` | `space-y-3 rounded-md border border-line bg-surface-sunken p-4` |
| 260–277 | each `<span className="tabular text-ink">…</span>` | `<Money className="text-ink">…</Money>`; each `<span className="text-ink-muted">` label stays |
| 287 | `className="tabular text-right text-lg"` | `className="figure text-right text-lg"` |
| 299 | `rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-brand hover:text-ink` | `rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-brand hover:text-ink` |
| 301 | `<span className="tabular font-medium">{money(suggestion)}</span>` | `<Money className="font-medium">{money(suggestion)}</Money>` |
| 311 | `<h3 className="text-[0.8125rem] font-medium text-ink-muted">` | `<h3 className="micro text-ink-subtle">` |
| 325 | `rounded-xl border border-dashed border-line-strong px-4 py-8 text-center` | `rounded-md border border-dashed border-line-strong px-4 py-8 text-center` |
| 343 | `flex items-center gap-2 rounded-xl border border-line px-3 py-2.5` | `flex items-center gap-2 rounded-md border border-line px-3 py-2.5` |
| 349 | `tabular block text-xs text-ink-subtle` | `figure block text-xs text-ink-subtle` |
| 363 | the quantity input's class | `figure h-10 w-20 rounded-md border border-line-strong bg-surface px-2 text-right text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-60` |
| 366–373 | the unit `<select …>` | `<Select size="sm" className="w-20" value={…} onChange={…} disabled={…}>` + the same options |
| 383 | `shrink-0 rounded-lg p-2 …` | `shrink-0 rounded-sm p-2 …` |
| 398–405 | the `<textarea …>` | `<Textarea value={…} onChange={…} rows={…} placeholder={…} disabled={…} />` with the same props, no `className` |

In `Metric` (492–): line 503 `text-[0.8125rem] text-ink-muted` → `micro text-ink-subtle`; line 505's class list `'tabular text-xl font-semibold'` → `'figure text-xl font-semibold'`.

- [ ] **Step 4: `InventoryScreen.tsx`**

Import line 12 becomes `import { Badge, Button, Chip, EmptyState, Loading, Money, SearchInput } from '../components/ui/primitives.tsx'`; drop `Search, X` from lucide.

Line 92 → `return <Loading />`. Lines 97–120 become:

```tsx
      <div className="shrink-0 space-y-2.5 border-b border-line bg-surface px-3 py-2.5">
        <div className="flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search stock" className="flex-1" />
          {/* the existing New item Button, unchanged */}
        </div>
```

Lines 130–146: `gap-2` → `gap-1.5`; each filter `<button …>` becomes `<Chip key={filter.value} active={stockClass === filter.value} onClick={() => setStockClass(filter.value)}>{filter.label}</Chip>`.

Line 155: `<span className="text-warning">{summary.low} low</span>` stays (warning words on plain surface). Line 157: `<span className="tabular font-medium text-ink">` → `<Money className="font-medium text-ink">`. Line 187–190: `'h-9 w-1 shrink-0 rounded-full'` → `'h-9 w-1 shrink-0 rounded-sm'` and `low ? 'bg-warning'` → `low ? 'bg-honey'` (a fill, so Honey is correct here). Lines 215–224: the on-hand figure and the value line gain `figure` in place of `tabular`.

- [ ] **Step 5: `IngredientEditor.tsx`**

Import line 20 becomes `import { Button, Choice, Field, Input, Select, Sheet, Toggle } from '../../components/ui/primitives.tsx'`; delete the Dialog import; drop `X` from lucide.

Replace lines 211–226 and 355–362 so the return reads:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      title={/* the existing Dialog.Title child, verbatim */}
      footer={/* the existing footer's Button, verbatim */}
    >
      <div className="space-y-4">
        {/* the existing body children, moved verbatim except for the rows below */}
      </div>
    </Sheet>
  )
```

(This one was centred, not docked: `placement` stays at its default `center`.)

| Line | Old | New |
|---|---|---|
| 238 | `<span className="text-[0.8125rem] font-medium text-ink-muted">What is it?</span>` | `<span className="micro block text-ink-subtle">What is it?</span>` |
| 240–257 | each kind `<button …>` | `<Choice key={entry.value} active={stockClass === entry.value} onClick={() => setStockClass(entry.value)} title={entry.label} detail={entry.blurb} />` |
| 261 | `space-y-1.5 rounded-2xl border border-line bg-surface-sunken p-4` | `space-y-1.5 rounded-md border border-line bg-surface-sunken p-4` |
| 262 | `<span className="text-[0.8125rem] font-medium text-ink-muted">How you buy it</span>` | `<span className="micro block text-ink-subtle">How you buy it</span>` |
| 269, 291, 312, 323 | `className="tabular text-right"` | `className="figure text-right"` |
| 273–283 | the unit `<select …>` | `<Select value={…} onChange={…}>` + the same options |
| 298 | `<span className="tabular font-medium text-ink">` | `<Money className="font-medium text-ink">` (add `Money` to the import) |
| 328–352 | the track-stock `<button …>` with its hand-drawn switch | `<Toggle label="Track stock levels" hint="Turn off for things you never count, like tap water." checked={trackStock} onChange={setTrackStock} className="rounded-md border border-line px-4 py-3" />` |

`setTrackStock` was called as `setTrackStock((value) => !value)`; `Toggle` hands it the next boolean directly, which is the same result. Drop `cn` if unused afterwards.

- [ ] **Step 6: `IngredientSheet.tsx`**

Import line 26 becomes `import { Button, Choice, Field, Input, LineRow, Money, Notice, Select, Sheet } from '../../components/ui/primitives.tsx'`; delete the Dialog import; drop `X` from lucide (keep `Pencil`).

Replace lines 190–218 and 408–410 so the return reads:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="side"
      title={/* the existing Dialog.Title child */}
      description={/* the existing Dialog.Description children */}
      actions={/* the existing Pencil edit Button from lines 205–209, verbatim, including its permission guard */}
    >
      <div className="space-y-5">
        {/* the existing body children, moved verbatim except for the rows below */}
      </div>
    </Sheet>
  )
```

| Line | Old | New |
|---|---|---|
| 220 | `cn('rounded-2xl px-4 py-3', low ? 'bg-warning/10' : 'bg-surface-sunken')` | `cn('rounded-md border px-4 py-3', low ? 'border-honey bg-honey/15' : 'border-line bg-surface')` |
| 221, 227 | `text-[0.8125rem] text-ink-muted` | `micro text-ink-subtle` |
| 222 | `cn('tabular text-2xl font-semibold', low ? 'text-warning' : 'text-ink')` | `cn('figure text-2xl font-semibold', low ? 'text-warning' : 'text-ink')` |
| 226 | `rounded-2xl bg-surface-sunken px-4 py-3` | `rounded-md border border-line bg-surface px-4 py-3` |
| 228 | `tabular text-2xl font-semibold text-ink` | `figure text-2xl font-semibold text-ink` |
| 233 | `<p className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] text-warning">…</p>` | `<Notice tone="warning">…</Notice>` |
| 241–262 | the four movement-type `<button …>` tiles | `<Choice key={entry} active={action === entry} disabled={!allowed} onClick={() => setAction(action === entry ? null : entry)} icon={<Icon className="h-4 w-4" aria-hidden="true" />} title={label} className="flex-col items-center gap-1 px-2 text-center" />` — the `allowed` const above each stays |
| 266 | `space-y-4 rounded-2xl border border-line bg-surface-sunken p-4` | `space-y-4 rounded-md border border-line bg-surface-sunken p-4` |
| 267–285 | the WASTE-type `<button …>`s (they are chip-shaped, solid when chosen) | the grid becomes `<div className="flex flex-wrap gap-1.5">` and each button `<Chip key={type} active={wasteType === type} onClick={() => setWasteType(type)}>{MOVEMENT_LABELS[type]}</Chip>` (add `Chip` to the import) |
| 303, 332 | `className="tabular text-right"` | `className="figure text-right"` |
| 308–318 | the unit `<select …>` | `<Select value={…} onChange={…}>` + the same options |
| 360, 362 | `<span className="tabular">` / `<span className="tabular font-medium text-ink">` | `<Money>` / `<Money className="font-medium text-ink">` |
| 378 | `<h3 className="text-[0.8125rem] font-medium text-ink-muted">History</h3>` | `<h3 className="micro text-ink-subtle">History</h3>` |
| 382 | `divide-y divide-line rounded-xl border border-line` | `divide-y divide-line rounded-md border border-line` |
| 394– | the movement quantity `<span className={cn('tabular …`| `<Money className={cn(…same tone…)}>` |

- [ ] **Step 7: Typecheck, tests**

Run: `npm run typecheck`. Run: `npm test` — baseline counts.

- [ ] **Step 8: Look**

Menu → Recipes and Menu → Ingredients at three widths. Check: both searches match the till's; the "no recipe" bar is ink on honey with a honey rule and still toggles; open a recipe — the editor is a docked sheet, *Add ingredient* opens a second sheet over it with a search box, picking one closes the picker and adds the row; the unit select has our chevron; the notes box is the shared textarea. Open an ingredient — the pencil sits beside the close button; the on-hand card is honey-edged when low; the movement tiles are 6px choices. Open *New item* — centred on tablet/laptop, a bottom sheet on the phone; the kind tiles and the track-stock switch render.

- [ ] **Step 9: Commit**

```bash
git add src/screens/RecipesScreen.tsx src/screens/recipes/RecipeEditor.tsx src/screens/InventoryScreen.tsx src/screens/inventory/IngredientEditor.tsx src/screens/inventory/IngredientSheet.tsx
git commit -m "Recipes and stock: both lists on SearchInput and Chip; the recipe, ingredient and stock sheets on the shared Sheet, the ingredient picker as a second sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Reports — the tab strip, the shift, the reading (Roastery), end of day (Roastery), the planner

**Files:**
- Modify: `src/screens/ReportsScreen.tsx`
- Modify: `src/screens/reports/ShiftPanel.tsx` (and move `ConfirmSheet` onto `Sheet`)
- Rewrite: `src/screens/reports/ReadingSheet.tsx`
- Rewrite: `src/screens/reports/EndOfDayPanel.tsx`
- Modify: `src/screens/reports/PlannerPanel.tsx` (and move `PasscodeSheet` onto `Sheet`)

**Interfaces:**
- Consumes: `TabStrip`, `Panel`, `Chip`, `Choice`, `Notice`, `LineRow`, `Money`, `Micro`, `Loading`, `Sheet`, `Textarea`, `Button`, `Field`, `Input`, `Badge`, `EmptyState` from Task 0 / Plan A.
- Behaviour preserved: `ReportsScreen`'s permission-filtered tabs; `ShiftPanel`'s open/close/reading flow, `running`, the movement form, `CloseShiftSheet`'s `counted`/`reason`/`variance`/`needsReason` and its `disabled` expression; `ReadingSheet`'s `printLinesInBrowser` call with `readingLines(...)` and `paperWidth`, the `id="reading-print"` on the body; `EndOfDayPanel`'s `iso` state, `toIso`/`fromIso`/`longDate`, `buildEndOfDay`; `PlannerPanel`'s lock, unlock, passcode set/remove, the allocation rows and their inline inputs.

- [ ] **Step 1: `ReportsScreen.tsx`**

Replace lines 40–59 with:

```tsx
    <div className="flex h-full flex-col">
      <TabStrip tabs={tabs} active={active} onChange={setTab} />
```

Import `TabStrip` from `'../components/ui/primitives.tsx'`; delete the `cn` import (nothing else in the file uses it).

- [ ] **Step 2: `ShiftPanel.tsx`**

Import line 19 becomes `import { Badge, Button, Chip, EmptyState, Field, Input, LineRow, Loading, Money, Notice, Panel, Sheet } from '../../components/ui/primitives.tsx'`; delete the `@radix-ui/react-dialog` import.

Line 81 → `return <Loading />`.

The open-shift card (91–153): `<section className="rounded-2xl border border-line bg-surface p-4">` → `<Panel>` (no title — the shift code is the heading and stays as it is); line 95 `<h2 className="text-base font-semibold text-ink">{shift.code}</h2>` → `<h2 className="figure text-base font-semibold text-ink">{shift.code}</h2>`; line 121 `<span className="tabular text-ink">` → `<Money className="text-ink">`; `</section>` → `</Panel>`.

The past readings list (156–190): `<section className="rounded-2xl border border-line bg-surface"><h2 className="border-b border-line px-4 py-3 text-sm font-medium text-ink">Past readings</h2>` → `<Panel title="Past readings" flush>`; line 184 `<span className="tabular shrink-0 text-sm text-ink">` → `<Money className="shrink-0 text-sm text-ink">`; `</section>` → `</Panel>`.

`OpenShiftCard` (201–): line 213 `<section className="rounded-2xl border border-line bg-surface p-4"><h2 className="text-base font-semibold text-ink">No shift is open</h2>` → `<Panel title="No shift is open">`; the `<p className="mt-1 …">` loses `mt-1`; `</section>` → `</Panel>`.

`CashDrawerCard` (243–): line 279–280 `<section className="rounded-2xl border border-line bg-surface p-4"><h2 className="text-sm font-medium text-ink">Money in and out of the drawer</h2>` → `<Panel title="Money in and out of the drawer">`; the `<p className="mt-1 …">` loses `mt-1`. Lines 285–299 (the movement-type buttons) become `<div className="mt-3 flex flex-wrap gap-1.5">` of `<Chip key={entry} active={type === entry} onClick={() => setType(entry)}>{CASH_MOVEMENT_LABELS[entry]}</Chip>`. Line 324: `rounded-xl border border-line` → `rounded-md border border-line`. Line 331: `<span className={cn('tabular shrink-0', …)}>` → `<Money className={cn('shrink-0', …)}>`. `</section>` → `</Panel>`.

`CloseShiftSheet` (349–): the body's `<dl className="mt-4 space-y-1">` with four `<Line …/>` → the same `dl` with `<LineRow … />` (props `label`, `value`, `strong` map 1:1). Lines 422–433 (the variance paragraph) become

```tsx
      {variance !== null ? (
        <Notice tone={variance === 0 ? 'positive' : 'danger'} className="mt-2">
          {variance === 0
            ? 'The drawer balances.'
            : `${variance > 0 ? 'Over' : 'Short'} by ${money(Math.abs(variance))}.`}
        </Notice>
      ) : null}
```

Delete the local `Line` (458–465). `Tile` (467–475): line 469 `rounded-xl bg-surface-sunken px-3 py-2.5` → `rounded-md border border-line bg-surface px-3 py-2.5`; line 470 `cn('font-semibold text-ink', lead ? 'text-xl' : 'text-lg')` → `cn('figure font-semibold text-ink', lead ? 'text-xl' : 'text-lg')`; line 471 `text-[0.8125rem] text-ink-muted` → `micro mt-0.5 text-ink-subtle`.

Replace `ConfirmSheet` (477–500) with:

```tsx
function ConfirmSheet({
  open,
  onClose,
  title,
  busy,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  busy: boolean
  children: ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} size="sm" dismissible={!busy} closeDisabled={busy}>
      {children}
    </Sheet>
  )
}
```

- [ ] **Step 3: `ReadingSheet.tsx` — Roastery**

This is a reading, so it takes the receipt's register. Replace the whole file body below the imports and the props (keep lines 1–33 except the Dialog and `X` imports; import `Button, LineRow, Micro, Sheet` from primitives). The return becomes:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="side"
      title={
        <span className="font-display text-xl font-medium tracking-tight text-brand">
          {isZ ? 'Z reading' : 'X reading'} #{snapshot.sequence}
        </span>
      }
      description={`${snapshot.shiftCode} · ${new Date(snapshot.takenAt).toLocaleString()}`}
      footer={
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
      }
    >
      <div id="reading-print" className="space-y-1">
        <dl>
          <LineRow label="Shift opened" value={new Date(snapshot.openedAt).toLocaleString()} muted leader />
          <LineRow label="Opened by" value={snapshot.openedByName} muted leader />
          <LineRow label="Reading taken by" value={snapshot.takenByName} muted leader />
        </dl>

        <Section title="Takings" />
        <dl>
          <LineRow label="Gross sales" value={money(snapshot.grossSales)} leader />
          <LineRow label="Less discounts" value={`−${money(snapshot.discounts)}`} leader />
          <LineRow label="Net of tax" value={money(snapshot.netOfTax)} leader />
          <LineRow label="Tax" value={money(snapshot.tax)} leader />
          {snapshot.taxExempt !== 0 ? (
            <LineRow label="Tax lifted (senior / PWD)" value={money(snapshot.taxExempt)} muted leader />
          ) : null}
          <LineRow label="Total sales" value={money(snapshot.totalSales)} strong leader />
        </dl>

        <Section title="Counts" />
        <dl>
          <LineRow label="Transactions" value={String(snapshot.transactions)} leader />
          <LineRow label="Cups sold" value={String(snapshot.cupsSold ?? snapshot.itemsSold)} leader />
          {(snapshot.snacksSold ?? 0) > 0 ? (
            <LineRow label="Snacks sold" value={String(snapshot.snacksSold)} leader />
          ) : null}
          <LineRow label="Average sale" value={money(snapshot.averageSale)} leader />
        </dl>

        <Section title="Corrections" />
        <dl>
          <LineRow
            label={`Voids (${snapshot.voidCount})`}
            value={money(snapshot.voidAmount)}
            tone={snapshot.voidCount > 0 ? 'danger' : undefined}
            leader
          />
          <LineRow
            label={`Refunds (${snapshot.refundCount})`}
            value={`−${money(snapshot.refundAmount)}`}
            tone={snapshot.refundCount > 0 ? 'danger' : undefined}
            leader
          />
        </dl>

        <Section title="How it was paid" />
        {snapshot.payments.length === 0 ? (
          <p className="py-1 text-[0.8125rem] text-ink-subtle">Nothing taken yet.</p>
        ) : (
          <dl>
            {snapshot.payments.map((line) => (
              <LineRow key={line.key} label={`${line.label} (${line.count})`} value={money(line.amount)} leader />
            ))}
          </dl>
        )}

        {snapshot.discountLines.length > 0 ? (
          <>
            <Section title="Discounts given" />
            <dl>
              {snapshot.discountLines.map((line) => (
                <LineRow key={line.key} label={`${line.label} (${line.count})`} value={money(line.amount)} leader />
              ))}
            </dl>
          </>
        ) : null}

        <Section title="The drawer" />
        <dl>
          <LineRow label="Opening float" value={money(snapshot.cash.openingFloat)} leader />
          <LineRow label="Cash sales" value={money(snapshot.cash.cashSales)} leader />
          {snapshot.cash.payIn > 0 ? <LineRow label="Money put in" value={money(snapshot.cash.payIn)} leader /> : null}
          {snapshot.cash.payOut > 0 ? (
            <LineRow label="Money taken out" value={`−${money(snapshot.cash.payOut)}`} leader />
          ) : null}
          {snapshot.cash.pettyCash > 0 ? (
            <LineRow label="Petty cash" value={`−${money(snapshot.cash.pettyCash)}`} leader />
          ) : null}
          {snapshot.cash.cashDrops > 0 ? (
            <LineRow label="Dropped to the safe" value={`−${money(snapshot.cash.cashDrops)}`} leader />
          ) : null}
          <LineRow label="Expected in drawer" value={money(snapshot.cash.expectedCash)} strong leader />
          {snapshot.cash.countedCash !== null ? (
            <>
              <LineRow label="Counted" value={money(snapshot.cash.countedCash)} strong leader />
              <LineRow
                label={variance === 0 ? 'Balanced' : (variance ?? 0) > 0 ? 'Over' : 'Short'}
                value={money(Math.abs(variance ?? 0))}
                tone={variance === 0 ? 'positive' : 'danger'}
                strong
                leader
              />
            </>
          ) : null}
        </dl>
        {snapshot.cash.countedCash !== null && snapshot.cash.varianceReason ? (
          <p className="mt-1 rounded-md border-l-2 border-line-strong bg-surface-sunken px-3 py-2 text-[0.8125rem] text-ink">
            {snapshot.cash.varianceReason}
          </p>
        ) : null}

        {isZ && snapshot.grandTotal !== null ? (
          <>
            <Section title="Register" />
            <dl>
              <LineRow label="Total across every Z reading" value={money(snapshot.grandTotal)} strong leader />
            </dl>
          </>
        ) : null}

        <p className="pt-5 text-[0.8125rem] text-ink-subtle">
          {isZ
            ? 'This reading closed the shift. The figures are the ones recorded at that moment and do not change afterwards.'
            : 'An X reading is a look at the register part-way through. It changed nothing and the shift carried on.'}
        </p>
      </div>
    </Sheet>
  )
}

function Section({ title }: { title: string }) {
  return <Micro className="mt-5 border-b border-line pb-1">{title}</Micro>
}
```

The local `Row` is deleted. Every figure, label and conditional above is the one that was there; only the frame, the leaders and the type changed.

- [ ] **Step 4: `EndOfDayPanel.tsx` — Roastery**

Keep lines 1–31 (imports, state, the `Loading` early return, `taxLabel`) with these import changes: `import { EmptyState, LineRow, Loading, Micro, Money, Notice } from '../../components/ui/primitives.tsx'`; drop `StatTile` from the charts import (the whole line goes if nothing else is imported from it). Line 27 → `return <Loading />`.

Replace the return (lines 32–199) with:

```tsx
  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-5">
        {/* The date is the title. This is the page the owner reads at the end
            of the day, so it opens like a printed statement. */}
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
          <div>
            <Micro>End of day</Micro>
            <h2 className="mt-1 font-display text-[1.75rem] font-medium leading-none tracking-tight text-brand">
              {longDate(date)}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIso(toIso(new Date()))}
              className="h-10 rounded-md border border-line-strong bg-surface px-3 text-xs font-semibold text-ink-muted transition-colors press hover:text-ink"
            >
              Today
            </button>
            <input
              type="date"
              value={iso}
              max={toIso(new Date())}
              onChange={(event) => event.target.value && setIso(event.target.value)}
              className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[0.9375rem] text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
            />
          </div>
        </header>

        {summary.quiet ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" aria-hidden="true" />}
            title="Nothing was rung up"
            description="No orders on this day. A closed day looks exactly like this."
          />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
              <Headline
                label="Total sales"
                value={money(summary.analytics.grossRevenue)}
                detail={`${summary.orders} ${summary.orders === 1 ? 'order' : 'orders'}`}
              />
              <Headline
                label="Total cost of goods"
                value={money(summary.analytics.cogsTotal)}
                detail="What the drinks cost to make"
              />
              <Headline
                label="Gross profit"
                value={money(summary.pnl.grossProfit)}
                detail="Before expenses"
                tone={summary.pnl.grossProfit > 0 ? 'positive' : 'default'}
              />
              <Headline
                label="Net profit"
                value={money(summary.pnl.netProfit)}
                detail={
                  summary.pnl.totalExpenses > 0
                    ? `After ${money(summary.pnl.totalExpenses)} of expenses`
                    : 'No expenses recorded'
                }
                tone={summary.pnl.netProfit > 0 ? 'positive' : summary.pnl.netProfit < 0 ? 'danger' : 'default'}
              />
            </section>

            <Notice tone="neutral">
              <span className="font-medium">
                {summary.cups} {summary.cups === 1 ? 'cup' : 'cups'}
              </span>
              {summary.snacks > 0 ? (
                <>
                  {' and '}
                  <span className="font-medium">
                    {summary.snacks} {summary.snacks === 1 ? 'snack' : 'snacks'}
                  </span>
                </>
              ) : null}{' '}
              went out across {summary.orders} {summary.orders === 1 ? 'order' : 'orders'}.
            </Notice>

            <Section
              title="What made up the sales"
              note="Every category sold, largest first. Together these are the total sales above."
            >
              <SalesTable rows={summary.byCategory} money={money} />
            </Section>

            <Section title="Which drinks" note="The same takings again, one row per size.">
              <SalesTable rows={summary.byProduct} money={money} />
            </Section>

            <Section title="How it was paid" note="What should be in the drawer, and what in each wallet.">
              <dl>
                {summary.payments.map((slice) => (
                  <LineRow
                    key={slice.method}
                    label={
                      <>
                        {slice.label}{' '}
                        <span className="text-ink-subtle">
                          ({slice.count} {slice.count === 1 ? 'payment' : 'payments'})
                        </span>
                      </>
                    }
                    value={money(slice.amount)}
                    leader
                  />
                ))}
              </dl>
            </Section>

            <Section
              title="What the cost of goods was"
              note="Read from the stock ledger — what actually left the shelf because something was sold."
            >
              {summary.byIngredient.length === 0 ? (
                <p className="py-2 text-[0.8125rem] text-ink-muted">
                  No stock movements on this day, so the cost above is what each sale recorded at the time rather
                  than what came off the shelf.
                </p>
              ) : (
                <CostTable rows={summary.byIngredient} money={money} />
              )}

              {summary.unexplainedCogs > 0 ? (
                <p className="mt-2 border-t border-line pt-2 text-[0.8125rem] text-ink-muted">
                  <Money className="font-medium text-ink">{money(summary.unexplainedCogs)}</Money> of the cost is not
                  accounted for by the ledger — a sale that recorded a cost without deducting stock, usually a
                  product with no recipe.
                </p>
              ) : null}
            </Section>

            <Section title="The bottom line" note="Where the takings ended up.">
              <dl>
                <LineRow label="Sales" value={money(summary.analytics.grossRevenue)} leader />
                <LineRow label={`Less: ${taxLabel} collected`} value={`−${money(summary.analytics.taxTotal)}`} muted leader />
                <LineRow label="Net sales" value={money(summary.pnl.netSales)} strong leader />
                <LineRow
                  label="Less: cost of ingredients and packaging"
                  value={`−${money(summary.analytics.cogsTotal)}`}
                  muted
                  leader
                />
                <LineRow
                  label="Gross profit"
                  value={money(summary.pnl.grossProfit)}
                  strong
                  leader
                  tone={summary.pnl.grossProfit > 0 ? 'positive' : summary.pnl.grossProfit < 0 ? 'danger' : undefined}
                />
                {summary.pnl.totalExpenses > 0 ? (
                  <LineRow label="Less: expenses" value={`−${money(summary.pnl.totalExpenses)}`} muted leader />
                ) : null}
                <LineRow
                  label="Net profit"
                  value={money(summary.pnl.netProfit)}
                  strong
                  leader
                  className="mt-1 border-t border-line-strong pt-2 [&_dd_span]:text-base"
                  tone={summary.pnl.netProfit > 0 ? 'positive' : summary.pnl.netProfit < 0 ? 'danger' : undefined}
                />
              </dl>
            </Section>

            {summary.uncostedSales > 0 ? (
              <Notice tone="warning">
                <span className="font-medium">{money(summary.uncostedSales)}</span> of the takings was entered as a
                single figure for the day, so it counts towards sales but has no cost behind it. The profit above is
                that much more flattering than the day really was.
              </Notice>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/** A headline figure in the Roastery register: label, Plex Mono figure, a hairline underneath. */
function Headline({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'positive' | 'danger'
}) {
  return (
    <div className="border-b border-line pb-3">
      <Micro>{label}</Micro>
      <Money
        className={cn(
          'mt-1 block text-2xl font-semibold',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </Money>
      {detail ? <p className="mt-0.5 text-[0.8125rem] text-ink-muted">{detail}</p> : null}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="border-b border-line pb-2">
        <h3 className="font-display text-lg font-medium tracking-tight text-ink">{title}</h3>
        <p className="mt-0.5 text-[0.8125rem] text-ink-muted">{note}</p>
      </div>
      <div className="pt-1">{children}</div>
    </section>
  )
}
```

Then, in the tables that remain: `SalesTable` (213–246) and `CostTable` (248–273) keep their structure with these substitutions — the header rows' `text-xs font-medium text-ink-muted` → `micro text-ink-subtle`, `px-4 py-2` → `px-0 py-2`; every row `px-4 py-2.5` → `px-0 py-2.5`; the empty-state `<p className="px-4 py-3 …">` → `<p className="py-2 …">`; `text-[0.6875rem] text-ink-subtle` share lines → `micro text-ink-subtle`. In `Cell` (275–282): `text-[0.6875rem] text-ink-subtle sm:hidden` → `micro text-ink-subtle sm:hidden`; `'tabular block text-[0.9375rem]'` → `'figure block text-[0.9375rem]'`. Delete the local `Row` (284–320). Keep `toIso`, `fromIso`, `longDate` and the `cn` import.

- [ ] **Step 5: `PlannerPanel.tsx`**

Import line 21 becomes `import { Button, Field, Input, Loading, Money, Notice, Panel, Sheet, Textarea } from '../../components/ui/primitives.tsx'`.

Line 48 → `return <Loading />`. `LockCard` (57–): line 80 `rounded-2xl border border-line bg-surface p-6 text-center` → `rounded-lg border border-line bg-surface p-6 text-center`; line 81 `rounded-full bg-surface-sunken` → `rounded-md bg-surface-sunken`; line 84 `text-base font-semibold text-ink` → `micro text-ink` (and wrap the sentence case: the text "The planner is locked" stays).

`Planner` (116–): lines 184 and 193 `rounded-xl p-2` → `rounded-md p-2`; line 189 `<h2 className="min-w-[9rem] text-center text-base font-semibold text-ink">` → `<h2 className="min-w-[9rem] text-center text-[0.9375rem] font-semibold text-ink">`. Line 213 `<section className="rounded-2xl border border-line bg-surface p-4">` → `<Panel>` … `</Panel>`. Line 231: `<p className="tabular text-lg font-semibold text-ink">` → `<Money className="block text-lg font-semibold text-ink">`. Line 234: `rounded-full bg-surface-sunken` → `rounded-sm bg-chart-track`; line 242: `'h-full rounded-full'` → `'h-full rounded-sm'` and `'bg-brand'` → `'bg-chart'`. Lines 266–283: `<section className="rounded-2xl border border-line bg-surface"><div className="flex … border-b …"><div><h3 …>Where the money goes</h3><p …>…</p></div><span …>{plan.allocatedPercent}%</span></div>` → `<Panel level={3} title="Where the money goes" note="Each share of the target, and what it is worth on what has actually come in." flush actions={<Money className={cn('text-sm font-medium', over ? 'text-danger' : 'text-ink-muted')}>{plan.allocatedPercent}%</Money>}>`; `</section>` → `</Panel>`. Line 314 `rounded-xl p-2` → `rounded-sm p-2`. Lines 322, 326, 356, 360: each `<span className="tabular …">` → `<Money className="…">`. Line 348: `<p className="text-[0.8125rem] text-danger">` → `<Notice tone="danger">` … `</Notice>`. Lines 367–376 (the Note `Field` with its `Input`) stay as they are; drop `Textarea` from this file's import.

`Small` (397–): line 399 `rounded-xl bg-surface-sunken px-3 py-2.5` → `rounded-md border border-line bg-surface px-3 py-2.5`; line 400 `tabular text-base font-semibold text-ink` → `figure text-base font-semibold text-ink`; line 401 `text-[0.8125rem] text-ink-muted` → `micro mt-0.5 text-ink-subtle`.

`PasscodeSheet` (407–): delete the `if (!open) return null` line (a `Sheet` handles `open` itself and needs to stay mounted for its exit animation). Replace the return (450–490) with:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      closeDisabled={busy}
      title={locked ? 'Planner passcode' : 'Add a passcode'}
      description="It is stored scrambled, the same way a PIN is — so a passcode that is forgotten cannot be looked up, only replaced by someone who knows the current one."
      footer={
        <div className="flex gap-2">
          {/* the existing three-button row from lines 469–489, verbatim: Cancel,
              Remove (when locked) and Save, with their disabled expressions */}
        </div>
      }
    >
      <div className="space-y-3">
        {/* the existing two Fields from lines 459–467, verbatim */}
      </div>
    </Sheet>
  )
```

- [ ] **Step 6: Typecheck, tests**

Run: `npm run typecheck`. Run: `npm test` — baseline counts.

- [ ] **Step 7: Look**

Reports → every tab at three widths, light and dark. *Shift:* open a shift with a float, put money in, take an X reading — the reading sheet is a docked sheet with a Fraunces title, micro section rules and dotted leaders between label and figure; close the shift — the confirm is a small centred sheet, the variance line is ink on a tint. *End of day:* the date is the Fraunces title; the four headlines are mono over hairlines; every section is a Fraunces heading with a dotted-leader list under it; at 375px the tables collapse to two columns as before. *Planner:* lock, unlock, add a passcode — the passcode sheet is a small centred sheet.

- [ ] **Step 8: Commit**

```bash
git add src/screens/ReportsScreen.tsx src/screens/reports/ShiftPanel.tsx src/screens/reports/ReadingSheet.tsx src/screens/reports/EndOfDayPanel.tsx src/screens/reports/PlannerPanel.tsx
git commit -m "Reports: TabStrip; shift and planner on Panel and Sheet; the reading and end of day in the Roastery voice with dotted leaders

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Staff

**Files:**
- Modify: `src/screens/StaffScreen.tsx`
- Rewrite the frame of: `src/screens/staff/StaffSheet.tsx`

**Interfaces:**
- Consumes: `Sheet`, `Choice`, `Chip`, `Notice`, `Micro`, `Panel` from Task 0.
- Behaviour preserved: the staff list and its `onClick`; `StaffSheet`'s draft, role choice, PIN handling (`tracking-[0.4em]` inputs, `inputMode`, `maxLength`), the permission overrides and their reset, the account section (deactivate / reset PIN), the weak-PIN notice.

- [ ] **Step 1: `StaffScreen.tsx`**

Lines 35–39: `<div className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-4 py-3"><div><p className="font-medium text-ink">Staff</p><p className="text-[0.8125rem] text-ink-subtle">…</p></div>` → `<div className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-3 py-2.5"><div><Micro className="text-ink">Staff</Micro><p className="text-[0.8125rem] text-ink-subtle">…</p></div>` (import `Micro`). Line 77: `'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold'` → `'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold'` (the initials tile matches the lock screen's square mark).

- [ ] **Step 2: `StaffSheet.tsx`**

Import line 27 becomes `import { Button, Choice, Chip, Field, Input, Notice, Sheet } from '../../components/ui/primitives.tsx'`; delete the Dialog import; drop `X` from lucide.

Replace lines 134–157 and 376–378 so the return reads:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="side"
      dismissible={!busy}
      closeDisabled={busy}
      title={/* the existing Dialog.Title child */}
      description={/* the existing Dialog.Description child, or undefined when the old code rendered none */}
    >
      <div className="space-y-5">
        {/* the existing body children, moved verbatim except for the rows below */}
      </div>
    </Sheet>
  )
```

| Line | Old | New |
|---|---|---|
| 167 | `<span className="text-[0.8125rem] font-medium text-ink-muted">Role</span>` | `<span className="micro block text-ink-subtle">Role</span>` |
| 170–183 | each role `<button …>` | `<Choice key={entry.id} active={role === entry.code} onClick={() => setRole(entry.code)} title={entry.name} />` |
| 201, 313 | `className="tabular text-center text-lg tracking-[0.4em]"` | `className="figure text-center text-lg tracking-[0.4em]"` |
| 223 | `<h3 className="text-sm font-medium text-ink">What they can do</h3>` | `<h3 className="micro text-ink">What they can do</h3>` |
| 243 | `text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle` | `micro text-ink-subtle` |
| 246 | `divide-y divide-line rounded-xl border border-line` | `divide-y divide-line rounded-md border border-line` |
| 260–277 | the per-permission `<button type="button" role="switch" …>` with its hand-drawn thumb | `<SwitchPrimitive.Root checked={allowed} onCheckedChange={() => void toggle(permission)} aria-label={PERMISSION_LABELS[permission]} className="relative h-6 w-11 shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-brand"><SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-surface shadow-card transition-transform data-[state=checked]:translate-x-[1.375rem]" /></SwitchPrimitive.Root>` — the row keeps its own label and description spans, so this is the bare switch rather than the labelled `Toggle`. Add `import * as SwitchPrimitive from '@radix-ui/react-switch'`. |
| 287 | `<h3 className="text-sm font-medium text-ink">Account</h3>` | `<h3 className="micro text-ink">Account</h3>` |
| 305 | `space-y-2 rounded-xl border border-line p-3` | `space-y-2 rounded-md border border-line p-3` |
| 391–393 (`WeakPinNotice`) | `<p className="flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] text-warning"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" …/>…</p>` | `<Notice tone="warning" icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}>…</Notice>` |

- [ ] **Step 3: Typecheck, tests**

Run: `npm run typecheck`. Run: `npm test` — baseline counts.

- [ ] **Step 4: Look**

Staff at three widths. Add someone: the sheet docks on tablet/laptop; the role tiles are 6px choices; PIN inputs are mono; the weak-PIN notice is ink on honey with a honey rule; the permissions list has micro group headings.

- [ ] **Step 5: Commit**

```bash
git add src/screens/StaffScreen.tsx src/screens/staff/StaffSheet.tsx
git commit -m "Staff on the shared Sheet with Choice tiles and a Notice for weak PINs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Settings — the tab strip and all seven panels

**Files:**
- Modify: `src/screens/SettingsScreen.tsx`
- Modify: `src/screens/settings/GeneralPanel.tsx`
- Modify: `src/screens/settings/BrandingPanel.tsx`
- Modify: `src/screens/settings/RulesPanel.tsx`
- Modify: `src/screens/settings/ListsPanel.tsx`
- Modify: `src/screens/settings/PrinterPanel.tsx`
- Modify: `src/screens/settings/AuditPanel.tsx` (and move `EntrySheet` onto `Sheet`)
- Modify: `src/screens/settings/BackupPanel.tsx`

**Interfaces:**
- Consumes: `TabStrip`, `Panel`, `Toggle`, `Choice`, `Chip`, `Notice`, `Loading`, `Money`, `Sheet`, `SearchInput`, `LineRow`, `Micro` from Task 0.
- Behaviour preserved: every `updateSettings` / `onAct` / `onSave` / `change` / `apply` / `save` / `pair` call and its audit string; every `disabled` expression (`!mayEdit || busy` and friends); the inline-name inputs in Rules and Lists with their blur saves; the Audit filters and export; the Backup restore flow including the `REPLACE` confirmation.

- [ ] **Step 1: `SettingsScreen.tsx`**

Replace lines 61–80 with:

```tsx
    <div className="flex h-full flex-col">
      <TabStrip tabs={tabs} active={active} onChange={setTab} />
```

Import `TabStrip` from `'../components/ui/primitives.tsx'`; delete the `cn` import.

- [ ] **Step 2: `GeneralPanel.tsx`**

Import line 7 becomes `import { Button, Chip, Field, Input, Loading, Notice, Panel, Toggle } from '../../components/ui/primitives.tsx'`.

Line 27 → `return <Loading />`. Line 47: `<p className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] text-warning">…</p>` → `<Notice tone="warning">…</Notice>`.

Replace the local `Card` (62–72) with a one-line wrapper so the call sites do not change:

```tsx
function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Panel title={title} icon={icon}>
      <div className="space-y-4 pt-2">{children}</div>
    </Panel>
  )
}
```

Delete the local `Toggle` (74–114) — the shared one has the same props (`label`, `hint`, `checked`, `disabled`, `onChange`); the old `onChange: () => void` handlers accept the boolean the shared one passes.

Line 174: `className="tabular text-right"` → `className="figure text-right"`. Lines 225–228: `<p className="flex items-start gap-2 rounded-xl bg-surface-sunken px-3.5 py-3 text-[0.8125rem] text-ink-muted"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" …/>` → `<Notice tone="neutral" icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}>` … `</Notice>`. Line 332: `<p className="text-[0.8125rem] font-medium text-ink">Payments that need a reference number</p>` → `<p className="micro text-ink">Payments that need a reference number</p>`. Lines 337–372 (the three reference-method buttons): the grid becomes `<div className="mt-2 flex flex-wrap gap-1.5">` and each button becomes

```tsx
              <Chip key={method} active={on} disabled={disabled} onClick={/* the same onAct(...) expression */}>
                {METHOD_LABELS[method]} · {on ? 'Required' : 'Optional'}
              </Chip>
```

- [ ] **Step 3: `BrandingPanel.tsx`**

Import line 7 becomes `import { Button, Choice, Field, Input, Loading, Panel } from '../../components/ui/primitives.tsx'`.

Line 89 → `return <Loading />`. Each `<section className="rounded-2xl border border-line bg-surface p-4"><h2 className="text-sm font-medium text-ink">TITLE</h2>` (127–128 Logo, 171–172 The shop, 219–220 Colours, 261–262 Light or dark) → `<Panel title="TITLE">`, with the closing `</section>` → `</Panel>` and the first child's `mt-1`/`mt-3` kept as they are (they space against the heading the same way). Line 135: `rounded-2xl border border-line bg-surface-sunken` → `rounded-md border border-line bg-surface-sunken`. Line 150 (the file input): `file:rounded-lg … file:bg-brand … file:font-medium file:text-brand-ink hover:file:bg-brand/90` → `file:rounded-md … file:bg-accent … file:font-semibold file:text-accent-ink hover:file:bg-accent/90`. Line 233: `rounded-xl border border-line` → `rounded-md border border-line-strong`. Line 240: `<code className="tabular shrink-0 …">` → `<code className="figure shrink-0 …">`. Lines 265–279 (the theme buttons): each becomes `<Choice key={theme.id} active={branding.theme === theme.id} disabled={!mayEdit || busy} onClick={() => void apply({ theme: theme.id })} title={theme.label} detail={theme.detail} />`.

- [ ] **Step 4: `RulesPanel.tsx`**

Import line 13 becomes `import { Choice, Field, Input, Loading, Notice, Panel, Toggle } from '../../components/ui/primitives.tsx'`.

Line 33 → `return <Loading />`. Line 56: the warning `<p>` → `<Notice tone="warning">…</Notice>`. Replace the local `Card` (71–82) with:

```tsx
function Card({ title, note, icon, children }: { title: string; note: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Panel title={title} note={note} icon={icon}>
      <div className="space-y-4 pt-2">{children}</div>
    </Panel>
  )
}
```

Delete the local `Toggle` (84–131). Line 158: `space-y-3 rounded-xl border border-line p-3` → `space-y-3 rounded-md border border-line p-3`. Lines 182, 274, 286, 335: `tabular` → `figure` in those `Input` classes. Lines 250–265 (the basis tiles): each becomes

```tsx
              <Choice
                key={option.value}
                active={rule.basis === option.value}
                disabled={disabled}
                onClick={() => change({ basis: option.value }, `Low stock measured by ${option.label}`)}
                title={option.label}
                detail={option.hint}
              />
```

Lines 296 and 362: `<p className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-ink-muted">…</p>` → `<Notice tone="neutral">…</Notice>`.

- [ ] **Step 5: `ListsPanel.tsx`**

Import line 23 becomes `import { Button, Chip, Choice, Field, Input, Notice, Panel, Toggle } from '../../components/ui/primitives.tsx'`.

Line 131: the warning `<p>` → `<Notice tone="warning">…</Notice>`. Lines 136–153 (the sub-tabs): `gap-1.5` stays; each `<button …>` becomes `<Chip key={entry.id} active={tab === entry.id} onClick={() => { setTab(entry.id); setAdding(false) }}>{entry.label}</Chip>`. Line 157: `<section className="overflow-hidden rounded-2xl border border-line bg-surface">` → `<Panel flush>` … `</Panel>`. Line 159: `<p className="px-4 py-3 …">Loading…</p>` stays (it is inline in a list, not a screen). Lines 287 and 305: `rounded-lg p-1.5` → `rounded-sm p-1.5`. Line 314: `bg-surface-sunken/40` → `bg-surface-sunken`.

`PaymentOptions` (330–): line 342 `<p className="mb-1.5 text-[0.8125rem] font-medium text-ink">How it behaves</p>` → `<p className="micro mb-1.5 text-ink">How it behaves</p>`; lines 345–358: each option `<button …>` → `<Choice key={option.value} active={entry.kind === option.value} disabled={disabled} onClick={() => onChange({ kind: option.value })} title={option.label} detail={option.hint} />`. `ExpenseOptions` (379–): lines 391–406: each `<button …>` → `<Choice key={value} active={entry.kind === value} disabled={disabled} onClick={() => onChange({ kind: value })} title={value === 'FIXED' ? 'Fixed' : 'Variable'} detail={value === 'FIXED' ? 'Arrives whatever you sell.' : 'Moves with how busy you are.'} />`. `RoleOptions` (411–): line 433 `text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle` → `micro text-ink-subtle`; lines 436–450: each permission `<button …>` → `<Chip size="sm" key={permission} active={held.has(permission)} disabled={disabled} onClick={() => toggle(permission)}>{PERMISSION_LABELS[permission] ?? permission}</Chip>`. Replace the local `Switch` (461–500) by deleting it and renaming its call sites to `Toggle` — same props (`label`, `hint`, `checked`, `disabled`, `onChange`).

- [ ] **Step 6: `PrinterPanel.tsx`**

Import line 18 becomes `import { Button, Choice, Loading, Panel } from '../../components/ui/primitives.tsx'`.

Line 91 → `return <Loading />`. Each `<section className="rounded-2xl border border-line bg-surface p-4"><h2 className="text-sm font-medium text-ink">TITLE</h2>` (126–127, 153–154, 195–196) → `<Panel title="TITLE">`; line 230–232 (`What it will look like`, with the two buttons beside it) → `<Panel title="What it will look like" actions={<>{/* the two existing Buttons */}</>}>`; every `</section>` → `</Panel>`. Lines 134–149 (paper widths): each `<button …>` becomes

```tsx
              <Choice
                key={width}
                active={config.paperWidth === width}
                disabled={!mayEdit || busy}
                onClick={() => void save({ paperWidth: width as PaperWidth })}
                title={`${width}mm`}
                detail={width === 58 ? '32 characters — the common small roll' : '48 characters — the wider roll'}
              />
```

Lines 156–178 (routes): each `<button …>` becomes

```tsx
              <Choice
                key={route.id}
                active={config.printRoute === route.id}
                disabled={!mayEdit || busy || !route.available}
                onClick={() => (route.id === 'BROWSER' ? void save({ printRoute: 'BROWSER' }) : void pair(route.id))}
                icon={<route.icon className="h-4 w-4" aria-hidden="true" />}
                title={`${route.label}${config.printRoute === route.id && paired && route.id !== 'BROWSER' ? ` — ${paired}` : ''}`}
                detail={route.detail}
                className={cn(!route.available && 'opacity-55')}
              />
```

Lines 197–228 (the two checkboxes): keep them as native checkboxes; their `<label>` classes stay; the `accent-[var(--brand)]` becomes `accent-[rgb(var(--brand))]` (the token is stored as channels, so the old value never resolved). Line 249: `rounded-xl bg-surface-sunken p-3 font-mono text-[0.6875rem]` → `rounded-md border border-line bg-surface-sunken p-3 font-mono text-[0.6875rem]`.

- [ ] **Step 7: `AuditPanel.tsx`**

Import line 18 becomes `import { Badge, Button, Chip, EmptyState, Loading, Micro, SearchInput, Sheet } from '../../components/ui/primitives.tsx'`; delete the Dialog import; drop `Search, X` from lucide.

Lines 97–119: the wrapper becomes `<div className="shrink-0 space-y-2.5 border-b border-line bg-surface px-3 py-2.5">` and the search block (98–119) becomes `<SearchInput value={text} onChange={setText} placeholder="Search what happened, who, or why" />`. Lines 121–152: the three chip rows keep their `<Chip>` calls — the shared `Chip` takes the same props; `gap-2` → `gap-1.5`. Line 156: the Loading div → `<Loading />`. Delete the local `Chip` (215–239).

`EntrySheet` (241–): replace lines 259–282 and 333–335 so the return reads:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="side"
      title={/* the existing Dialog.Title child */}
      description={/* the existing Dialog.Description child */}
    >
      <div className="space-y-4">
        {/* the existing body children, moved verbatim except for the rows below */}
      </div>
    </Sheet>
  )
```

| Line | Old | New |
|---|---|---|
| 284 | `rounded-xl bg-surface-sunken px-3 py-2.5 text-[0.9375rem] text-ink` | `rounded-md border-l-2 border-line-strong bg-surface-sunken px-3 py-2.5 text-[0.9375rem] text-ink` |
| 297 | `mb-2 border-b border-line pb-1 text-[0.8125rem] font-medium uppercase tracking-wide text-ink-subtle` | `micro mb-2 border-b border-line pb-1 text-ink-subtle` |
| 302 | `rounded-xl border border-line px-3 py-2` | `rounded-md border border-line px-3 py-2` |
| 303 | `text-[0.8125rem] font-medium text-ink` | `micro text-ink` |
| 343 | `mono ? 'font-mono text-xs' : ''` | `mono ? 'figure text-xs' : ''` |

- [ ] **Step 8: `BackupPanel.tsx`**

Import line 28 becomes `import { Button, Choice, Field, Input, LineRow, Notice, Panel } from '../../components/ui/primitives.tsx'`.

Each `<section className="rounded-2xl border border-line bg-surface p-4"><h2 className="flex items-center gap-2 text-sm font-medium text-ink"><Icon …/>TITLE</h2>` (189–193, 216–220, 242–246) → `<Panel title="TITLE" icon={<Icon className="h-4 w-4" aria-hidden="true" />}>`; the `<h3>` sections at 263–264 and 339–340 → `<Panel level={3} title="…">`; every `</section>` → `</Panel>`. Lines 229–232: `<p className="mt-2 flex items-start gap-1.5 text-[0.8125rem] text-warning"><TriangleAlert …/>…</p>` → `<Notice tone="warning" className="mt-2" icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}>…</Notice>`. Line 256 (the file input): the same `file:` recipe change as Branding (`file:rounded-md file:bg-accent file:font-semibold file:text-accent-ink hover:file:bg-accent/90`). Line 265: `<dl className="mt-3 space-y-1 text-[0.9375rem]">` → `<dl className="mt-3 space-y-0.5">`, and every `<Line label value strong? />` inside it → `<LineRow label value strong? />`; delete the local `Line` (483–489). Lines 276–292 (the checksum line): the `<p className={cn('mt-3 flex items-center gap-1.5 text-[0.8125rem]', inspection.checksumOk ? 'text-positive' : 'text-danger')}>` with its two branches becomes `<Notice tone={inspection.checksumOk ? 'positive' : 'danger'} className="mt-3" icon={inspection.checksumOk ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <TriangleAlert className="h-4 w-4" aria-hidden="true" />}>{inspection.checksumOk ? 'The file is intact and unaltered.' : 'The file does not match its own checksum.'}</Notice>`. Lines 296 and 301: `<p className="mt-2 rounded-xl bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">` → `<Notice tone="danger" className="mt-2">`; `<p className="mt-2 rounded-xl bg-warning/10 px-3 py-2 text-[0.8125rem] text-warning">` → `<Notice tone="warning" className="mt-2">`. Line 306: `rounded-xl border border-line` → `rounded-md border border-line`. Lines 310–313: `font-medium text-ink-muted` in the `<th>`s → `micro text-ink-subtle`. Lines 322–327: `tabular` → `figure`. Line 392: `mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3` → `mt-4 rounded-md border-l-2 border-danger bg-danger/10 p-3`. Replace the local `Choice` (451–481) by deleting it — the shared `Choice` has the same props (`active`, `onClick`, `title`, `detail`, `danger`).

- [ ] **Step 9: Typecheck, tests**

Run: `npm run typecheck`. Run: `npm test` — baseline counts.

- [ ] **Step 10: Look**

Settings → every tab at three widths, light and dark. Check: micro tab strip; every card is a `Panel` with a micro heading and, where it had one, an icon; every switch is a real switch; the reference-method, list and role selectors are chips; the paper width, print route, theme and basis selectors are 6px choice tiles; the file buttons are Caramel; Audit's search matches the till's and an entry opens as a docked sheet; Backup's warnings are ink on a tint with a rule and the REPLACE box has a berry rule.

- [ ] **Step 11: Commit**

```bash
git add src/screens/SettingsScreen.tsx src/screens/settings
git commit -m "Settings: TabStrip; every panel on Panel, Toggle, Choice, Chip and Notice; the audit entry on the shared Sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Setup, the sync sheet, the print block, and the acceptance grep

**Files:**
- Modify: `src/screens/SetupScreen.tsx`
- Modify: `src/screens/setup/StartFromBackup.tsx`
- Rewrite the frame of: `src/screens/SyncSheet.tsx`
- Modify: `src/index.css` (the `@media print` block only)

**Interfaces:**
- Consumes: `Chip`, `Notice`, `LineRow`, `Sheet`, `Panel`, `Micro`, `Money`, `Loading` from Task 0.
- Behaviour preserved: Setup's three modes, `handleSubmit`, the PIN validation, `starterMenu`; `JoinExisting` and `StartFromBackup` flows; `SyncSheet`'s enrol/unenrol/resolve calls and the `identity()` display; the printed receipt's character layout (`white-space: pre`, the monospace stack, the `@page` size).

- [ ] **Step 1: `SetupScreen.tsx`**

Import line 4 becomes `import { Button, Card, Chip, Field, Input, Notice } from '../components/ui/primitives.tsx'`.

Line 75: `rounded-2xl bg-brand text-brand-ink` → `rounded-md bg-brand text-brand-ink`. Line 78: `<h1 className="text-2xl font-semibold tracking-tight text-ink">` stays (Setup is worked, not read — no Fraunces). Lines 84–93: the three `<ModeTab …>` → `<Chip active={…} onClick={…}>…</Chip>` with the same expressions, inside `<div className="flex justify-center gap-1.5">`; delete `ModeTab` (195–224). Lines 132 and 142: `tabular` → `figure`. Lines 148–170 (the starter-menu checkbox button): `'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors'` → `'flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors'` and `'border-line bg-surface hover:bg-surface-sunken'` → `'border-line-strong bg-surface hover:bg-surface-sunken'`; the inner check square stays. Lines 174 and 275: `<p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>` → `<Notice tone="danger">{error}</Notice>`.

- [ ] **Step 2: `StartFromBackup.tsx`**

Import line 4 becomes `import { Button, Card, LineRow, Notice } from '../../components/ui/primitives.tsx'`. Line 74: `<h2 className="text-sm font-medium text-ink">Start from a backup</h2>` → `<h2 className="micro text-ink">Start from a backup</h2>`. Line 96: `<dl className="divide-y divide-line rounded-xl border border-line">` → `<dl className="divide-y divide-line rounded-md border border-line px-3.5">`; every `<Line label value />` → `<LineRow label value />`; delete the local `Line` (128–135) and the `cn` import if unused. Lines 104–107: `<p className="flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-[0.8125rem] text-danger"><TriangleAlert …/>` → `<Notice tone="danger" icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}>`; line 109: `<p className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-ink-muted">` → `<Notice tone="neutral">`.

- [ ] **Step 3: `SyncSheet.tsx`**

Import line 6 becomes `import { Button, Field, Input, Money, Notice, Panel, Sheet } from '../components/ui/primitives.tsx'`; delete the Dialog import; drop `X` from lucide.

Replace lines 68–81 and 260–262 so the return reads:

```tsx
  return (
    <Sheet open={open} onClose={onClose} placement="side" title="Synchronisation">
      <div className="space-y-6">
        {/* the existing body children, moved verbatim except for the rows below */}
      </div>
    </Sheet>
  )
```

| Line | Old | New |
|---|---|---|
| 82 | `<section className="rounded-2xl border border-line bg-surface-sunken p-4">` | `<section className="rounded-md border border-line bg-surface-sunken p-4">` |
| 85 | `<p className="font-medium text-ink">{copy.label}</p>` | `<p className="micro text-ink">{copy.label}</p>` |
| 114 | `<p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{status.lastError}</p>` | `<Notice tone="warning" className="mt-2 text-xs">{status.lastError}</Notice>` |
| 119, 127, 234 | `<h3 className="text-[0.8125rem] font-medium text-ink-muted">` | `<h3 className="micro text-ink-subtle">` |
| 120, 131 | `rounded-xl border border-line px-4 py-3` | `rounded-md border border-line px-4 py-3` |
| 122 | `font-mono text-xs text-ink-subtle` | `figure text-xs text-ink-subtle` |
| 151, 156 | `<p className="rounded-xl bg-surface-sunken px-3.5 py-3 text-[0.8125rem] text-ink-muted">` / the `<div className="flex items-start gap-2.5 rounded-xl bg-surface-sunken …">` with `CloudOff` | `<Notice tone="neutral">` / `<Notice tone="neutral" icon={<CloudOff className="h-4 w-4" aria-hidden="true" />}>` |
| 180 | `<p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-[0.8125rem] text-danger">{error}</p>` | `<Notice tone="danger">{error}</Notice>` |
| 191 | `<h3 className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-danger">` | `<h3 className="micro flex items-center gap-1.5 text-danger">` |
| 196 | `space-y-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3.5` | `space-y-2.5 rounded-md border-l-2 border-danger bg-danger/5 p-3.5` |
| 235 | `divide-y divide-line rounded-xl border border-line` | `divide-y divide-line rounded-md border border-line` |
| 240 | `font-mono text-xs text-ink-subtle` | `figure text-xs text-ink-subtle` |

`Stat` (266–280): line 270's class list `'tabular text-xl font-semibold'` → `'figure text-xl font-semibold'`; line 277 `text-xs text-ink-muted` → `micro mt-0.5 text-ink-subtle`.

- [ ] **Step 4: The print block in `src/index.css`**

Appearance only. In `#receipt-print-root`, the font stack `'Courier New', 'DejaVu Sans Mono', monospace` becomes `'IBM Plex Mono', 'Courier New', 'DejaVu Sans Mono', monospace` — the same face the app shows on screen, still monospace, so the column counting in `printing.ts` is unaffected. Add, after the `.receipt-body` rule:

```css
  /* Print the ink as ink: no browser "save toner" greying on a receipt. */
  #receipt-print-root,
  #receipt-print-root * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
```

Nothing else in the block changes. `printing.ts` and its byte output are not touched.

- [ ] **Step 5: Typecheck, tests, contrast, the acceptance grep**

Run: `npm run typecheck`. Run: `npm test` — baseline counts. Run: `npm run contrast` — exit 0.

Then, from `packages/web`, each of these must print nothing except where noted:

```bash
grep -rn "Dialog.Root\|Dialog.Content\|bg-black/45\|rounded-t-3xl\|rounded-3xl" src --include=*.tsx | grep -v "src/components/ui/primitives.tsx"
```

```bash
grep -rn "rounded-full border" src --include=*.tsx | grep -v "src/screens/LockScreen.tsx"
```

(The lock screen's PIN dots are legitimately round; the receipt's check mark circle lives in `ReceiptSheet.tsx` as `rounded-full bg-positive/15`, which this pattern does not match.)

```bash
grep -rn "bg-warning/10\|bg-danger/10 px\|bg-warning/20\|bg-warning/15" src/screens --include=*.tsx
```

```bash
grep -rn "<select" src --include=*.tsx | grep -v "src/components/ui/primitives.tsx"
```

```bash
grep -rn "^function \(Chip\|Toggle\|Switch\|Choice\|Line\|Row\|ModeTab\|ConfirmSheet\)(" src/screens --include=*.tsx
```

Expected for the last: exactly one line, `src/screens/reports/ShiftPanel.tsx:…:function ConfirmSheet(` — it wraps `Sheet` and is kept. Anything else listed is a private copy that was missed; go back to its task.

```bash
grep -rn "font-display" src --include=*.tsx
```

Expected: `LockScreen.tsx`, `ReceiptSheet.tsx`, `ReadingSheet.tsx`, `EndOfDayPanel.tsx` only.

- [ ] **Step 6: Look**

Clear site data (or use a fresh browser profile) so Setup shows. Check Setup at 375 and desktop: the three modes are chips, the error notice (submit with a bad PIN) is ink on a berry tint, *From a backup* shows the panel. Set up, sign in, open the connection chip on the chrome: the sync sheet docks right on tablet/laptop and rises from the bottom on the phone; the three stats are mono; the "not enrolled" notice is a neutral notice with a cloud icon. Ring up a sale, press Print, and in the browser's print preview confirm the receipt still lays out in columns (Plex Mono, 58mm).

- [ ] **Step 7: Commit**

```bash
git add src/screens/SetupScreen.tsx src/screens/setup/StartFromBackup.tsx src/screens/SyncSheet.tsx src/index.css
git commit -m "Setup and the sync sheet on the shared vocabulary; the printed receipt in Plex Mono

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Record it

**Files:**
- Modify: `docs/rework/ui-redesign.md`
- Modify: `docs/rework/README.md`

- [ ] **Step 1: `ui-redesign.md`**

Replace the `## Not yet built — Plan B` section with:

```markdown
## Built — Plan B (2026-09-13)

Every remaining screen on the Plan A vocabulary. `primitives.tsx` gained `Chip`, `TabStrip`, `SearchInput`, `Select`, `Textarea`, `Toggle` (Radix Switch), `Choice`, `Notice`, `Panel`, `LineRow`, `Loading` and an `actions` slot on `Sheet`; the ten dialogs that still carried their own Radix scaffold (sale, product, recipe, ingredient ×2, reading, shift close, planner passcode, staff, audit entry, sync) are on `Sheet`; the recipe editor's ingredient picker is a second sheet rather than a pane painted over the first. Dashboard, ledger, menu, recipes, stock, shift, planner, staff, settings, setup and sync are Counter; the end-of-day report and the shift reading are Roastery (Fraunces headings, micro-labels, dotted leaders). Tinted-text notices (`text-danger` on `bg-danger/10`, `text-warning` on `bg-warning/10`) are gone in favour of ink on a tint with a coloured rule. The print block's face is Plex Mono; `printing.ts` and its bytes are untouched. No `.ts` file changed.

Plan: `docs/superpowers/plans/2026-09-13-ui-redesign-b-screens.md`.
```

- [ ] **Step 2: `README.md`**

In the tracks table, change the UI row's state to `Direction confirmed. **Plan A built 2026-09-12**, **Plan B built 2026-09-13** on local `main`. All 49 `.tsx` files rebuilt; no `.ts` file changed in Plan B. Not pushed to `origin/main`.`

- [ ] **Step 3: Do not commit the docs** — `docs/` is the owner's to commit.
