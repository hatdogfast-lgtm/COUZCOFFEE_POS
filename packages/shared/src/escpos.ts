/**
 * ESC/POS: the language thermal printers speak.
 *
 * Almost every receipt printer sold - Epson, Xprinter, Rongta, the no-name
 * Bluetooth ones a coffee shop actually buys - takes the same small set of
 * escape codes. They are plain bytes, so everything here is a pure function
 * from a receipt to a byte array, and can be checked exactly without a printer
 * in the room.
 *
 * Two deliberate limitations, both about being honest rather than clever:
 *
 * - Text is folded to ASCII. A thermal printer's default code page has no peso
 *   sign and no smart quotes, and a byte it does not recognise prints as a
 *   random glyph or nothing at all. Folding is ugly in one place and correct
 *   everywhere; a receipt that prints "â‚±" is neither.
 * - Only Font A is used. Font B is narrower and tempting, but its width varies
 *   between manufacturers, and a column layout that is right on one printer and
 *   wrong on another is worse than one that is plainly right on both.
 */

export const PAPER_WIDTHS = [58, 80] as const
export type PaperWidth = (typeof PAPER_WIDTHS)[number]

/** Characters per line in Font A, which is 12 dots wide. */
export const COLUMNS: Record<PaperWidth, number> = {
  58: 32,
  80: 48,
}

export type Align = 'left' | 'center' | 'right'

/**
 * A one-bit image, ready for the print head.
 *
 * A thermal printer has no notion of grey: each dot is burned or it is not.
 * The bits are packed eight to a byte, left to right, exactly as the printer
 * consumes them, so the conversion from a picture happens once - on the device
 * that has a canvas - rather than in the printer driver.
 */
export interface RasterImage {
  /** Width in dots. Rounded up to a multiple of 8 when packed. */
  width: number
  height: number
  /** Packed rows, ceil(width / 8) bytes each. A set bit burns a dot. */
  data: Uint8Array
}

/** One line of a receipt, before it becomes either bytes or pixels. */
export interface ReceiptRow {
  kind: 'TEXT' | 'COLUMNS' | 'DIVIDER' | 'FEED' | 'CUT' | 'IMAGE'
  text?: string
  image?: RasterImage
  /** For a COLUMNS row: pushed hard against the right margin. */
  right?: string
  align?: Align
  bold?: boolean
  /** Double height and width. Used sparingly - the queue number, the total. */
  large?: boolean
  /** Blank lines for FEED. */
  lines?: number
}

export const row = {
  text: (text: string, options: Omit<ReceiptRow, 'kind' | 'text'> = {}): ReceiptRow => ({
    kind: 'TEXT',
    text,
    ...options,
  }),
  columns: (text: string, right: string, options: Omit<ReceiptRow, 'kind' | 'text' | 'right'> = {}): ReceiptRow => ({
    kind: 'COLUMNS',
    text,
    right,
    ...options,
  }),
  image: (image: RasterImage): ReceiptRow => ({ kind: 'IMAGE', image }),
  divider: (): ReceiptRow => ({ kind: 'DIVIDER' }),
  feed: (lines = 1): ReceiptRow => ({ kind: 'FEED', lines }),
  cut: (): ReceiptRow => ({ kind: 'CUT' }),
}

// ------------------------------------------------------------------- text --

const FOLD: Record<string, string> = {
  '₱': 'P',
  '€': 'EUR',
  '£': 'GBP',
  '—': '-',
  '–': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '·': '-',
  '×': 'x',
  '≥': '>=',
  '≤': '<=',
  ' ': ' ',
}

/**
 * Reduce text to bytes a receipt printer will certainly render.
 *
 * Accented letters lose their accent rather than becoming noise, which matters
 * for names on a senior citizen concession.
 */
export function asciiFold(text: string): string {
  let out = ''
  for (const character of text.normalize('NFD')) {
    // Combining marks left over from the decomposition.
    if (character.charCodeAt(0) >= 0x0300 && character.charCodeAt(0) <= 0x036f) continue
    const mapped = FOLD[character]
    if (mapped !== undefined) {
      out += mapped
      continue
    }
    const code = character.charCodeAt(0)
    out += code >= 0x20 && code <= 0x7e ? character : code === 0x0a ? '\n' : '?'
  }
  return out
}

/** Hard-wrap at the paper width, breaking on spaces where one is available. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text]
  const lines: string[] = []

  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('')
      continue
    }
    let rest = paragraph
    while (rest.length > width) {
      const slice = rest.slice(0, width + 1)
      const breakAt = slice.lastIndexOf(' ')
      // A single word longer than the paper simply gets cut.
      const cut = breakAt > 0 ? breakAt : width
      lines.push(rest.slice(0, cut).trimEnd())
      rest = rest.slice(breakAt > 0 ? cut + 1 : cut)
    }
    lines.push(rest)
  }
  return lines
}

/**
 * A label on the left and a figure on the right, filled with spaces.
 *
 * When the two cannot both fit, the label gives way - the amount is the part
 * nobody may misread.
 */
export function twoColumns(left: string, right: string, width: number): string {
  const rightText = right.slice(0, width)
  const room = width - rightText.length - 1
  if (room <= 0) return rightText.padStart(width)
  const leftText = left.length > room ? `${left.slice(0, Math.max(0, room - 1))}…` : left
  return `${leftText}${' '.repeat(Math.max(1, width - leftText.length - rightText.length))}${rightText}`
}

export function centre(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  const left = Math.floor((width - text.length) / 2)
  return `${' '.repeat(left)}${text}`
}

/**
 * Render rows as plain monospace lines.
 *
 * Used for the on-screen preview and for the browser fallback, so what is seen
 * is laid out by the same code that lays out the paper. A preview that agrees
 * with the printer only by coincidence is not a preview.
 */
export function renderPlain(rows: ReceiptRow[], width: PaperWidth): string[] {
  const columns = COLUMNS[width]
  const out: string[] = []

  for (const entry of rows) {
    switch (entry.kind) {
      case 'DIVIDER':
        out.push('-'.repeat(columns))
        break
      case 'FEED':
        for (let index = 0; index < (entry.lines ?? 1); index++) out.push('')
        break
      case 'CUT':
        break
      case 'IMAGE':
        // The preview is text, so the logo is described rather than drawn. It
        // must not silently vanish, or the preview would claim a receipt that
        // is shorter than the paper.
        out.push(centre('[ logo ]', columns))
        break
      case 'COLUMNS':
        out.push(twoColumns(asciiFold(entry.text ?? ''), asciiFold(entry.right ?? ''), columns))
        break
      default: {
        // Large text is twice as wide, so it wraps at half the columns.
        const room = entry.large ? Math.floor(columns / 2) : columns
        for (const line of wrap(asciiFold(entry.text ?? ''), room)) {
          out.push(entry.align === 'center' ? centre(line, room) : entry.align === 'right' ? line.padStart(room) : line)
        }
      }
    }
  }
  return out
}

// ------------------------------------------------------------------ bytes --

const ESC = 0x1b
const GS = 0x1d

const CMD = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0],
  alignCentre: [ESC, 0x61, 1],
  alignRight: [ESC, 0x61, 2],
  boldOn: [ESC, 0x45, 1],
  boldOff: [ESC, 0x45, 0],
  sizeNormal: [GS, 0x21, 0x00],
  sizeLarge: [GS, 0x21, 0x11],
  /** Partial cut, after feeding the paper clear of the head. */
  cut: [GS, 0x56, 0x42, 0x00],
  /** Pulse pin 2: the standard cash-drawer kick. */
  drawer: [ESC, 0x70, 0x00, 0x19, 0xfa],
} as const

export interface EncodeOptions {
  width: PaperWidth
  /** Blank lines before the cut, so the tear-off is clear of the last line. */
  feedBeforeCut?: number
  cut?: boolean
  openDrawer?: boolean
}

/**
 * Turn a receipt into the exact bytes to send to the printer.
 *
 * The stream always begins with a reset, because a printer left in bold or
 * double-height by a previous job would otherwise print this one wrong.
 */
export function encodeEscPos(rows: ReceiptRow[], options: EncodeOptions): Uint8Array {
  const columns = COLUMNS[options.width]
  const bytes: number[] = [...CMD.init]

  if (options.openDrawer) bytes.push(...CMD.drawer)

  const write = (text: string): void => {
    for (const character of text) bytes.push(character.charCodeAt(0) & 0xff)
    bytes.push(0x0a)
  }

  for (const entry of rows) {
    if (entry.kind === 'CUT') continue

    if (entry.kind === 'IMAGE') {
      if (entry.image) bytes.push(...rasterCommand(entry.image))
      continue
    }

    if (entry.kind === 'DIVIDER') {
      bytes.push(...CMD.alignLeft, ...CMD.sizeNormal, ...CMD.boldOff)
      write('-'.repeat(columns))
      continue
    }

    if (entry.kind === 'FEED') {
      bytes.push(...CMD.sizeNormal, ...CMD.boldOff)
      for (let index = 0; index < (entry.lines ?? 1); index++) bytes.push(0x0a)
      continue
    }

    bytes.push(...(entry.bold ? CMD.boldOn : CMD.boldOff))
    bytes.push(...(entry.large ? CMD.sizeLarge : CMD.sizeNormal))

    if (entry.kind === 'COLUMNS') {
      // Padded by hand rather than by alignment, so the figures line up in a
      // column down the receipt instead of each floating to its own margin.
      bytes.push(...CMD.alignLeft)
      write(twoColumns(asciiFold(entry.text ?? ''), asciiFold(entry.right ?? ''), columns))
      continue
    }

    bytes.push(
      ...(entry.align === 'center' ? CMD.alignCentre : entry.align === 'right' ? CMD.alignRight : CMD.alignLeft),
    )
    const room = entry.large ? Math.floor(columns / 2) : columns
    for (const line of wrap(asciiFold(entry.text ?? ''), room)) write(line)
  }

  bytes.push(...CMD.sizeNormal, ...CMD.boldOff, ...CMD.alignLeft)
  for (let index = 0; index < (options.feedBeforeCut ?? 4); index++) bytes.push(0x0a)
  if (options.cut !== false) bytes.push(...CMD.cut)

  return Uint8Array.from(bytes)
}

/**
 * GS v 0 - print a raster bitmap.
 *
 * Chosen over the older ESC * because it is what every printer made this
 * century implements, and because the whole image goes in one command rather
 * than being sliced into 8- or 24-dot bands that have to be stitched.
 *
 * The width is sent in bytes and the height in dots, both little-endian.
 */
export function rasterCommand(image: RasterImage): number[] {
  const widthBytes = Math.ceil(image.width / 8)
  const expected = widthBytes * image.height
  if (image.data.length < expected) {
    // Better a short image than a printer fed garbage past the end of the
    // buffer, which prints noise and can leave it needing a power cycle.
    return []
  }

  return [
    ...CMD.alignCentre,
    GS,
    0x76,
    0x30,
    0x00, // Normal size; 1-3 would double the width or height.
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    image.height & 0xff,
    (image.height >> 8) & 0xff,
    ...image.data.subarray(0, expected),
    ...CMD.alignLeft,
  ]
}

/** Just the drawer kick, for opening the till without printing anything. */
export function drawerKick(): Uint8Array {
  return Uint8Array.from([...CMD.init, ...CMD.drawer])
}

/** The print head's width in dots, which is what a logo must be sized to. */
export const DOT_WIDTH: Record<PaperWidth, number> = {
  58: 384,
  80: 576,
}
