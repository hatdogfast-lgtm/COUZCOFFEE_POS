# UI Redesign — Plan A: Foundation, Shell, Till, Roastery Surfaces, Android

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Couz Coffee palette and the approved "Counter till + Roastery reading surfaces" direction into the app: a light and a dark token layer that pass the contrast audit, rebuilt primitives, a shell that is phone-first and grows to tablet and laptop, the till rebuilt on those primitives, the lock screen and receipt in the Roastery voice, and the Android launcher/splash/status bars recoloured — with `npm test` unchanged and green throughout.

**Architecture:** Colour already resolves through CSS variables (`src/index.css` → `tailwind.config.js`), so the palette lands in the token layer and reaches every screen at once; the Tailwind radius and shadow scales are tightened so the whole app moves toward hairlines and 6–12px corners without editing every file. Type is IBM Plex Sans (body) + IBM Plex Mono (figures) with Fraunces reserved for the Roastery surfaces, self-hosted via `@fontsource` because the till runs offline. `primitives.tsx` gains a shared `Sheet` so the ten dialogs stop carrying their own scaffold. `PosScreen.tsx` (722 lines) is split into `PosScreen` / `MenuGrid` / `CartPanel`. The chrome (header, rail, cart bar) gets its own `chrome` token pair so it stays Deep Espresso in both themes while `brand` flips to a desaturated Caramel in dark.

**Tech Stack:** React 18, Tailwind 3.4, class-variance-authority, Radix Dialog, lucide-react, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, `@fontsource-variable/fraunces`, sharp (Android assets), Vitest.

**Spec:** `docs/rework/ui-redesign.md` (palette, contrast rules, responsive system, scope) and `docs/rework/README.md` (the logic freeze). Direction confirmed 2026-09-12: hybrid — Counter on the till, Roastery on receipt / lock screen / end-of-day / launcher / splash. Mockups: `https://claude.ai/code/artifact/f08ab82d-344b-47b0-a56e-11facc990df9`.

## Global Constraints

- **No `.ts` file changes** except the one declared exception in Task 6: `src/db/seed.ts` lines 57–59, three colour string literals, nothing else. `packages/shared`, `packages/server`, every `*.test.ts`: untouched. `src/app/providers.tsx` is `.tsx` but is plumbing per `README.md`; this plan touches it in exactly two places, both declared: the theme-colour meta (Task 0) and `useBranding` (Task 6, because the seeded brand colours would otherwise paint over the new palette on every existing shop).
- `npm test` (from `packages/web`) must pass **unchanged** at the end of every task: the same *Test Files* and *Tests* counts as the baseline recorded in Task 0 Step 0. (The tracked tree has 19 test files; the import plan's Task 0 deletes three untracked probe files, so run that first or expect 22.) `npm run typecheck` clean at the end of every task.
- Palette (light): Deep Espresso `#3B2416`, Coffee Brown `#6F4E37`, Caramel `#C88A4A`, Warm Cream `#F8F3EA`, Milk White `#FFFDF8`, Dark Roast `#241812`, Latte Gray `#796E65`, Matcha `#58734C`, Honey `#D49A3A`, Berry `#B84C45`. **Derived values** the palette does not supply, as the spec allows (`--pos-line`, `--pos-text2-aa`): hairline `#E8DFD0`, firm line `#D8CCB8`, sunken well `#F1E9DC`, active tint `#EFE3D3`, muted ink `#5C5148`, AA Latte Gray `#6A5F55`, **warning-as-text `#8A6314`** (Honey darkened until it reads: 4.90:1 on cream — because 28 call sites use `text-warning` for words, and words cannot be Honey), chrome-muted `#C9B9A6`. Every dark value is derived.
- **Contrast rules (build rules, from the spec):** Caramel and Honey are **fills only** — never text, never a small icon; the primary button is dark text on Caramel; the "low stock" chip is dark text on Honey; Latte Gray is darkened to `#6A5F55` for body-size text; cards need a real border (`#E8DFD0`) because cream on milk is 1.09:1. Text over a *tint* of its own colour (`text-positive` on `bg-positive/15`) is not measured by the script and loses ~10% of its ratio — so coloured notices use `text-ink` with a coloured left rule, and tinted badges use the 10% tint at most. `scripts/contrast.mjs` (Task 0) encodes the flat pairs and must exit 0.
- Chrome = the header and the phone order bar. It is Deep Espresso in **both** themes (in dark, espresso is the chrome on a deeper `#1C120C` ground — "Deep Espresso becomes the ground rather than the ink"). The nav rail and bottom tabs are `surface` with `brand` for the active item. `brand` is Deep Espresso in light and Caramel-family in dark. Primary button = `accent` (Caramel) + `accent-ink` in both themes.
- Radius: 6px on till tiles and chips (`rounded-md`); Tailwind `xl`/`2xl`/`3xl` become 10/12/16px so existing screens tighten without edits. Hairlines, not shadows: `shadow-card` becomes a 1px hairline; only sheets keep a real shadow.
- Type: `font-sans` = IBM Plex Sans; `font-mono` = IBM Plex Mono (every money figure); `font-display` = Fraunces (Roastery only: lock screen wordmark and keypad numerals, receipt queue number and shop name).
- Responsive: `< 640px` phone — order is a bar, bottom tabs; `640–1024px` tablet — order is a persistent right column, bottom tabs; `≥ 1024px` laptop — left rail, wider order column. Tailwind `sm` = 640, `lg` = 1024.
- Behaviour does not change. Every prop, handler, permission check, `useLiveQuery`, toast and `aria-*` in a rewritten file is carried over; only markup and classes change. Where a file is split, the split is by component, not by behaviour.
- Commit after each task with the message given. Do not commit `docs/`, `dist/`, or `android/app/build/`.
- All commands run from `packages/web`.

---

### Task 0: Fonts, tokens, scales, and the contrast gate

**Files:**
- Modify: `package.json` (three dependencies, one script)
- Modify: `src/main.tsx` (font imports)
- Modify: `src/index.css` lines 13–155 (tokens + component classes)
- Modify: `tailwind.config.js` (colours, fonts, radius, shadows)
- Modify: `src/app/providers.tsx` lines 92–93 (theme-colour meta)
- Create: `scripts/contrast.mjs`

**Interfaces:**
- Produces (Tailwind classes available to every later task): colours `canvas surface surface-raised surface-sunken line line-strong ink ink-muted ink-subtle brand brand-ink brand-soft brand-light accent accent-ink chrome chrome-ink chrome-muted chart chart-track positive warning honey honey-ink danger danger-ink`; fonts `font-sans font-mono font-display`; component classes `.card .panel .micro .figure .touch-target .press .scroll-pane`.

- [ ] **Step 0: Record the baseline and clear the decks**

Run: `npx vitest run 2>&1 | tail -5` on the untouched tree and write down the `Test Files N passed` / `Tests M passed` line — that pair is what "unchanged" means for the rest of this plan.

Then check `git status --short`. `packages/web/package.json` and the root `package-lock.json` already carry an unrelated uncommitted change (native backup saving via `@capacitor/filesystem` and `@capacitor/share`, together with `backup.ts`, `BackupPanel.tsx`, two gradle files and the Podfile). This plan's first commit stages both files. **Stop and ask the owner** whether that backup work should be committed first as its own commit (`Save backups to Documents and share them on Android`) or set aside with `git stash push -- packages/web/package.json package-lock.json packages/web/src/db/backup.ts packages/web/src/screens/settings/BackupPanel.tsx packages/web/android packages/web/ios` and restored afterwards. Do not sweep it into a font commit.

- [ ] **Step 1: Install the fonts**

```bash
npm install @fontsource/ibm-plex-sans@5 @fontsource/ibm-plex-mono@5 @fontsource-variable/fraunces@5
```

Then check the Fraunces file name: `ls node_modules/@fontsource-variable/fraunces/*.css`. The default export is `index.css` (weight axis) and declares `font-family: 'Fraunces Variable'`. If `opsz.css` exists, prefer it (optical sizing makes the 6xl queue number and the 11px micro-labels both look right).

- [ ] **Step 2: Import the fonts in `src/main.tsx`**

Add above `import './index.css'`:

```ts
// Self-hosted: the till runs offline, so a font fetched from a CDN is a font
// that is missing on the day the connection is.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource-variable/fraunces/opsz.css'
```

(Use `index.css` in place of `opsz.css` if Step 1 found no `opsz.css`.)

- [ ] **Step 3: Replace the token blocks in `src/index.css`**

(Line numbers in this step are pre-edit; after the first replacement the later ones shift, so locate each block by its content.)

Replace lines 13–78 (the `@layer base { :root {…} [data-theme='dark'] {…}` part, up to but not including `* { @apply border-line; }`) with:

```css
@layer base {
  /*
   * Couz Coffee palette, light.
   *
   * Two of the ten supplied colours cannot hold text on cream - Caramel
   * (2.64:1) and Honey (2.24:1) - so each is a fill with its own ink token,
   * and `warning` is a darker honey that reads as text. Latte Gray is 0.01
   * short of AA at body size; `ink-subtle` is the darkened one that passes.
   * Cream on milk is 1.09:1, so a card is told from the page by `line`, not
   * by fill. `scripts/contrast.mjs` checks every pair below.
   */
  :root {
    --canvas: 248 243 234; /* Warm Cream   #F8F3EA */
    --surface: 255 253 248; /* Milk White   #FFFDF8 */
    --surface-raised: 255 253 248;
    --surface-sunken: 241 233 220; /* a well in the cream */

    --line: 232 223 208; /* hairline     #E8DFD0 */
    --line-strong: 216 204 184; /* inputs, chips #D8CCB8 */

    --ink: 36 24 18; /* Dark Roast   #241812 */
    --ink-muted: 92 81 72; /* 6.97:1 */
    --ink-subtle: 106 95 85; /* Latte Gray, AA  #6A5F55 */

    --brand: 59 36 22; /* Deep Espresso #3B2416 */
    --brand-ink: 248 243 234;
    --brand-soft: 239 227 211; /* active tint */
    --brand-light: 111 78 55; /* Coffee Brown #6F4E37 */

    --accent: 200 138 74; /* Caramel - fill only #C88A4A */
    --accent-ink: 36 24 18; /* 5.92:1 on Caramel */

    /* The chrome - header, rail, cart bar - is espresso in both themes. */
    --chrome: 59 36 22;
    --chrome-ink: 248 243 234;
    --chrome-muted: 201 185 166; /* 7.57:1 on espresso */

    --chart: 111 78 55; /* Coffee Brown, 6.74:1 */
    --chart-track: 232 223 208;

    --positive: 88 115 76; /* Matcha       #58734C 4.78:1 */
    --positive-ink: 255 255 255; /* 5.20:1 on Matcha */
    --warning: 138 99 20; /* honey, dark enough to read  4.90:1 */
    --honey: 212 154 58; /* Honey - fill only #D49A3A */
    --honey-ink: 36 24 18; /* 6.99:1 on Honey */
    --danger: 184 76 69; /* Berry Red    #B84C45 4.57:1 */
    --danger-ink: 255 246 244;

    --safe-top: env(safe-area-inset-top, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --safe-left: env(safe-area-inset-left, 0px);
    --safe-right: env(safe-area-inset-right, 0px);
  }

  /*
   * Dark. Deep Espresso becomes the ground rather than the ink: it is the
   * chrome, on a ground a shade deeper so the chrome still reads as a bar.
   * The surfaces are Dark Roast; Caramel loses saturation so it does not
   * glare, and takes the `brand` role because espresso on espresso is
   * invisible. Every ratio re-measured against the new ground - see
   * scripts/contrast.mjs.
   */
  [data-theme='dark'] {
    --canvas: 28 18 12; /* #1C120C, a shade under espresso */
    --surface: 36 24 18; /* Dark Roast as surface */
    --surface-raised: 46 32 24;
    --surface-sunken: 21 13 8;

    --line: 62 46 36;
    --line-strong: 84 64 50;

    --ink: 248 243 234;
    --ink-muted: 205 191 175;
    --ink-subtle: 176 160 143;

    --brand: 214 168 110; /* Caramel, desaturated  #D6A86E */
    --brand-ink: 36 24 18;
    --brand-soft: 58 42 30;
    --brand-light: 201 151 106;

    --accent: 227 190 142; /* #E3BE8E */
    --accent-ink: 36 24 18;

    --chrome: 59 36 22; /* Deep Espresso, the same bar in both themes */
    --chrome-ink: 248 243 234;
    --chrome-muted: 201 185 166;

    --chart: 214 168 110;
    --chart-track: 62 46 36;

    --positive: 157 190 144;
    --positive-ink: 36 24 18; /* light Matcha carries dark ink */
    --warning: 221 170 72;
    --honey: 221 170 72;
    --honey-ink: 36 24 18;
    --danger: 232 150 142;
    --danger-ink: 42 14 12;
  }
```

Then replace the `@layer components { … }` block (lines 130–155) with:

```css
@layer components {
  /* A card is told from the page by its edge, not its fill or a shadow. */
  .card {
    @apply rounded-lg border border-line bg-surface;
  }

  .panel {
    @apply rounded-lg border border-line bg-surface;
  }

  /* Touch targets: 44px is the floor on a tablet a barista uses one-handed. */
  .touch-target {
    @apply min-h-[44px] min-w-[44px];
  }

  .press {
    @apply transition-transform duration-100 ease-swift active:scale-[0.97];
  }

  /* The letterspaced micro-label: section headings, chips, the odd caption. */
  .micro {
    @apply text-[0.6875rem] font-semibold uppercase tracking-[0.12em];
  }

  /* Money and counts: monospaced and tabular, so a column never re-flows. */
  .figure {
    @apply font-mono tabular-nums tracking-tight;
    font-feature-settings: 'tnum';
  }

  .skeleton {
    @apply relative overflow-hidden bg-surface-sunken;
  }
  .skeleton::after {
    @apply absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-black/5 to-transparent;
    content: '';
  }
}
```

Leave everything else in the file (base rules, utilities, the `@media print` blocks) exactly as it is. In the `body` rule (line 91) change `@apply bg-canvas text-ink antialiased;` to `@apply bg-canvas font-sans text-ink antialiased;`.

- [ ] **Step 4: Replace `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour resolves through a CSS variable so the owner's brand
        // settings can repaint the light theme at runtime without a rebuild.
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--surface-raised) / <alpha-value>)',
        'surface-sunken': 'rgb(var(--surface-sunken) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--ink-muted) / <alpha-value>)',
        'ink-subtle': 'rgb(var(--ink-subtle) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        'brand-ink': 'rgb(var(--brand-ink) / <alpha-value>)',
        'brand-soft': 'rgb(var(--brand-soft) / <alpha-value>)',
        'brand-light': 'rgb(var(--brand-light) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        chrome: 'rgb(var(--chrome) / <alpha-value>)',
        'chrome-ink': 'rgb(var(--chrome-ink) / <alpha-value>)',
        'chrome-muted': 'rgb(var(--chrome-muted) / <alpha-value>)',
        chart: 'rgb(var(--chart) / <alpha-value>)',
        'chart-track': 'rgb(var(--chart-track) / <alpha-value>)',
        positive: 'rgb(var(--positive) / <alpha-value>)',
        'positive-ink': 'rgb(var(--positive-ink) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        honey: 'rgb(var(--honey) / <alpha-value>)',
        'honey-ink': 'rgb(var(--honey-ink) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'danger-ink': 'rgb(var(--danger-ink) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        display: ['Fraunces Variable', 'Fraunces', 'Georgia', 'Times New Roman', 'serif'],
      },
      // Counter: 6px on the things you tap at a rush, a little more on the
      // things you read. The old 14/18/24px corners read as a consumer app.
      borderRadius: {
        xl: '10px',
        '2xl': '12px',
        '3xl': '16px',
      },
      // Hairlines, not elevation. Only something that floats gets a shadow.
      boxShadow: {
        card: '0 1px 0 rgb(59 36 22 / 0.05)',
        raised: '0 1px 2px rgb(59 36 22 / 0.06), 0 8px 24px -12px rgb(59 36 22 / 0.25)',
        overlay: '0 24px 64px -12px rgb(36 24 18 / 0.45)',
      },
      transitionTimingFunction: {
        swift: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 160ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-up': 'slide-up 200ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 5: Theme-colour meta in `src/app/providers.tsx`**

Line 93: `meta?.setAttribute('content', dark ? '#0f1115' : '#f7f7f5')` becomes `meta?.setAttribute('content', dark ? '#150D08' : '#3B2416')` — the browser/PWA status bar matches the espresso chrome.

- [ ] **Step 6: Write the contrast gate `scripts/contrast.mjs`**

```js
/**
 * The palette's build rules, as a test.
 *
 * Reads the token blocks straight out of src/index.css so the numbers checked
 * are the numbers shipped, then measures every pair the design depends on at
 * WCAG AA: 4.5:1 for text, 3:1 for large text and chart marks. Fails the
 * build if any pair slips - a colour that "looks fine" on one screen is how
 * a caption becomes unreadable on a till in sunlight.
 *
 * Run: npm run contrast
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = await readFile(path.join(here, '../src/index.css'), 'utf8')

function tokens(selector) {
  const start = css.indexOf(selector)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const block = css.slice(open + 1, close)
  const out = {}
  for (const match of block.matchAll(/--([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
    out[match[1]] = [Number(match[2]), Number(match[3]), Number(match[4])]
  }
  return out
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** [foreground, background, minimum, why] */
const RULES = [
  ['ink', 'canvas', 4.5, 'body text on the page'],
  ['ink', 'surface', 4.5, 'body text on a card'],
  ['ink', 'surface-sunken', 4.5, 'body text in a well'],
  ['ink-muted', 'canvas', 4.5, 'secondary text on the page'],
  ['ink-muted', 'surface', 4.5, 'secondary text on a card'],
  ['ink-muted', 'surface-sunken', 4.5, 'secondary text in a well'],
  ['ink-subtle', 'canvas', 4.5, 'captions on the page'],
  ['ink-subtle', 'surface', 4.5, 'captions on a card'],
  ['brand', 'canvas', 4.5, 'brand as text'],
  ['brand-ink', 'brand', 4.5, 'text on a brand fill'],
  ['brand', 'brand-soft', 4.5, 'active chip text'],
  ['brand-light', 'canvas', 4.5, 'headings in Coffee Brown'],
  ['accent-ink', 'accent', 4.5, 'the primary button'],
  ['chrome-ink', 'chrome', 4.5, 'text on the chrome'],
  ['chrome-muted', 'chrome', 4.5, 'secondary text on the chrome'],
  ['chart', 'canvas', 3, 'chart marks'],
  ['positive', 'canvas', 4.5, 'Matcha as text'],
  ['positive', 'surface', 4.5, 'Matcha as text on a card'],
  ['positive-ink', 'positive', 4.5, 'text on a Matcha fill'],
  ['warning', 'canvas', 4.5, 'warning as text'],
  ['warning', 'surface', 4.5, 'warning as text on a card'],
  ['honey-ink', 'honey', 4.5, 'the low-stock chip'],
  ['danger', 'canvas', 4.5, 'Berry as text'],
  ['danger', 'surface', 4.5, 'Berry as text on a card'],
  ['danger-ink', 'danger', 4.5, 'text on a danger fill'],
  ['line-strong', 'surface', 1.3, 'an input edge is visible'],
  ['line', 'surface', 1.1, 'a card edge is visible'],
]

let failed = 0
for (const [name, selector] of [
  ['light', ':root {'],
  ['dark', "[data-theme='dark'] {"],
]) {
  const t = tokens(selector)
  console.log(`\n${name}`)
  for (const [fg, bg, min, why] of RULES) {
    if (!t[fg] || !t[bg]) {
      console.log(`  MISSING ${fg} / ${bg}`)
      failed++
      continue
    }
    const r = ratio(t[fg], t[bg])
    const ok = r >= min
    if (!ok) failed++
    console.log(`  ${ok ? ' ok ' : 'FAIL'}  ${r.toFixed(2).padStart(6)}  ${fg} on ${bg}  (${why}, needs ${min})`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} pair${failed === 1 ? '' : 's'} below the line.`)
  process.exit(1)
}
console.log('\nEvery pair clears AA.')
```

Add to `package.json` scripts: `"contrast": "node scripts/contrast.mjs"`.

- [ ] **Step 7: Run the gate, typecheck, build, tests**

Run: `npm run contrast && npm run typecheck && npx vite build && npx vitest run`
Expected: contrast prints two blocks, every row `ok`, exits 0; typecheck clean; build succeeds (fonts bundled under `dist/assets/*.woff2`); the baseline Test Files / Tests counts.

- [ ] **Step 8: Look at it**

Start the dev server and open the till. Expected: cream page, Plex Sans body, every corner tighter, buttons still the old espresso-brown because the seeded branding overrides `--brand` (that is fixed in Task 6). Add an item and check the `₱` in the cart total: it must be the Plex Mono glyph, the same weight and baseline as the digits, not a fallback from another face. Switch Settings → Shop → Theme to Dark: dark-roast surfaces, caramel buttons, cream text. Nothing is broken; nothing is redesigned yet.

- [ ] **Step 9: Commit**

The lockfile lives at the repository root, not in the workspace:

```bash
git add package.json ../../package-lock.json src/main.tsx src/index.css tailwind.config.js src/app/providers.tsx scripts/contrast.mjs
git commit -m "Couz palette as the token layer, light and dark, with a contrast gate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1: Primitives on the new tokens, plus a shared Sheet

**Files:**
- Rewrite: `src/components/ui/primitives.tsx`

**Interfaces:**
- Produces (every later task consumes these):
  ```ts
  Button: variant 'primary' | 'strong' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'positive'; size 'sm' | 'md' | 'lg' | 'xl' | 'icon'; full?: boolean; asChild?: boolean
  Card, Input, Field({ label, hint?, error?, children, className? }), Badge({ tone }), EmptyState, Figure, Spinner   // unchanged signatures
  Micro({ children, className? })                        // letterspaced micro-label
  Money({ children, className? })                        // mono tabular span
  Sheet({ open, onClose, title, description?, children, footer?, size?: 'sm'|'md'|'lg', placement?: 'center'|'side', dismissible?: boolean, closeDisabled?: boolean })
  ```
  Existing callers of `Button`, `Card`, `Input`, `Field`, `Badge`, `EmptyState`, `Figure`, `Spinner` compile unchanged. `primary` is now Caramel with dark ink; `strong` is the old espresso primary.

- [ ] **Step 1: Replace the file**

```tsx
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.ts'

/**
 * Interface primitives.
 *
 * Sized for a counter: the default control is 44px tall, which is the smallest
 * target a barista can hit reliably while holding a jug of milk. Nothing here
 * is smaller unless it is purely decorative.
 *
 * The palette's rules live here so the screens do not have to know them: the
 * primary button is dark text on Caramel because Caramel cannot carry light
 * text; a warning badge is dark text on Honey for the same reason; and a card
 * has an edge because cream on milk is invisible without one.
 */

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold no-select press disabled:pointer-events-none disabled:opacity-45 transition-colors',
  {
    variants: {
      variant: {
        /** The one action on the screen: Caramel, dark ink. */
        primary: 'bg-accent text-accent-ink hover:bg-accent/90',
        /** Espresso. For chrome-adjacent actions and the odd second emphasis. */
        strong: 'bg-brand text-brand-ink hover:bg-brand/90',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-sunken',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-surface-sunken',
        ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        danger: 'bg-danger text-danger-ink hover:bg-danger/90',
        positive: 'bg-positive text-positive-ink hover:bg-positive/90',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[0.9375rem]',
        lg: 'h-14 px-6 text-base',
        xl: 'h-16 px-8 text-lg',
        icon: 'h-11 w-11',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', full: false },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, full, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return (
      <Component ref={ref} className={cn(buttonStyles({ variant, size, full }), className)} {...props} />
    )
  },
)
Button.displayName = 'Button'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border border-line bg-surface', className)} {...props} />
  ),
)
Card.displayName = 'Card'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-md border border-line-strong bg-surface px-3.5 text-[0.9375rem] text-ink',
        'placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
        'disabled:opacity-50 transition-colors',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

/** The letterspaced micro-label: section headings, chip text, the odd caption. */
export function Micro({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('micro block text-ink-subtle', className)}>{children}</span>
}

/** A money figure or a count. Monospaced and tabular, so a column never re-flows. */
export function Money({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('figure', className)}>{children}</span>
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <Micro>{label}</Micro>
      {children}
      {error ? (
        <span className="block text-[0.8125rem] text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-[0.8125rem] text-ink-subtle">{hint}</span>
      ) : null}
    </label>
  )
}

const badgeStyles = cva('micro inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5', {
  variants: {
    tone: {
      neutral: 'bg-surface-sunken text-ink-muted',
      brand: 'bg-brand-soft text-brand',
      /** A 10% tint at most: Matcha clears AA on cream by only 0.28. */
      online: 'bg-positive/10 text-positive',
      pending: 'bg-honey text-honey-ink',
      /** Honey cannot carry light text, so the chip is solid with dark ink. */
      warning: 'bg-honey text-honey-ink',
      danger: 'bg-danger text-danger-ink',
      offline: 'bg-ink-subtle/15 text-ink-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeStyles> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon ? <div className="text-ink-subtle">{icon}</div> : null}
      <div className="space-y-1">
        <p className="font-medium text-ink">{title}</p>
        {description ? <p className="max-w-sm text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** A large, unmissable figure - the kind a cashier reads at a glance. */
export function Figure({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: string
  value: string
  tone?: 'default' | 'brand' | 'positive' | 'danger'
  className?: string
}) {
  const toneClass = {
    default: 'text-ink',
    brand: 'text-brand',
    positive: 'text-positive',
    danger: 'text-danger',
  }[tone]

  return (
    <div className={cn('space-y-1', className)}>
      <Micro>{label}</Micro>
      <p className={cn('figure text-2xl font-semibold', toneClass)}>{value}</p>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

const SHEET_SIZES = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg' } as const

/**
 * The one dialog frame.
 *
 * A bottom sheet on a phone, because that is where a thumb is; centred on a
 * tablet or laptop, or docked to the right edge for something you keep
 * open while reading the screen behind it. The header and footer stay put
 * and the body scrolls, so the action is never below the fold.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  placement = 'center',
  dismissible = true,
  closeDisabled = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: keyof typeof SHEET_SIZES
  /** `side` docks to the right edge on a tablet or laptop instead of centring. */
  placement?: 'center' | 'side'
  /** Whether tapping the scrim or pressing Escape closes it. */
  dismissible?: boolean
  closeDisabled?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && dismissible && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 animate-fade-in" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-2xl border-t border-line-strong bg-surface shadow-overlay animate-slide-up',
            placement === 'center'
              ? cn('sm:inset-0 sm:m-auto sm:h-fit sm:rounded-2xl sm:border sm:animate-scale-in', SHEET_SIZES[size])
              : 'sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0 sm:animate-slide-in-right',
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4 sm:pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[1.0625rem] font-semibold text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 line-clamp-2 text-sm text-ink-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" disabled={closeDisabled}>
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane min-h-0 flex-1 px-5 py-5">{children}</div>

          {footer ? (
            <footer className="shrink-0 border-t border-line px-5 py-4 pad-safe-bottom">{footer}</footer>
          ) : (
            <div className="pad-safe-bottom" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 2: Typecheck, tests**

Run: `npm run typecheck && npx vitest run`
Expected: clean; the baseline counts. (Nothing uses `Sheet`, `Micro` or `Money` yet.)

- [ ] **Step 3: Look at it**

Open Settings → Shop. Field labels are now uppercase micro-labels; primary buttons are caramel with dark text; inputs have the firmer edge. Open the Menu → Products list: badges are chips with dark text on honey where they used to be honey text.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/primitives.tsx
git commit -m "Primitives on the Couz tokens: caramel primary, honey chips, micro labels, one shared Sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The shell — espresso chrome, bottom tabs to 1024px, rail beyond

**Files:**
- Rewrite: `src/app/AppShell.tsx`
- Modify: `src/components/ConnectionBadge.tsx` — add an `onChrome` prop for the header

**Interfaces:**
- Consumes: `Button` from Task 1; `chrome`/`chrome-ink`/`chrome-muted` tokens from Task 0.
- Produces: `ConnectionBadge({ onClick?, compact?, onChrome? })` — `onChrome` renders the compact badge as a chip legible on the espresso header.

- [ ] **Step 1: `ConnectionBadge` on the chrome**

In `src/components/ConnectionBadge.tsx` change the signature and the outer classes:

```tsx
export function ConnectionBadge({
  onClick,
  compact = false,
  onChrome = false,
}: {
  onClick?: () => void
  compact?: boolean
  /** Rendered on the espresso header, where a cream chip reads and a tinted one does not. */
  onChrome?: boolean
}) {
```

Add, next to `TONE_CLASSES`, the chip styles for the chrome — the state still reads by colour there, as a fill with its own ink rather than as tinted text:

```tsx
/** On the espresso header: a cream chip when all is well, a solid one when it is not. */
const CHROME_CHIP_CLASSES: Record<string, string> = {
  online: 'border-chrome-ink/20 bg-chrome-ink/10 text-chrome-ink',
  offline: 'border-chrome-ink/20 bg-chrome-ink/10 text-chrome-ink',
  pending: 'border-honey bg-honey text-honey-ink',
  warning: 'border-honey bg-honey text-honey-ink',
  danger: 'border-danger bg-danger text-danger-ink',
}
```

Replace the `return (` block's outer `className` (the `cn(...)` on the `Component`) with:

```tsx
      className={cn(
        'group flex items-center gap-2 text-left transition-colors touch-target',
        onChrome ? cn('micro rounded-sm border px-2 py-1', CHROME_CHIP_CLASSES[tone]) : 'rounded-md px-3 py-2',
        onClick
          ? onChrome
            ? 'hover:opacity-90 focus-visible:ring-2 focus-visible:ring-chrome-ink/40'
            : 'hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-brand/40'
          : 'cursor-default',
      )}
```

Replace the icon `<span className={cn('relative flex h-8 w-8 …', TONE_CLASSES[tone])}>` with:

```tsx
      <span
        className={cn(
          'relative flex items-center justify-center rounded-md',
          onChrome ? 'h-5 w-5 bg-transparent' : cn('h-8 w-8', TONE_CLASSES[tone]),
        )}
      >
        <Icon className={cn(onChrome ? 'h-3.5 w-3.5' : 'h-4 w-4', status.state === 'SYNCING' && 'animate-spin')} aria-hidden="true" />
        {status.realtimeConnected ? (
          <span
            className={cn('absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-positive ring-2', onChrome ? 'ring-chrome' : 'ring-surface')}
            title="Receiving live updates"
          />
        ) : null}
      </span>
      {onChrome ? <span>{copy.label}</span> : null}
```

Everything else in the file (the non-compact body, `ConnectionBanner`) stays as it is, except in `ConnectionBanner` change `'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'` to `'border-l-2 border-danger bg-danger/10 text-ink' : 'border-l-2 border-honey bg-honey/15 text-ink'` — the colour moves into a left rule and the icon (add `text-danger` / `text-warning` to the `<Icon>` via the same ternary), and the words are ink, because Berry over a Berry tint drops under AA.

- [ ] **Step 2: Rewrite `src/app/AppShell.tsx`**

```tsx
import { useState, type ComponentType } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ChartLine, LogOut, Receipt, Settings, ShoppingCart, UtensilsCrossed, Users } from 'lucide-react'
import type { Permission } from '@pos/shared'
import { roleLabel } from '@pos/shared'
import { ConnectionBadge, ConnectionBanner } from '../components/ConnectionBadge.tsx'
import { SyncSheet } from '../screens/SyncSheet.tsx'
import { PosScreen } from '../pos/PosScreen.tsx'
import { MenuScreen } from '../screens/MenuScreen.tsx'
import { ReportsScreen } from '../screens/ReportsScreen.tsx'
import { LedgerScreen } from '../screens/LedgerScreen.tsx'
import { StaffScreen } from '../screens/StaffScreen.tsx'
import { SettingsScreen, SETTINGS_PERMISSIONS } from '../screens/SettingsScreen.tsx'
import { useSession, useSettings } from './providers.tsx'
import { cn } from '../lib/utils.ts'

/**
 * The frame around every screen.
 *
 * Hash routing, deliberately: it behaves identically in the browser, in an
 * installed PWA and inside the native Android shell, and it makes the Android
 * back button work without any extra handling.
 *
 * Navigation is filtered by what the signed-in person may actually do, so a
 * cashier is never shown a door they cannot open. It sits at the bottom on a
 * phone and a tablet - where a thumb is - and moves to a rail on a laptop,
 * where a mouse has no thumb zone.
 */

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Any one of these is enough to reach the screen. */
  permissions: Permission[]
}

const NAV: NavItem[] = [
  { to: '/', label: 'Till', icon: ShoppingCart, permissions: ['pos.sell'] },
  { to: '/sales', label: 'Sales', icon: Receipt, permissions: ['sales.view'] },
  { to: '/menu', label: 'Menu', icon: UtensilsCrossed, permissions: ['product.view'] },
  { to: '/reports', label: 'Reports', icon: ChartLine, permissions: ['report.view', 'shift.xreading', 'planner.manage'] },
  { to: '/staff', label: 'Staff', icon: Users, permissions: ['staff.view'] },
  { to: '/settings', label: 'Settings', icon: Settings, permissions: SETTINGS_PERMISSIONS },
]

export function AppShell() {
  const { settings } = useSettings()
  const { user, signOut, can } = useSession()
  const [showSync, setShowSync] = useState(false)

  const items = NAV.filter((item) => item.permissions.some(can))
  const businessName = settings?.branding.businessName ?? 'Point of Sale'

  return (
    <HashRouter>
      <div className="flex h-full flex-col bg-canvas">
        <header className="flex shrink-0 items-center gap-3 bg-chrome px-3 pb-2.5 pt-2 text-chrome-ink pad-safe-top">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {settings?.branding.logoDataUrl ? (
              <img src={settings.branding.logoDataUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-ink">
                {businessName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-[0.8125rem] font-semibold leading-tight">{businessName}</p>
              <p className="truncate text-[0.6875rem] leading-tight text-chrome-muted">
                {user?.name}
                {user ? ` · ${roleLabel(user.role)}` : ''}
              </p>
            </div>
          </div>

          {/* Anyone may see the status; only some roles may open what is behind it. */}
          <ConnectionBadge compact onChrome onClick={can('sync.view') ? () => setShowSync(true) : undefined} />
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-md text-chrome-muted transition-colors hover:bg-chrome-ink/10 hover:text-chrome-ink"
          >
            <LogOut className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
          </button>
        </header>

        <ConnectionBanner />

        <div className="flex min-h-0 flex-1">
          {/* A rail on a laptop; the bottom bar takes over below 1024px. */}
          {items.length > 1 ? (
            <nav className="hidden w-[5rem] shrink-0 flex-col gap-0.5 border-r border-line-strong bg-surface p-1.5 lg:flex">
              {items.map((item) => (
                <RailLink key={item.to} item={item} />
              ))}
            </nav>
          ) : null}

          <main className="min-w-0 flex-1">
            <Routes>
              <Route path="/" element={<PosScreen />} />
              <Route
                path="/sales"
                element={can('sales.view') ? <LedgerScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/menu"
                element={can('product.view') ? <MenuScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/reports"
                element={
                  can('report.view') || can('shift.xreading') || can('planner.manage') ? (
                    <ReportsScreen />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="/staff"
                element={can('staff.view') ? <StaffScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/settings"
                element={
                  SETTINGS_PERMISSIONS.some(can) ? (
                    <SettingsScreen />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>

        {items.length > 1 ? (
          <nav className="flex shrink-0 border-t border-line-strong bg-surface pad-safe-bottom lg:hidden">
            {items.map((item) => (
              <TabLink key={item.to} item={item} />
            ))}
          </nav>
        ) : null}

        <SyncSheet open={showSync} onClose={() => setShowSync(false)} />
      </div>
    </HashRouter>
  )
}

function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-1 rounded-md px-1 py-2.5 text-center transition-colors no-select press',
          isActive ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="micro">{item.label}</span>
    </NavLink>
  )
}

function TabLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 transition-colors no-select touch-target',
          isActive ? 'text-brand' : 'text-ink-subtle',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="micro text-[0.625rem]">{item.label}</span>
    </NavLink>
  )
}
```

Note the two behaviour-preserving points: the `ConnectionBanner` moved *below* the header so the chrome stays flush with the status bar, and the sign-out button is a plain button on the chrome because the ghost `Button` variant is styled for cream.

- [ ] **Step 3: Typecheck, tests, look**

Run: `npm run typecheck && npx vitest run`
Then resize the browser through 400px / 800px / 1200px. Expected: espresso header with caramel mark; bottom tabs at 400 and 800; left rail at 1200; the connection chip reads on the header; the offline banner appears below the header, with a honey left rule.

- [ ] **Step 4: Commit**

```bash
git add src/app/AppShell.tsx src/components/ConnectionBadge.tsx
git commit -m "Shell: espresso chrome, bottom tabs to 1024px, rail beyond, connection chip on the chrome

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The till — split into three files, Counter styling, three widths

**Files:**
- Rewrite: `src/pos/PosScreen.tsx` (state, layout, sheets)
- Create: `src/pos/MenuGrid.tsx` (search, category chips, product tiles)
- Create: `src/pos/CartPanel.tsx` (the order, totals, actions)

**Interfaces:**
- Consumes: `Badge`, `Button`, `EmptyState`, `Micro`, `Money` from Task 1; `useCart`, `checkout.ts`, `repo.ts`, `till.ts`, `lowStock.ts`, `shopLists.ts`, `shift.ts` unchanged.
- Produces:
  ```ts
  // MenuGrid.tsx
  export interface LowStockRule { settings: BusinessSettings | null | undefined; rates: Map<string, number> }
  export function MenuGrid(props: { menu: MenuData; products: Product[]; stock: StockMap; lowStock: LowStockRule; categoryId: string; search: string; onCategory: (id: string) => void; onSearch: (term: string) => void; onSelect: (product: Product) => void })
  // CartPanel.tsx
  export function CartPanel(props: { cart: ReturnType<typeof useCart>; totals: OrderTotals | null; onCheckout: () => void; onDiscount: () => void; canDiscount: boolean; timing: TimingChoice; customAt: number; onTiming: (next: TimingChoice) => void; onCustomAt: (next: number) => void; mayBackdate: boolean; onClose?: () => void })
  ```
  `CartPanel`'s props are exactly the old private component's props.

- [ ] **Step 1: Create `src/pos/MenuGrid.tsx`**

One piece of copy changes on purpose: the sold-out chip reads `Out` instead of `Sold out`, because in the 3-up phone grid the uppercase tracked badge beside a mono price does not fit at 360px. `ProductSheet`'s per-size *Out of stock* label has room and stays.

```tsx
import { Search, ShoppingBag, X } from 'lucide-react'
import type { BusinessSettings, Product } from '@pos/shared'
import { availabilityOf, type MenuData, type StockMap } from '../db/repo.ts'
import { Badge, EmptyState, Money } from '../components/ui/primitives.tsx'
import { useMoney } from '../app/providers.tsx'
import { cn } from '../lib/utils.ts'

/**
 * The menu half of the till.
 *
 * Three tiles across on a phone, four on a laptop: nine items on screen at a
 * rush without scrolling. Tiles are hairline-edged, not shadowed, and the
 * price is set in the monospace face so a column of them lines up.
 */

/** The shop's low-stock rule, and how fast each ingredient is going. */
export interface LowStockRule {
  settings: BusinessSettings | null | undefined
  rates: Map<string, number>
}

export function MenuGrid({
  menu,
  products,
  stock,
  lowStock,
  categoryId,
  search,
  onCategory,
  onSearch,
  onSelect,
}: {
  menu: MenuData
  products: Product[]
  stock: StockMap
  lowStock: LowStockRule
  categoryId: string
  search: string
  onCategory: (id: string) => void
  onSearch: (term: string) => void
  onSelect: (product: Product) => void
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-line px-3 pb-2.5 pt-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search the menu"
            className="h-10 w-full rounded-md border border-line-strong bg-surface pl-9 pr-9 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ink-subtle hover:bg-surface-sunken"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="scroll-pane -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          <CategoryChip active={categoryId === 'all'} onClick={() => onCategory('all')}>
            All
          </CategoryChip>
          {menu.categories.map((category) => (
            <CategoryChip
              key={category.id}
              active={categoryId === category.id}
              onClick={() => onCategory(category.id)}
            >
              {category.name}
            </CategoryChip>
          ))}
        </div>
      </div>

      <div className="scroll-pane flex-1 px-3 py-3">
        {products.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="h-8 w-8" aria-hidden="true" />}
            title={search ? 'Nothing matches that search' : 'No products in this category'}
            description={
              search ? 'Try a different word, or clear the search.' : 'Add products from the menu settings.'
            }
          />
        ) : (
          <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-4 lg:gap-2">
            {products.map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                menu={menu}
                stock={stock}
                lowStock={lowStock}
                onSelect={() => onSelect(product)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors press no-select',
        active
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-line-strong bg-surface text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function ProductTile({
  product,
  menu,
  stock,
  lowStock,
  onSelect,
}: {
  product: Product
  menu: MenuData
  stock: StockMap
  lowStock: LowStockRule
  onSelect: () => void
}) {
  const money = useMoney()
  const variants = menu.variantsByProduct.get(product.id) ?? []
  const cheapest = variants.reduce<number | null>(
    (lowest, variant) => (lowest === null || variant.price < lowest ? variant.price : lowest),
    null,
  )

  // A product is only truly unavailable when none of its sizes can be made.
  const availabilities = variants.map((variant) => availabilityOf(variant.id, menu, stock, lowStock))
  const soldOut =
    !product.available || (availabilities.length > 0 && availabilities.every((entry) => entry.outOfStock))
  const low =
    !soldOut && availabilities.some((entry) => entry.low || (entry.makeable !== Infinity && entry.makeable <= 5))

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={soldOut}
      className={cn(
        'flex min-h-[5.25rem] flex-col justify-between rounded-md border border-line bg-surface p-2.5 text-left transition-colors press no-select',
        'hover:border-brand-light',
        soldOut && 'opacity-50 hover:border-line',
      )}
    >
      <div className="min-w-0">
        <p className="line-clamp-2 text-[0.8125rem] font-medium leading-tight text-ink">{product.name}</p>
        {variants.length > 1 ? (
          <p className="mt-0.5 text-[0.6875rem] text-ink-subtle">{variants.length} sizes</p>
        ) : null}
      </div>

      <div className="mt-2 flex items-end justify-between gap-1">
        <Money className="text-[0.9375rem] font-semibold text-ink">
          {cheapest !== null ? money(cheapest) : '—'}
        </Money>
        {soldOut ? <Badge tone="danger">Out</Badge> : low ? <Badge tone="warning">Low</Badge> : null}
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Create `src/pos/CartPanel.tsx`**

Move the old `CartPanel` (PosScreen.tsx lines 436–722) here, with these exact changes and no others:

```tsx
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BadgePercent, ClipboardCheck, Gift, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import type { OrderTotals, OrderTypeEntry } from '@pos/shared'
import { Button, EmptyState, Micro, Money } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings } from '../app/providers.tsx'
import type { useCart } from './useCart.ts'
import { claimedValue } from './checkout.ts'
import { listOrderTypes } from '../db/shopLists.ts'
import { EndOfShiftSheet } from './EndOfShiftSheet.tsx'
import { LumpSumEntry, OrderTiming, yesterdayAtSameTime, type TimingChoice } from './OrderEntryPanels.tsx'
import { countLines } from '../db/till.ts'
import { cn } from '../lib/utils.ts'

/**
 * The order half of the till.
 *
 * A column beside the menu on a tablet or laptop, and the sheet behind the
 * order bar on a phone. Same component in both places; only the frame around
 * it changes.
 */
export function CartPanel({
  cart,
  totals,
  onCheckout,
  onDiscount,
  canDiscount,
  timing,
  customAt,
  onTiming,
  onCustomAt,
  mayBackdate,
  onClose,
}: {
  cart: ReturnType<typeof useCart>
  totals: OrderTotals | null
  onCheckout: () => void
  onDiscount: () => void
  canDiscount: boolean
  timing: TimingChoice
  customAt: number
  onTiming: (next: TimingChoice) => void
  onCustomAt: (next: number) => void
  /** Whether this person may record an order for another day. */
  mayBackdate: boolean
  /** Present only where the panel is shown as an overlay. */
  onClose?: () => void
}) {
  const money = useMoney()
  const { settings } = useSettings()
  const { can } = useSession()
  const [endingShift, setEndingShift] = useState(false)

  const canSeeShift = can('shift.xreading') || can('shift.close') || can('shift.zreading')
  const orderTypes = useLiveQuery(() => listOrderTypes(), [], [] as OrderTypeEntry[])

  // Cups and snacks are counted separately, because a coffee shop measures
  // its day in cups and a pastry is not one.
  const counts = countLines(cart.cart.lines)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Micro className="text-ink">Current order</Micro>
          {counts.cups > 0 ? (
            <span className="figure rounded-sm bg-brand-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold text-brand">
              {counts.cups} {counts.cups === 1 ? 'cup' : 'cups'}
            </span>
          ) : null}
          {counts.snacks > 0 ? (
            <span className="figure rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] font-semibold text-ink-muted">
              {counts.snacks} {counts.snacks === 1 ? 'snack' : 'snacks'}
            </span>
          ) : null}
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        ) : !cart.isEmpty ? (
          <Button variant="ghost" size="sm" onClick={cart.clear}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="scroll-pane min-h-0 flex-1">
        {cart.isEmpty ? (
          <EmptyState
            icon={<ShoppingBag className="h-7 w-7" aria-hidden="true" />}
            title="Nothing added yet"
            description="Tap an item on the menu to start the order."
          />
        ) : (
          <ul className="divide-y divide-line">
            {cart.cart.lines.map((line) => (
              <li key={line.id} className="px-4 py-3">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {line.productName}
                      {line.variantName ? <span className="text-ink-muted"> · {line.variantName}</span> : null}
                    </p>
                    {line.modifiers.length > 0 ? (
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {line.modifiers.map((modifier) => modifier.optionName).join(', ')}
                      </p>
                    ) : null}
                    {line.note ? <p className="mt-0.5 text-xs italic text-ink-subtle">“{line.note}”</p> : null}
                  </div>
                  <span className="shrink-0 text-right">
                    <Money className="block text-sm font-semibold text-ink">
                      {money(
                        (line.unitPrice + line.modifiers.reduce((sum, m) => sum + m.priceDelta, 0)) * line.quantity -
                          claimedValue(line),
                      )}
                    </Money>
                    {claimedValue(line) > 0 ? (
                      <Money className="block text-xs font-medium text-positive">
                        {line.loyaltyFreeQty} free · −{money(claimedValue(line))}
                      </Money>
                    ) : null}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => cart.setQuantity(line.id, line.quantity - 1)}
                    aria-label="Fewer"
                  >
                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Money className="w-8 text-center text-sm font-semibold text-ink">{line.quantity}</Money>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => cart.setQuantity(line.id, line.quantity + 1)}
                    aria-label="More"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>

                  {/* How many of this line go on the loyalty card. They are
                      still made, so their stock and cost stay exactly as they
                      are - only the money comes off. */}
                  {(line.loyaltyFreeQty ?? 0) === 0 ? (
                    <button
                      type="button"
                      onClick={() => cart.setLoyaltyQty(line.id, 1)}
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-subtle transition-colors press hover:text-ink"
                    >
                      <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                      Claim free
                    </button>
                  ) : (
                    <span className="ml-auto flex items-center gap-1 rounded-md border border-positive bg-positive/10 py-0.5 pl-2 pr-0.5">
                      <Gift className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => cart.setLoyaltyQty(line.id, (line.loyaltyFreeQty ?? 0) - 1)}
                        className="rounded-sm p-1 text-positive hover:bg-positive/15"
                        aria-label="Claim one fewer"
                      >
                        <Minus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <Money className="min-w-4 text-center text-xs font-semibold text-positive">
                        {line.loyaltyFreeQty}
                      </Money>
                      <button
                        type="button"
                        onClick={() => cart.setLoyaltyQty(line.id, (line.loyaltyFreeQty ?? 0) + 1)}
                        disabled={(line.loyaltyFreeQty ?? 0) >= line.quantity}
                        className="rounded-sm p-1 text-positive hover:bg-positive/15 disabled:opacity-40"
                        aria-label="Claim one more"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <span className="pr-1.5 text-xs font-medium text-positive">free</span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* When the order happened, and the way to record a day that predates
          the system. Both are hidden unless the shop has turned backdating on
          and this person is allowed to use it - a control nobody can use is
          clutter on a screen that is used under pressure. */}
      {mayBackdate ? (
        <div className="shrink-0 space-y-4 border-t border-line px-4 py-3">
          <OrderTiming choice={timing} customAt={customAt} onChoice={onTiming} onCustomAt={onCustomAt} />
          {cart.isEmpty ? (
            <LumpSumEntry defaultAt={timing === 'CUSTOM' ? customAt : yesterdayAtSameTime()} />
          ) : null}
        </div>
      ) : null}

      {/* How the order is being taken. Only shown when the shop offers more
          than one way, because a single choice is not a choice. */}
      {orderTypes.length > 1 && !cart.isEmpty ? (
        <div className="shrink-0 border-t border-line px-4 py-3">
          <Micro className="mb-1.5">Order type</Micro>
          <div className="flex flex-wrap gap-1.5">
            {orderTypes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => cart.setOrderType(entry.code)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors press',
                  cart.cart.orderType === entry.code
                    ? 'border-brand bg-brand-soft text-ink'
                    : 'border-line-strong text-ink-muted hover:text-ink',
                )}
              >
                {entry.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Closing up. Only with an empty cart: an order half rung up is not a
          day that is over, and the summary would be read as if it were. */}
      {cart.isEmpty && canSeeShift ? (
        <div className="shrink-0 border-t border-line px-4 py-3">
          <Button variant="secondary" full onClick={() => setEndingShift(true)}>
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            End of shift
          </Button>
          <EndOfShiftSheet open={endingShift} onClose={() => setEndingShift(false)} />
        </div>
      ) : null}

      {!cart.isEmpty && totals ? (
        <div className="space-y-3 border-t border-line-strong px-4 py-4 pad-safe-bottom">
          {totals.discounts.length > 0 ? (
            <ul className="space-y-1.5">
              {totals.discounts.map((discount) => (
                <li key={discount.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-positive">
                    <BadgePercent className="h-3.5 w-3.5" aria-hidden="true" />
                    {discount.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <Money className="text-positive">-{money(discount.amount)}</Money>
                    <button
                      type="button"
                      onClick={() => cart.removeDiscount(discount.id)}
                      className="rounded-sm p-0.5 text-ink-subtle hover:bg-surface-sunken"
                      aria-label={`Remove ${discount.label}`}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd>
                <Money className="text-ink">{money(totals.subtotal)}</Money>
              </dd>
            </div>
            {totals.taxExemptTotal > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">VAT exempt</dt>
                <dd>
                  <Money className="text-positive">-{money(totals.taxExemptTotal)}</Money>
                </dd>
              </div>
            ) : null}
            {totals.taxTotal > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">
                  {settings?.tax.label} {settings?.tax.inclusive ? '(included)' : ''}
                </dt>
                <dd>
                  <Money className="text-ink">{money(totals.taxTotal)}</Money>
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <Micro className="text-ink">Total</Micro>
            <Money className="text-2xl font-semibold text-ink">{money(totals.total)}</Money>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" size="lg" onClick={onDiscount} disabled={!canDiscount} aria-label="Discount">
              <BadgePercent className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="lg" className="col-span-2" onClick={onCheckout}>
              Charge
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `src/pos/PosScreen.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { lowStockOf, type OrderTotals, type Product, type Sale } from '@pos/shared'
import { db } from '../db/database.ts'
import { loadMenu, stockLevels, type StockMap } from '../db/repo.ts'
import { Money } from '../components/ui/primitives.tsx'
import { useMoney, useSession, useSettings, useSyncStatus } from '../app/providers.tsx'
import { useCart } from './useCart.ts'
import {
  claimedValue,
  completeSale,
  loyaltyDiscount,
  totalsFor,
  type CartLine,
  type TenderInput,
} from './checkout.ts'
import { usageRates } from '../db/lowStock.ts'
import { ensureShift } from './shift.ts'
import { ProductSheet } from './ProductSheet.tsx'
import { PaymentSheet } from './PaymentSheet.tsx'
import { DiscountSheet } from './DiscountSheet.tsx'
import { ReceiptSheet } from './ReceiptSheet.tsx'
import { yesterdayAtSameTime, type TimingChoice } from './OrderEntryPanels.tsx'
import { MenuGrid } from './MenuGrid.tsx'
import { CartPanel } from './CartPanel.tsx'
import { countLines, tillPolicy } from '../db/till.ts'

/**
 * The till.
 *
 * Everything on this screen reads from the device's own database, so it
 * behaves the same whether or not there is a connection. The only thing the
 * network changes is the small indicator in the corner.
 *
 * Three widths, one till. On a phone the menu owns the screen and the order
 * is a bar along the bottom that opens as a sheet. From 640px the order is a
 * column beside the menu and stays there; from 1024px the column widens and
 * the grid goes to four across.
 */
export function PosScreen() {
  const money = useMoney()
  const { settings } = useSettings()
  const { user, can } = useSession()

  // Backdating is both a shop-wide switch and a permission: the shop decides
  // whether the feature exists at all, and the roles decide who may use it.
  const mayBackdate = tillPolicy(settings).backdatingEnabled && can('pos.backdate')
  const status = useSyncStatus()
  const cart = useCart()

  const [categoryId, setCategoryId] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [showDiscount, setShowDiscount] = useState(false)
  const [showCartOnMobile, setShowCartOnMobile] = useState(false)
  const [timing, setTiming] = useState<TimingChoice>('NOW')
  const [customAt, setCustomAt] = useState(() => yesterdayAtSameTime())
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<{
    sale: Sale
    totals: OrderTotals
    lines: CartLine[]
    payments: TenderInput[]
    change: number
  } | null>(null)

  // The menu and the stock ledger both re-read whenever their tables change,
  // including when a change arrives from another device via sync.
  const menu = useLiveQuery(
    () =>
      db
        .transaction('r', [db.categories, db.products, db.productVariants, db.modifierGroups, db.modifierOptions, db.recipes, db.recipeIngredients, db.ingredients], () =>
          loadMenu(),
        ),
    [],
  )
  const stock = useLiveQuery(() => stockLevels(), [], new Map() as StockMap)

  // How fast each ingredient is going, so "low" can mean "about to run out"
  // rather than a number somebody typed in months ago. Read once for the
  // screen: it is the same answer for every tile on it.
  const rates = useLiveQuery(
    () => usageRates(lowStockOf(settings ?? {}).lookbackDays),
    [settings?.lowStock?.lookbackDays],
    new Map<string, number>(),
  )
  const lowStock = { settings, rates }

  const products = useMemo(() => {
    if (!menu) return []
    const term = search.trim().toLowerCase()
    return menu.products.filter((product) => {
      if (categoryId !== 'all' && product.categoryId !== categoryId) return false
      if (!term) return true
      return (
        product.name.toLowerCase().includes(term) ||
        product.description.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term)
      )
    })
  }, [menu, categoryId, search])

  /**
   * Lines marked as a loyalty claim are given away.
   *
   * They stay in the order at menu price so the receipt shows what they were
   * worth, and a matching discount takes that value straight back off. Their
   * stock and cost are untouched - the drink is still made.
   */
  const loyaltyValue = useMemo(
    () => cart.cart.lines.reduce((sum, line) => sum + claimedValue(line), 0),
    [cart.cart.lines],
  )

  const effectiveDiscounts = useMemo(
    () => (loyaltyValue > 0 ? [...cart.cart.discounts, loyaltyDiscount(loyaltyValue)] : cart.cart.discounts),
    [cart.cart.discounts, loyaltyValue],
  )

  const totals = useMemo(
    () => (settings ? totalsFor(cart.cart.lines, effectiveDiscounts, settings) : null),
    [cart.cart.lines, effectiveDiscounts, settings],
  )

  const occurredAt =
    timing === 'NOW' ? undefined : timing === 'YESTERDAY' ? yesterdayAtSameTime() : customAt

  async function handlePayment(payments: TenderInput[]): Promise<void> {
    if (!settings || !user || !menu || !totals) return
    setBusy(true)
    try {
      const shift = await ensureShift(user)

      // The claim was already decided line by line, and is carried in
      // `effectiveDiscounts`. Nothing about the payment method changes it.
      const result = await completeSale({
        lines: cart.cart.lines,
        discounts: effectiveDiscounts,
        payments,
        settings,
        cashier: user,
        shiftId: shift.id,
        orderType: cart.cart.orderType,
        customerName: cart.cart.customerName,
        note: cart.cart.note,
        menu,
        online: status.online,
        occurredAt,
      })

      setReceipt({
        sale: result.sale,
        totals: result.totals,
        lines: cart.cart.lines,
        payments,
        change: result.changeDue,
      })
      setShowPayment(false)
      setShowCartOnMobile(false)
      cart.clear()
      setTiming('NOW')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The sale could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  if (!menu || !settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading the menu…</div>
    )
  }

  const panelProps = {
    cart,
    totals,
    mayBackdate,
    onCheckout: () => setShowPayment(true),
    onDiscount: () => setShowDiscount(true),
    canDiscount: can('pos.discount.standard'),
    timing,
    customAt,
    onTiming: setTiming,
    onCustomAt: setCustomAt,
  }
  const counts = countLines(cart.cart.lines)
  const summary = [
    counts.cups > 0 ? `${counts.cups} ${counts.cups === 1 ? 'cup' : 'cups'}` : '',
    counts.snacks > 0 ? `${counts.snacks} ${counts.snacks === 1 ? 'snack' : 'snacks'}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex min-h-0 flex-1">
        <MenuGrid
          menu={menu}
          products={products}
          stock={stock ?? new Map()}
          lowStock={lowStock}
          categoryId={categoryId}
          search={search}
          onCategory={setCategoryId}
          onSearch={setSearch}
          onSelect={setActiveProduct}
        />

        {/* The order: a column from tablet width up, a sheet on a phone. */}
        <aside className="hidden w-[18rem] shrink-0 border-l border-line-strong bg-surface sm:flex sm:flex-col lg:w-[22rem]">
          <CartPanel {...panelProps} />
        </aside>
      </div>

      {/* The order bar. Espresso, so it reads as part of the chrome; the
          Charge button is the only caramel thing on the screen. */}
      {!cart.isEmpty ? (
        <div className="flex shrink-0 items-center gap-3 bg-chrome px-3 py-2.5 text-chrome-ink pad-safe-bottom sm:hidden">
          <button
            type="button"
            onClick={() => setShowCartOnMobile(true)}
            className="min-w-0 flex-1 text-left"
            aria-label={`View order, ${cart.itemCount} items`}
          >
            <Money className="block text-[1.0625rem] font-semibold leading-tight">{money(totals?.total ?? 0)}</Money>
            <span className="block truncate text-[0.6875rem] text-chrome-muted">
              {summary || `${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'}`} · view order
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowPayment(true)}
            className="rounded-md bg-accent px-4 py-2.5 text-[0.8125rem] font-bold text-accent-ink press"
          >
            Charge
          </button>
        </div>
      ) : null}

      {showCartOnMobile ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface pad-safe-top sm:hidden animate-slide-up">
          {/* The panel carries its own heading, so the overlay adds only a way
              out of it - two "Current order" titles was one too many. */}
          <CartPanel {...panelProps} onClose={() => setShowCartOnMobile(false)} />
        </div>
      ) : null}

      <ProductSheet
        product={activeProduct}
        menu={menu}
        stock={stock ?? new Map()}
        open={activeProduct !== null}
        onClose={() => setActiveProduct(null)}
        onAdd={cart.add}
      />

      {totals ? (
        <PaymentSheet
          open={showPayment}
          totals={totals}
          busy={busy}
          onClose={() => setShowPayment(false)}
          onConfirm={handlePayment}
        />
      ) : null}

      <DiscountSheet open={showDiscount} onClose={() => setShowDiscount(false)} onApply={cart.addDiscount} />

      <ReceiptSheet
        open={receipt !== null}
        sale={receipt?.sale ?? null}
        totals={receipt?.totals ?? null}
        lines={receipt?.lines ?? []}
        payments={receipt?.payments ?? []}
        change={receipt?.change ?? 0}
        onClose={() => setReceipt(null)}
      />
    </div>
  )
}
```

One deliberate behaviour addition, called out so it is not missed in review: the phone order bar now has a **Charge** button that opens the payment sheet directly (`setShowPayment(true)`), alongside the total which opens the order sheet. Previously the whole bar opened the order sheet. `handlePayment` already closes both. If the owner prefers the old one-tap-to-review flow, delete the second button — nothing else depends on it.

- [ ] **Step 4: Typecheck, tests**

Run: `npm run typecheck && npx vitest run`
Expected: clean; the baseline counts (`checkout.test.ts` and `till.test.ts` exercise the logic this screen calls and are untouched).

- [ ] **Step 5: Look at it at three widths**

- 390px: 3-up tiles, ~9 visible; add three items; the espresso bar shows the total, "2 cups · 1 snack · view order", and a caramel Charge; tapping the total opens the order sheet; Charge opens payment; complete a cash sale; the receipt shows.
- 800px: order column (18rem) on the right, 3-up grid, bottom tabs still there, no bar.
- 1280px: left rail, 4-up grid, 22rem column.
- Dark theme at 390px: chrome is the deep sunken tone, tiles dark roast with visible hairlines, Charge is light caramel with dark text.

- [ ] **Step 6: Commit**

```bash
git add src/pos/PosScreen.tsx src/pos/MenuGrid.tsx src/pos/CartPanel.tsx
git commit -m "Till: Counter tiles and chips, order column from 640px, espresso order bar on a phone

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The till's sheets on the shared `Sheet`

**Files:**
- Modify: `src/pos/ProductSheet.tsx` (the Dialog scaffold and the footer → `Sheet`)
- Modify: `src/pos/PaymentSheet.tsx` (same)
- Modify: `src/pos/DiscountSheet.tsx` (same)
- Modify: `src/pos/EndOfShiftSheet.tsx` (delete the local `Sheet`; import the shared one)
- Modify: `src/pos/OrderEntryPanels.tsx` (class recipe only)

**Interfaces:**
- Consumes: `Sheet` from Task 1.
- Produces: nothing new. Every prop of the four sheets is unchanged.

The edits below are described by **content, not line numbers** — each file's JSX must end in the shape shown, and the body that sat between the old header and the old footer is moved as a block, not spliced. After each file: `npm run typecheck` (a stray `</div>` or `</footer>` shows up there first).

- [ ] **Step 1: `ProductSheet.tsx`**

Target shape of the `return (…)`:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={product.name}
      description={product.description || undefined}
      placement="side"
      footer={
        <div className="space-y-3">
          {/* the old footer's children, verbatim except two classes: the stepper row gains `gap-3`
              and its frame `rounded-xl border border-line` becomes `rounded-md border border-line-strong` */}
        </div>
      }
    >
      <div className="space-y-6">
        {/* the old body: everything that was inside `<div className="scroll-pane flex-1 space-y-6 px-5 py-5">` */}
      </div>
    </Sheet>
  )
```

How to get there: (1) cut the whole old `<footer className="space-y-3 border-t border-line bg-surface px-5 py-4 pad-safe-bottom">…</footer>` block (it sits after the body) and keep it aside; (2) replace everything from `<Dialog.Root` through the closing `</header>` and the following blank line with the `<Sheet …` opener above, pasting the cut footer's *children* (not the `<footer>` element itself) inside the `<div className="space-y-3">`; (3) the old body `div` keeps `space-y-6` and loses `scroll-pane flex-1 px-5 py-5` — the `Sheet` provides scrolling and padding; (4) replace the trailing `</Dialog.Content>` `</Dialog.Portal>` `</Dialog.Root>` with `</Sheet>`. The `space-y-3` wrapper matters: the shared `Sheet` footer has no vertical spacing of its own, and the old footer's three children (stepper row, Add button, supervisor note) relied on it.

Body class recipe: the size buttons and the option buttons `rounded-xl` → `rounded-md`; the note input `rounded-xl border border-line` → `rounded-md border border-line-strong`; the two `rounded-xl` notice/add-note panels → `rounded-md`. Remove the `* as Dialog` import and, if now unused, `X` from the lucide import; add `Sheet` to the primitives import.

- [ ] **Step 2: `PaymentSheet.tsx`**

Target shape:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Payment"
      dismissible={!busy}
      closeDisabled={busy}
      footer={
        <Button size="xl" full onClick={confirm} disabled={busy || short || missingReference}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          {busy
            ? 'Completing…'
            : claiming
              ? 'Complete as loyalty claim'
              : `Complete sale · ${money(totals.total)}`}
        </Button>
      }
    >
      <div className="space-y-5">
        {/* the old body: everything inside `<div className="scroll-pane flex-1 space-y-5 px-5 py-5">` */}
      </div>
    </Sheet>
  )
```

How: (1) replace everything from `<Dialog.Root` through the old body div's opening tag `<div className="scroll-pane flex-1 space-y-5 px-5 py-5">` (inclusive) with the opener above, ending in `<div className="space-y-5">` — that line *is* the body div, re-classed; (2) leave the body's contents and its own closing `</div>` alone; (3) delete the whole `<footer className="border-t border-line px-5 py-4 pad-safe-bottom">…</footer>` block (its `Button` is now the `footer` prop); (4) replace `</Dialog.Content>` `</Dialog.Portal>` `</Dialog.Root>` with `</Sheet>` — **not** `</div></Sheet>`, the body's `</div>` is already there.

Body class recipe: the amount well `rounded-2xl` → `rounded-md`; method buttons `rounded-xl` → `rounded-md`; the tendered input `rounded-xl border border-line` → `figure rounded-md border border-line-strong`; the change row `rounded-xl` → `rounded-md`; the reference input `rounded-xl border border-line` → `rounded-md border border-line-strong`; the offline notice `rounded-xl bg-warning/10 … text-warning` → `rounded-md border-l-2 border-honey bg-honey/15 … text-ink` (its `font-medium` span stays). Remove the `Dialog` and `X` imports, add `Sheet`.

- [ ] **Step 3: `DiscountSheet.tsx`**

Target shape:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Apply a discount"
      footer={
        <Button size="lg" full onClick={apply} disabled={!valid || !allowed}>
          Apply discount
        </Button>
      }
    >
      <div className="space-y-5">
        {/* the old body: everything inside `<div className="scroll-pane flex-1 space-y-5 px-5 py-5">`,
            starting with `<div className="grid grid-cols-2 gap-2">` and the OPTIONS.map */}
      </div>
    </Sheet>
  )
```

How: exactly as Step 2 — replace from `<Dialog.Root` through the old body div's opening tag (inclusive) with the opener; keep the body and its closing `</div>`; delete the whole `<footer>…</footer>`; replace the three Dialog closers with `</Sheet>` alone. The `<div className="grid grid-cols-2 gap-2">` that opens the option grid is body, not scaffold — it stays.

Body class recipe: option buttons `rounded-xl` → `rounded-md`; the explanation well `rounded-xl` → `rounded-md`; the role notice `rounded-xl bg-warning/10 … text-warning` → `rounded-md border-l-2 border-honey bg-honey/15 … text-ink`. Remove `Dialog`/`X` imports, add `Sheet`.

- [ ] **Step 4: `EndOfShiftSheet.tsx`**

Delete the whole local `function Sheet({ … }) { … }` at the end of the file — from the blank line before `function Sheet(` through its final closing `}` (it is the last thing in the file). Delete the `* as Dialog` import; add `Sheet` to the primitives import; remove `X` from the lucide import if nothing else uses it. The call site `<Sheet open={open && !closing} onClose={onClose} title="End of shift">` is unchanged — the shared `Sheet` has the same `open / onClose / title / children` shape.

Body class recipe: every `rounded-xl` on the `dl`/notice/`AddExpense` frames → `rounded-md`; the `Tile` `rounded-2xl` → `rounded-md`.

- [ ] **Step 5: `OrderEntryPanels.tsx`**

Class recipe only: every `rounded-lg` and `rounded-xl` on the timing chips, the date input, the lump-sum chips and the `Counter` frame and its buttons → `rounded-md`; the two inputs (`type="datetime-local"` and the `Counter`'s number input) get `border-line-strong` in place of `border-line`; any `text-warning` in the file stays (it is now the AA-safe honey text).

- [ ] **Step 6: Typecheck, tests, look**

Run: `npm run typecheck && npx vitest run`
Then on the till: tap a product (side sheet from the right at ≥640px, bottom sheet on a phone, quantity stepper and Add in the fixed footer); Charge → payment sheet (footer button stays visible while the body scrolls; close is disabled while busy); Discount sheet; End of shift from an empty cart.

- [ ] **Step 7: Commit**

```bash
git add src/pos/ProductSheet.tsx src/pos/PaymentSheet.tsx src/pos/DiscountSheet.tsx src/pos/EndOfShiftSheet.tsx src/pos/OrderEntryPanels.tsx
git commit -m "Till sheets on the shared Sheet: fixed footers, 6px corners, honey notices with dark text

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Roastery — the lock screen and the receipt

**Files:**
- Rewrite: `src/screens/LockScreen.tsx`
- Rewrite: `src/pos/ReceiptSheet.tsx`

**Interfaces:**
- Consumes: `Button`, `Micro`, `Money`, `Sheet` from Task 1; `font-display` from Task 0.
- Behaviour preserved exactly: the sign-in effect, the one-staff auto-select, the PIN length, the `role="status"` line, the print-once effect keyed on `sale.id`, `autoFocus` on Next order.

- [ ] **Step 1: Rewrite `src/screens/LockScreen.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Delete, Loader2 } from 'lucide-react'
import { PIN_LENGTH, roleLabel, type User } from '@pos/shared'
import { db } from '../db/database.ts'
import { Micro } from '../components/ui/primitives.tsx'
import { ConnectionBadge } from '../components/ConnectionBadge.tsx'
import { useSession, useSettings } from '../app/providers.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Shift sign-in.
 *
 * One shared terminal, many staff. Picking a name and tapping four digits is
 * the entire flow, because a queue does not wait for a login form.
 *
 * This is a surface that is read, not worked: the shop's name in the
 * Roastery face, a menu-board list of names with hairlines, and a keypad
 * with numerals large enough to hit without looking.
 */
export function LockScreen() {
  const { settings } = useSettings()
  const { signIn } = useSession()
  const [selected, setSelected] = useState<User | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const staff = useLiveQuery(async () => {
    const users = await db.users.toArray()
    return users
      .filter((user) => user.deletedAt === null && user.active)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  // With a single member of staff there is nothing to choose between.
  useEffect(() => {
    if (staff && staff.length === 1 && !selected) setSelected(staff[0] ?? null)
  }, [staff, selected])

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || !selected || busy) return

    let cancelled = false
    setBusy(true)
    void (async () => {
      const result = await signIn(selected.id, pin)
      if (cancelled) return
      if (!result.ok) {
        setError(result.message ?? 'That PIN was not correct.')
        setPin('')
        // A short shake, then let them try again.
        setTimeout(() => setBusy(false), 260)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pin, selected, busy, signIn])

  function press(digit: string): void {
    setError(null)
    setPin((current) => (current.length >= PIN_LENGTH ? current : current + digit))
  }

  const businessName = settings?.branding.businessName ?? 'Point of Sale'

  return (
    <div className="flex min-h-full flex-col bg-surface pad-safe-top pad-safe-bottom">
      <header className="flex items-end justify-between gap-4 border-b border-line px-5 pb-4 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          {settings?.branding.logoDataUrl ? (
            <img src={settings.branding.logoDataUrl} alt="" className="h-11 w-11 rounded-md object-cover" />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-accent font-display text-xl font-medium text-accent-ink">
              {businessName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-display text-[1.625rem] font-medium leading-none tracking-tight text-brand">
              {businessName}
            </h1>
            <Micro className="mt-1.5">Sign in to start selling</Micro>
          </div>
        </div>
        <ConnectionBadge compact />
      </header>

      <div className="flex flex-1 items-start justify-center px-5 py-6 sm:items-center">
        <div className="w-full max-w-md">
          {!selected ? (
            <div className="space-y-4">
              <div className="space-y-1">
                {/* Still a heading for the outline; the shop name above is the page's h1. */}
                <h2 className="micro block text-ink-subtle">Who is on the till?</h2>
                <p className="text-sm text-ink-muted">Choose your name to sign in.</p>
              </div>
              <ul className="border-t border-line">
                {(staff ?? []).map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(user)
                        setPin('')
                        setError(null)
                      }}
                      className="flex w-full items-baseline gap-3 border-b border-line px-1 py-3.5 text-left transition-colors press hover:bg-canvas"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-medium text-ink">{user.name}</span>
                        <Micro className="mt-0.5">{roleLabel(user.role)}</Micro>
                      </span>
                      <span className="mb-1 min-w-2 flex-1 border-b border-dotted border-line-strong" aria-hidden="true" />
                      <span className="font-display text-[0.9375rem] text-ink-subtle">
                        {user.name
                          .split(' ')
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </span>
                    </button>
                  </li>
                ))}
                {staff?.length === 0 ? (
                  <li className="py-6 text-center text-sm text-ink-muted">
                    No active staff. An owner or manager needs to add someone first.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-1 text-center">
                <h2 className="font-display text-2xl font-medium tracking-tight text-ink">{selected.name}</h2>
                <Micro>{roleLabel(selected.role)}</Micro>
              </div>

              <div className={cn('flex justify-center gap-3', error && 'animate-[fade-in_150ms]')}>
                {Array.from({ length: PIN_LENGTH }, (_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-3 w-3 rounded-full border-2 transition-colors',
                      index < pin.length ? 'border-brand bg-brand' : 'border-line-strong bg-transparent',
                      error && 'border-danger',
                    )}
                  />
                ))}
              </div>

              <p
                className={cn(
                  'min-h-[1.25rem] text-center text-[0.8125rem]',
                  error ? 'text-danger' : 'text-ink-subtle',
                )}
                role="status"
              >
                {busy && !error ? 'Checking…' : (error ?? 'Enter your PIN')}
              </p>

              <div className="grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <PinKey key={digit} onClick={() => press(digit)} disabled={busy}>
                    {digit}
                  </PinKey>
                ))}
                <PinKey
                  onClick={() => {
                    setSelected(null)
                    setPin('')
                    setError(null)
                  }}
                  disabled={busy || (staff?.length ?? 0) <= 1}
                  muted
                >
                  <span className="micro">Back</span>
                </PinKey>
                <PinKey onClick={() => press('0')} disabled={busy}>
                  0
                </PinKey>
                <PinKey onClick={() => setPin((current) => current.slice(0, -1))} disabled={busy} muted>
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Delete className="h-5 w-5" aria-hidden="true" />
                  )}
                </PinKey>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PinKey({
  children,
  onClick,
  disabled,
  muted = false,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-16 items-center justify-center rounded-md border text-2xl transition-colors press no-select disabled:pointer-events-none disabled:opacity-45',
        muted
          ? 'border-transparent text-ink-muted hover:bg-canvas'
          : 'border-line bg-surface font-display font-medium text-ink hover:border-line-strong hover:bg-canvas',
      )}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Rewrite `src/pos/ReceiptSheet.tsx`**

Keep lines 1–107 (imports, the `print()` function, the print-once effect, the `if (!sale || !totals) return null`, `branding`, `unverified`) exactly as they are, except: replace `import * as Dialog from '@radix-ui/react-dialog'` with nothing, and change the primitives import to `import { Button, Micro, Money, Sheet } from '../components/ui/primitives.tsx'`. Replace the `return (…)` (lines 109–231) and `Row` with:

```tsx
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-positive/15 text-positive">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          Sale complete
        </span>
      }
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => void print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </Button>
          <Button size="lg" onClick={onClose} autoFocus>
            Next order
          </Button>
        </div>
      }
    >
      {/* The queue number is the largest thing on screen because it is the
          one piece of information the next person in the queue needs. */}
      <div className="text-center">
        <Micro>Queue number</Micro>
        <p className="font-display text-7xl font-medium leading-none tracking-tight text-brand">{sale.queueNo}</p>
      </div>

      {change > 0 ? (
        <div className="mt-5 rounded-md border border-positive/40 bg-positive/10 px-4 py-3 text-center">
          <Micro className="text-positive">Change due</Micro>
          <Money className="block text-3xl font-semibold text-positive">{money(change)}</Money>
        </div>
      ) : null}

      <div className="mt-6 space-y-4 border-t border-line pt-5 text-sm">
        <div className="text-center">
          <p className="font-display text-lg font-medium text-brand">{branding?.businessName}</p>
          {branding?.address ? <p className="text-xs text-ink-subtle">{branding.address}</p> : null}
          {branding?.taxId ? <p className="text-xs text-ink-subtle">TIN {branding.taxId}</p> : null}
        </div>

        <div className="flex justify-between">
          <Micro>{sale.receiptNo}</Micro>
          <Micro>{new Date(sale.occurredAt).toLocaleString()}</Micro>
        </div>

        <ul className="space-y-2 border-t border-line pt-3">
          {lines.map((line, index) => {
            const lineTotals = totals.lines[index]
            return (
              <li key={line.id} className="flex items-baseline gap-2">
                <span className="min-w-0">
                  <span className="block text-ink">
                    {line.quantity} × {line.productName}
                    {line.variantName ? ` (${line.variantName})` : ''}
                  </span>
                  {line.modifiers.length > 0 ? (
                    <span className="block text-xs text-ink-subtle">
                      {line.modifiers.map((modifier) => modifier.optionName).join(', ')}
                    </span>
                  ) : null}
                  {line.note ? <span className="block text-xs text-ink-subtle">“{line.note}”</span> : null}
                </span>
                <span className="mb-1 min-w-3 flex-1 border-b border-dotted border-line-strong" aria-hidden="true" />
                <Money className="shrink-0 text-ink">{money(lineTotals?.lineSubtotal ?? 0)}</Money>
              </li>
            )
          })}
        </ul>

        <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
          <Row label="Subtotal" value={money(totals.subtotal)} />
          {totals.discounts.map((discount) => (
            <Row key={discount.id} label={discount.label} value={`-${money(discount.amount)}`} tone="positive" />
          ))}
          {totals.taxExemptTotal > 0 ? (
            <Row label="VAT exempt" value={`-${money(totals.taxExemptTotal)}`} tone="positive" />
          ) : null}
          {totals.taxTotal > 0 ? (
            <Row label={`${settings?.tax.label ?? 'VAT'} (${settings?.tax.rate}%)`} value={money(totals.taxTotal)} />
          ) : null}
          <div className="flex items-baseline justify-between border-t border-line-strong pt-2">
            <dt>
              <Micro className="text-ink">Total</Micro>
            </dt>
            <dd>
              <Money className="text-lg font-semibold text-ink">{money(totals.total)}</Money>
            </dd>
          </div>
          {payments.map((payment, index) => (
            <Row
              key={index}
              label={payment.method === 'CASH' ? 'Cash' : payment.method}
              value={money(payment.tendered)}
            />
          ))}
          {change > 0 ? <Row label="Change" value={money(change)} /> : null}
        </dl>

        {unverified ? (
          <p className="rounded-md border-l-2 border-honey bg-honey/15 px-3 py-2 text-xs text-ink">
            Payment recorded on this device but not yet confirmed with the provider.
          </p>
        ) : null}

        {status.state === 'OFFLINE' ? (
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-subtle">
            <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
            Saved on this device. It will sync on its own.
          </p>
        ) : null}

        {branding?.receiptFooter ? (
          <p className="pt-2 text-center text-xs text-ink-subtle">{branding.receiptFooter}</p>
        ) : null}
      </div>
    </Sheet>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd>
        <Money className={tone === 'positive' ? 'text-positive' : 'text-ink'}>{value}</Money>
      </dd>
    </div>
  )
}
```

`cn` is no longer used in this file — remove its import.

- [ ] **Step 3: Typecheck, tests, look**

Run: `npm run typecheck && npx vitest run`
Sign out: the lock screen shows the shop name in Fraunces, staff as dotted-leader rows, Fraunces numerals on the keypad; a wrong PIN still shows the error line and clears. Complete a sale: the queue number is huge in Fraunces, lines have dotted leaders, Next order has focus. Print still prints (the `@media print` CSS is untouched).

- [ ] **Step 4: Commit**

```bash
git add src/screens/LockScreen.tsx src/pos/ReceiptSheet.tsx
git commit -m "Roastery voice on the two surfaces that are read: lock screen and receipt

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Branding defaults, custom-colour scope, Android launcher, splash and bars

**Files:**
- Modify: `brand.config.json` (three colours)
- Modify: `src/db/seed.ts` lines 57–59 — **declared exception**: three colour literals, no logic
- Modify: `src/screens/settings/BrandingPanel.tsx` line 251 (the "reset" literals) and lines 48–50 (what each colour now drives)
- Modify: `src/app/providers.tsx` `useBranding` — the first `useEffect` only (lines 64–81: from `useEffect(() => {` through `}, [settings])`; line 63 is the function signature and stays)
- Modify: `scripts/brand.mjs` (colour file always written; new `writeSplash`)
- Modify: `android/app/src/main/res/values/styles.xml` (status and navigation bars, splash background)
- Run: `npm run brand` (regenerates `values/ic_launcher_background.xml`; splash only if `assets/logo.png` exists). It also rewrites `capacitor.config.ts`'s `appName` — a `.ts` file — but only when the name changed, and it has not; it is a no-op here.

**Interfaces:**
- Consumes: `hexToRgbChannels`, `readableInk` from `lib/utils.ts` (unchanged).
- Produces: a `<style id="branding">` element holding any custom light-theme colours, instead of inline properties on `<html>`.

- [ ] **Step 1: `brand.config.json`**

Change `"themeColor": "#7A4A2C"` → `"#3B2416"`, `"backgroundColor": "#F2E4D0"` → `"#F8F3EA"`, `"launcherBackground": "#7A4A2C"` → `"#3B2416"`. Nothing else.

- [ ] **Step 2: `src/db/seed.ts` — the declared exception**

Lines 57–59:

```ts
      primaryColor: '#3B2416',
      secondaryColor: '#C88A4A',
      accentColor: '#58734C',
```

Run `npx vitest run src/db/settings.test.ts src/db/backup.test.ts` — expected green; no test asserts these literals (verify with `grep -rn "7A4A2C\|C18A4A\|168054" src --include=*.test.ts` → no matches).

- [ ] **Step 3: `BrandingPanel.tsx` — the reset literals and what each colour now means**

Line 251: `{ primaryColor: '#7A4A2C', secondaryColor: '#C18A4A', accentColor: '#168054' }` → `{ primaryColor: '#3B2416', secondaryColor: '#C88A4A', accentColor: '#58734C' }`.

Lines 48–50, the `COLOURS` descriptions, must say what the tokens now drive — the primary button is painted from the **Secondary** colour, and telling the owner otherwise is a lie:

```ts
  { key: 'primaryColor', label: 'Primary', detail: 'Chips, the active tab, headings — the colour the shop is known by.' },
  { key: 'secondaryColor', label: 'Secondary', detail: 'The Charge button and every other main action.' },
  { key: 'accentColor', label: 'Accent', detail: 'Reserved for positive figures like profit and margin.' },
```

- [ ] **Step 4: Custom colours are a light-theme feature, and old defaults are not a choice**

Replace the first `useEffect` inside `useBranding` in `src/app/providers.tsx` — lines 64–81, from `useEffect(() => {` through its `}, [settings])`; the `function useBranding(…) {` line above it stays — with:

```tsx
  useEffect(() => {
    if (!settings) return
    const { branding } = settings

    // A colour the till was seeded with is not one the owner chose, so the
    // palette in the stylesheet stands. That covers shops seeded before the
    // 2026 palette as well as after it.
    const rules: string[] = []
    const brand = chosen(branding.primaryColor)
    if (brand) rules.push(`--brand:${brand}`, `--brand-ink:${readableInk(branding.primaryColor)}`)
    const accent = chosen(branding.secondaryColor)
    if (accent) rules.push(`--accent:${accent}`, `--accent-ink:${readableInk(branding.secondaryColor)}`)

    // Custom colours apply to the light theme only. The dark theme is
    // designed around the palette, and a colour picked against cream rarely
    // survives a dark ground.
    let style = document.getElementById('branding') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'branding'
      document.head.appendChild(style)
    }
    style.textContent = rules.length > 0 ? `:root[data-theme='light']{${rules.join(';')}}` : ''

    document.title = branding.businessName || 'Point of Sale'
  }, [settings])
```

And add above `useBranding`:

```ts
/** Every colour a till has ever been seeded with. Any of these means "not chosen". */
const SEEDED_COLOURS = new Set(['#7a4a2c', '#c18a4a', '#3b2416', '#c88a4a'])

function chosen(hex: string): string | null {
  if (SEEDED_COLOURS.has(hex.trim().toLowerCase())) return null
  return hexToRgbChannels(hex)
}
```

Also remove any leftover inline overrides from an earlier session: at the top of the same effect add `document.documentElement.style.removeProperty('--brand')` and the same for `--brand-ink`, `--accent`, `--accent-ink` (four lines) so a shop that ran the old code does not keep stale inline values.

- [ ] **Step 5: `scripts/brand.mjs` — colour file always, splash from the logo**

The launcher colour must be written whether or not there is artwork, and it needs `resDir`, which today is declared *after* the artwork check. Replace the opening of `writeIcons()` — from `async function writeIcons() {` through the `const background = …` / `const zoom = …` pair — with:

```js
async function writeIcons() {
  const resDir = path.join(root, 'android/app/src/main/res')
  if (!existsSync(resDir)) {
    skipped.push('launcher colour and icons (no android project here)')
    return
  }

  // The launcher background needs no artwork, so it is written whether or
  // not the icons are - otherwise a colour change waits on a file that may
  // never arrive.
  const colourFile = path.join(resDir, 'values/ic_launcher_background.xml')
  await writeFile(
    colourFile,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${brand.launcherBackground}</color>\n</resources>\n`,
  )
  done.push(`launcher background colour ${brand.launcherBackground}`)

  const source = path.join(root, brand.launcherIcon)
  if (!existsSync(source)) {
    skipped.push(`launcher icons (no ${brand.launcherIcon} - the existing ones are left alone)`)
    return
  }

  const background = hexToRgb(brand.launcherBackground)
  const zoom = Math.min(Math.max(brand.launcherZoom ?? 0.62, 0.2), 1)
```

and delete the old `resDir` declaration/guard and the old `colourFile` write from later in the function (the `done.push('launcher icons …')` line at the end stays). Then add after `writeWebIcons`:

```js
/* ---------------------------------------------------------------- splash -- */

/**
 * The splash screens, from the shop's logo on the launcher colour.
 *
 * Eleven files: a default, and portrait and landscape at five densities. The
 * logo sits centred at two fifths of the short side - large enough to read,
 * small enough that a wide wordmark clears the edges on a phone in portrait.
 */
const SPLASHES = [
  { dir: 'drawable', w: 480, h: 320 },
  { dir: 'drawable-port-mdpi', w: 320, h: 480 },
  { dir: 'drawable-port-hdpi', w: 480, h: 800 },
  { dir: 'drawable-port-xhdpi', w: 720, h: 1280 },
  { dir: 'drawable-port-xxhdpi', w: 960, h: 1600 },
  { dir: 'drawable-port-xxxhdpi', w: 1280, h: 1920 },
  { dir: 'drawable-land-mdpi', w: 480, h: 320 },
  { dir: 'drawable-land-hdpi', w: 800, h: 480 },
  { dir: 'drawable-land-xhdpi', w: 1280, h: 720 },
  { dir: 'drawable-land-xxhdpi', w: 1600, h: 960 },
  { dir: 'drawable-land-xxxhdpi', w: 1920, h: 1280 },
]

async function writeSplash() {
  const source = path.join(root, brand.logo)
  if (!existsSync(source)) {
    skipped.push(`splash screens (no ${brand.logo} - the existing ones are left alone)`)
    return
  }
  const resDir = path.join(root, 'android/app/src/main/res')
  if (!existsSync(resDir)) {
    skipped.push('splash screens (no android project here)')
    return
  }

  const background = hexToRgb(brand.launcherBackground)
  for (const splash of SPLASHES) {
    const dir = path.join(resDir, splash.dir)
    await mkdir(dir, { recursive: true })
    const side = Math.round(Math.min(splash.w, splash.h) * 0.4)
    const art = await squareSource(source, side)
    const out = await sharp({ create: { width: splash.w, height: splash.h, channels: 4, background } })
      .composite([{ input: art, gravity: 'center' }])
      .png()
      .toBuffer()
    await writeFile(path.join(dir, 'splash.png'), out)
  }
  done.push(`splash screens from ${brand.logo} (${SPLASHES.length} sizes)`)
}
```

And call it: after `await writeWebIcons()` add `await writeSplash()`.

- [ ] **Step 6: Android bars in `styles.xml`**

Inside `<style name="AppTheme.NoActionBar" …>` add:

```xml
        <item name="android:statusBarColor">#3B2416</item>
        <item name="android:navigationBarColor">#3B2416</item>
```

(Both attributes are API 21, the project minimum. Light icons on the dark bar are the default, so no `windowLightStatusBar` entry is needed — and that attribute is API 23, which would lint in `values/`.)

Inside `<style name="AppTheme.NoActionBarLaunch" …>` add:

```xml
        <item name="android:statusBarColor">#3B2416</item>
        <item name="windowSplashScreenBackground">#3B2416</item>
```

(`windowSplashScreenBackground` is the `Theme.SplashScreen` attribute from `core-splashscreen`, already a dependency; on Android 12+ the system draws its own launch frame from it and ignores the drawable's background, so without it the first frame would still be the old brown.)

- [ ] **Step 7: Run the brand script**

Run: `npm run brand`
Expected: `updated launcher background colour #3B2416` (and the icons line too, if `assets/launcher.png` exists); `skipped splash screens (no assets/logo.png …)` unless the owner has put the logo there; `android/app/src/main/res/values/ic_launcher_background.xml` now reads `#3B2416`; `capacitor.config.ts` unchanged (`git status` shows it clean).

Note for the owner in the summary: **drop the logo at `packages/web/assets/logo.png` (and a square mark at `assets/launcher.png`) and run `npm run brand`** — the splash and launcher regenerate from it; until then the old splash PNGs remain.

- [ ] **Step 8: Typecheck, tests, contrast, look**

Run: `npm run typecheck && npx vitest run && npm run contrast`
In the browser: the till's buttons are now caramel/espresso (the seeded override no longer paints old brown). Settings → Shop → pick a custom primary → light theme repaints; switch to dark → the palette, not the custom colour. Reset → back to the palette.

- [ ] **Step 9: Commit**

```bash
git add brand.config.json src/db/seed.ts src/screens/settings/BrandingPanel.tsx src/app/providers.tsx scripts/brand.mjs android/app/src/main/res/values/styles.xml android/app/src/main/res/values/ic_launcher_background.xml
git commit -m "Couz palette as the shop default; custom colours scoped to light; espresso launcher, bars and splash

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Record it

**Files:**
- Modify: `docs/rework/ui-redesign.md`
- Modify: `docs/rework/README.md`

- [ ] **Step 1: `ui-redesign.md`**

Under `## Assumed — confirm before building`, replace the first paragraph with: `**Confirmed 2026-09-12: the hybrid** — the owner picked it from the four options put to them in the working session that produced Plan A. Counter on the till; Roastery on the lock screen, receipt, end-of-day report, launcher and splash.` and keep the three direction descriptions for reference.

Under `### Dark theme — not yet designed`, rename to `### Dark theme — designed 2026-09-12` and replace the paragraph with: `Deep Espresso is the chrome in both themes; in dark it sits on a ground one shade deeper (#1C120C) so the bar still reads as a bar. Surfaces are Dark Roast #241812, ink cream. `brand` is desaturated Caramel #D6A86E (espresso on espresso is invisible). Every pair re-measured: `npm run contrast`. One derived value outside the palette in both themes: warning-as-text (#8A6314 light), because Honey cannot carry words.`

Add a section before `## Open`:

```markdown
## Built — Plan A (2026-09-12)

Tokens (both themes) + contrast gate · primitives with a shared `Sheet` · shell (bottom tabs to 1024px, rail beyond; espresso chrome) · till split into `PosScreen` / `MenuGrid` / `CartPanel` with the three-width layout · the five till sheets on `Sheet` · lock screen and receipt in the Roastery voice · Android launcher colour, status/navigation bars, splash generation from `assets/logo.png`.

One `.ts` exception taken: `seed.ts` lines 57–59, three colour literals. `providers.tsx` (plumbing) touched in two declared places: the theme-colour meta and `useBranding`. Custom brand colours now apply to the light theme only; the four seeded colours (old and new) count as "not chosen"; the primary button is painted from the *Secondary* colour and the Branding panel says so. Two deliberate copy changes on the till: the sold-out chip reads *Out*, and the phone order bar carries a *Charge* button beside the total (the spec's bar had one tap, to the order sheet) — veto either and it is a one-line change.

Plan: `docs/superpowers/plans/2026-09-12-ui-redesign-a-foundation-till.md`.

## Not yet built — Plan B

The remaining screens, on the primitives above: `App.tsx` (the loading state), `charts/Charts.tsx` (on the `chart`/`chart-track` tokens), Dashboard, Sales ledger + SaleSheet, Menu (Products, Categories, Options, Recipes, Ingredients, Import), Reports (Shift, End of day — Roastery, P&L, Planner, Reading), Staff, Settings (all panels), Setup, Sync sheet, and the `@media print` receipt block (appearance only; `printing.ts` and its bytes stay). Mostly class recipes now that the token and radius scales have moved; structural work on `RecipeEditor`, `IngredientSheet`, `SaleSheet`, `EndOfDayPanel` (Roastery).
```

- [ ] **Step 2: `README.md`**

In the tracks table, change the UI row's state to `Direction confirmed. **Plan A built 2026-09-12** (tokens, shell, till, lock, receipt, Android). Plan B (remaining screens) not started.`

- [ ] **Step 3: Do not commit the docs** — `docs/` is the owner's to commit.
