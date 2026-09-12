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
