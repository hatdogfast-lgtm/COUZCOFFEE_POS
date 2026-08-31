import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  asciiFold,
  centre,
  COLUMNS,
  drawerKick,
  encodeEscPos,
  renderPlain,
  row,
  twoColumns,
  wrap,
} from './escpos.ts'
import { composeReceipt, type ReceiptInput } from './receipt.ts'
import { DEFAULT_CURRENCY, fromDecimal } from './money.ts'

/**
 * The printer protocol.
 *
 * A receipt is the one artefact of a sale that leaves the building, and it is
 * the copy a customer or an examiner will hold. These tests check the bytes
 * exactly, because "it looked right on the one printer I own" is not a claim
 * that survives a second printer.
 */

const bytes = (data: Uint8Array): number[] => [...data]
const text = (data: Uint8Array): string => String.fromCharCode(...data)

describe('folding text to what a printer can render', () => {
  test('replaces the peso sign, which no default code page carries', () => {
    // Left alone it prints as a stray glyph, and every amount looks wrong.
    assert.equal(asciiFold('₱1,250.00'), 'P1,250.00')
  })

  test('strips accents rather than emitting bytes the printer will mangle', () => {
    assert.equal(asciiFold('José Peñaflor'), 'Jose Penaflor')
  })

  test('flattens typographic punctuation', () => {
    assert.equal(asciiFold('“Don’t” — really…'), '"Don\'t" - really...')
  })

  test('leaves ordinary ASCII exactly as it was', () => {
    const plain = 'OR-01-000042  x2  Cafe Latte 16oz  $9.99'
    assert.equal(asciiFold(plain), plain)
  })

  test('never emits a byte above 126', () => {
    const folded = asciiFold('café ₱ 日本語 —')
    for (const character of folded) {
      assert.ok(character.charCodeAt(0) <= 126, `${character} is out of range`)
    }
  })
})

describe('laying out a line', () => {
  test('pushes the amount hard against the right margin', () => {
    const line = twoColumns('Subtotal', '1,250.00', 32)
    assert.equal(line.length, 32)
    assert.ok(line.startsWith('Subtotal'))
    assert.ok(line.endsWith('1,250.00'))
  })

  test('truncates a long name rather than pushing the amount off the paper', () => {
    const line = twoColumns('2 x Caramel Macchiato with an absurdly long name', '250.00', 32)
    assert.equal(line.length, 32)
    // The figure is the part nobody may misread, so it survives intact.
    assert.ok(line.endsWith('250.00'))
  })

  test('always leaves at least one space between the two', () => {
    const line = twoColumns('12345678901234567890123456', '250.00', 32)
    assert.ok(/ 250\.00$/.test(line))
  })

  test('centres within the paper width', () => {
    assert.equal(centre('ABC', 9), '   ABC')
  })

  test('wraps on spaces, and cuts a word too long to fit', () => {
    assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four'])
    assert.deepEqual(wrap('supercalifragilistic', 10), ['supercalif', 'ragilistic'])
  })

  test('keeps deliberate blank lines', () => {
    assert.deepEqual(wrap('a\n\nb', 10), ['a', '', 'b'])
  })
})

describe('the byte stream', () => {
  const simple = [row.text('HELLO')]

  test('always begins by resetting the printer', () => {
    // A printer left in bold by the previous job would print this one wrong.
    assert.deepEqual(bytes(encodeEscPos(simple, { width: 58 })).slice(0, 2), [0x1b, 0x40])
  })

  test('ends every line with a newline', () => {
    const out = text(encodeEscPos(simple, { width: 58, cut: false, feedBeforeCut: 0 }))
    assert.ok(out.includes('HELLO\n'))
  })

  test('cuts the paper by default, and can be told not to', () => {
    const withCut = bytes(encodeEscPos(simple, { width: 58 }))
    assert.deepEqual(withCut.slice(-4), [0x1d, 0x56, 0x42, 0x00])

    const without = bytes(encodeEscPos(simple, { width: 58, cut: false }))
    assert.ok(!without.slice(-4).every((byte, index) => byte === [0x1d, 0x56, 0x42, 0x00][index]))
  })

  test('feeds the paper clear of the head before cutting', () => {
    const out = bytes(encodeEscPos(simple, { width: 58, feedBeforeCut: 4 }))
    const cutAt = out.length - 4
    assert.deepEqual(out.slice(cutAt - 4, cutAt), [0x0a, 0x0a, 0x0a, 0x0a])
  })

  test('kicks the drawer only when asked', () => {
    const kick = [0x1b, 0x70, 0x00, 0x19, 0xfa]
    const asked = bytes(encodeEscPos(simple, { width: 58, openDrawer: true }))
    assert.deepEqual(asked.slice(2, 7), kick)

    const quiet = bytes(encodeEscPos(simple, { width: 58 }))
    assert.ok(!quiet.slice(2, 7).every((byte, index) => byte === kick[index]))
  })

  test('turns emphasis off again, so it cannot leak into the next line', () => {
    const out = bytes(encodeEscPos([row.text('BIG', { bold: true, large: true }), row.text('small')], { width: 58 }))
    // The stream resets size and weight before the feed and the cut.
    const tail = out.slice(-20)
    assert.ok(tail.includes(0x45), 'emphasis was never turned back off')
    assert.ok(tail.includes(0x21), 'text size was never returned to normal')
  })

  test('draws a divider the full width of the paper', () => {
    const narrow = text(encodeEscPos([row.divider()], { width: 58, cut: false, feedBeforeCut: 0 }))
    const wide = text(encodeEscPos([row.divider()], { width: 80, cut: false, feedBeforeCut: 0 }))
    assert.ok(narrow.includes('-'.repeat(COLUMNS[58])))
    assert.ok(wide.includes('-'.repeat(COLUMNS[80])))
  })

  test('folds the text on its way to the printer', () => {
    const out = text(encodeEscPos([row.text('Total ₱1,250.00')], { width: 58 }))
    assert.ok(out.includes('Total P1,250.00'))
  })

  test('the drawer kick on its own is a reset plus the pulse', () => {
    assert.deepEqual(bytes(drawerKick()), [0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa])
  })
})

describe('the preview and the paper agree', () => {
  test('every plain line fits the paper width', () => {
    const rows = [
      row.text('Corner Roasters', { align: 'center', bold: true, large: true }),
      row.columns('2 x Caramel Macchiato 16oz', '250.00'),
      row.divider(),
      row.columns('TOTAL', '1,250.00', { bold: true }),
    ]

    for (const width of [58, 80] as const) {
      for (const line of renderPlain(rows, width)) {
        assert.ok(line.length <= COLUMNS[width], `"${line}" is wider than ${width}mm paper`)
      }
    }
  })

  test('large text wraps at half the columns, because it is twice as wide', () => {
    const lines = renderPlain([row.text('ABCDEFGHIJKLMNOPQRSTUVWXYZ', { large: true })], 58)
    for (const line of lines) assert.ok(line.length <= COLUMNS[58] / 2)
  })

  test('what the preview shows is what the bytes say', () => {
    const rows = [
      row.text('Corner Roasters', { align: 'center', bold: true }),
      row.columns('Subtotal', '1,250.00'),
      row.divider(),
    ]

    // Same content and same order. Alignment is expressed differently by
    // design: the preview pads with spaces, while the printer is told to
    // centre, which it does more precisely than padding could.
    const printed = printableLines(encodeEscPos(rows, { width: 58, cut: false, feedBeforeCut: 0 }))
    assert.deepEqual(
      printed.map((line) => line.trim()),
      renderPlain(rows, 58).map((line) => line.trim()),
    )
  })
})

/**
 * Recover the printed text from a byte stream, skipping the control codes.
 *
 * Walks the ESC/POS commands this encoder emits, so the test reads what a
 * printer would put on paper rather than what the encoder was asked to put
 * there.
 */
function printableLines(data: Uint8Array): string[] {
  const lines: string[] = []
  let current = ''

  for (let index = 0; index < data.length; index++) {
    const byte = data[index]!

    if (byte === 0x1b) {
      // ESC @ takes no argument; ESC p takes four; the rest take one.
      const command = data[index + 1]
      index += command === 0x40 ? 1 : command === 0x70 ? 4 : 2
      continue
    }
    if (byte === 0x1d) {
      // GS ! takes one argument; GS V takes two.
      index += data[index + 1] === 0x56 ? 3 : 2
      continue
    }
    if (byte === 0x0a) {
      lines.push(current)
      current = ''
      continue
    }
    current += String.fromCharCode(byte)
  }

  if (current.length > 0) lines.push(current)
  return lines.filter((line) => line.length > 0)
}

// ------------------------------------------------------------ the receipt --

function receiptInput(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    paperWidth: 58,
    currency: DEFAULT_CURRENCY,
    business: { name: 'Corner Roasters', address: '12 Ortigas Ave', taxId: '123-456-789-000' },
    meta: {
      receiptNo: 'OR-01-000042',
      queueNo: 'Q014',
      occurredAt: Date.UTC(2026, 7, 30, 4, 0, 0),
      cashierName: 'Ana',
      terminal: 'POS-01',
    },
    items: [{ quantity: 2, name: 'Cafe Latte', detail: '16oz', amount: fromDecimal(280) }],
    discounts: [],
    totals: {
      subtotal: fromDecimal(280),
      discountTotal: 0,
      taxableSales: fromDecimal(250),
      taxExemptSales: 0,
      zeroRatedSales: 0,
      taxTotal: fromDecimal(30),
      taxExemptTotal: 0,
      total: fromDecimal(280),
      taxLabel: 'VAT',
      taxEnabled: true,
    },
    payments: [{ label: 'Cash', amount: fromDecimal(300) }],
    change: fromDecimal(20),
    ...overrides,
  }
}

const printed = (input: ReceiptInput): string =>
  renderPlain(composeReceipt(input), input.paperWidth).join('\n')

describe('what ends up on the receipt', () => {
  test('carries the shop, the receipt number and the total', () => {
    const out = printed(receiptInput())
    assert.ok(out.includes('Corner Roasters'))
    assert.ok(out.includes('OR-01-000042'))
    assert.ok(out.includes('VAT REG TIN 123-456-789-000'))
    assert.ok(/TOTAL\s+P280\.00/.test(out))
  })

  test('shows the tax breakdown an examiner looks for', () => {
    const out = printed(receiptInput())
    assert.ok(out.includes('VATable sales'))
    assert.ok(/VAT\s+P30\.00/.test(out))
  })

  test('leaves the whole tax block out when tax is switched off', () => {
    const out = printed(
      receiptInput({
        totals: { ...receiptInput().totals, taxEnabled: false },
      }),
    )
    assert.ok(!out.includes('VATable sales'))
    assert.ok(!/^VAT\s/m.test(out))
  })

  test('prints a senior concession with the identification and a line to sign', () => {
    const out = printed(
      receiptInput({
        discounts: [
          {
            label: 'Senior citizen',
            amount: fromDecimal(56),
            referenceNo: 'SC-99887',
            beneficiaryName: 'Rosa Dela Cruz',
          },
        ],
      }),
    )
    assert.ok(out.includes('Senior citizen'))
    assert.ok(out.includes('-P56.00'))
    assert.ok(out.includes('ID SC-99887'))
    assert.ok(out.includes('Rosa Dela Cruz'))
    // The signature line is what makes the concession auditable.
    assert.ok(out.includes('Signature over printed name'))
  })

  test('says on its face when it is a duplicate', () => {
    assert.ok(printed(receiptInput({ reprint: true })).includes('*** REPRINT ***'))
    // An original must never claim to be one.
    assert.ok(!printed(receiptInput()).includes('REPRINT'))
  })

  test('marks a void and a refund unmistakably', () => {
    assert.ok(printed(receiptInput({ voided: true })).includes('*** VOIDED ***'))
    const refund = printed(receiptInput({ refundOf: 'OR-01-000041' }))
    assert.ok(refund.includes('*** REFUND ***'))
    assert.ok(refund.includes('OR-01-000041'))
  })

  test('shows when a backdated sale was actually keyed', () => {
    const out = printed(
      receiptInput({
        meta: { ...receiptInput().meta, recordedAt: Date.UTC(2026, 7, 31, 9, 0, 0) },
      }),
    )
    assert.ok(out.includes('Entered'))
  })

  test('does not print an Entered line when the two times match', () => {
    const at = Date.UTC(2026, 7, 30, 4, 0, 0)
    const out = printed(receiptInput({ meta: { ...receiptInput().meta, occurredAt: at, recordedAt: at } }))
    assert.ok(!out.includes('Entered'))
  })

  test('omits change when there is none to give', () => {
    assert.ok(!printed(receiptInput({ change: 0 })).includes('Change'))
  })

  test('handles a lump-sum entry with no lines without breaking the layout', () => {
    const out = printed(receiptInput({ items: [] }))
    assert.ok(out.includes('No itemised lines'))
    assert.ok(/TOTAL\s+P280\.00/.test(out))
  })

  test('fits both paper widths', () => {
    for (const width of [58, 80] as const) {
      const input = receiptInput({ paperWidth: width })
      for (const line of renderPlain(composeReceipt(input), width)) {
        assert.ok(line.length <= COLUMNS[width], `"${line}" overflows ${width}mm`)
      }
    }
  })
})

describe('printing a logo', () => {
  // A 16x2 image: the top row all burned, the bottom row empty.
  const image = {
    width: 16,
    height: 2,
    data: Uint8Array.from([0xff, 0xff, 0x00, 0x00]),
  }

  test('is sent as GS v 0 with the width in bytes and the height in dots', () => {
    const out = bytes(encodeEscPos([row.image(image)], { width: 58, cut: false, feedBeforeCut: 0 }))
    const start = out.findIndex((byte, index) => byte === 0x1d && out[index + 1] === 0x76 && out[index + 2] === 0x30)

    assert.ok(start > 0, 'no raster command found')
    assert.equal(out[start + 3], 0x00, 'should be normal size')
    // Width is in bytes, little-endian: 16 dots is 2 bytes.
    assert.equal(out[start + 4], 2)
    assert.equal(out[start + 5], 0)
    // Height is in dots.
    assert.equal(out[start + 6], 2)
    assert.equal(out[start + 7], 0)
    assert.deepEqual(out.slice(start + 8, start + 12), [0xff, 0xff, 0x00, 0x00])
  })

  test('centres the image and puts the alignment back afterwards', () => {
    const out = bytes(encodeEscPos([row.image(image)], { width: 58, cut: false, feedBeforeCut: 0 }))
    const centre = [0x1b, 0x61, 1]
    const left = [0x1b, 0x61, 0]
    const asString = out.join(',')
    assert.ok(asString.includes(centre.join(',')), 'never centred')
    assert.ok(asString.indexOf(left.join(',')) > asString.indexOf(centre.join(',')), 'never returned to the left')
  })

  test('refuses an image whose data is shorter than it claims', () => {
    // Feeding a printer past the end of the buffer prints noise and can leave
    // it needing a power cycle, so a truncated image is dropped instead.
    const truncated = { width: 16, height: 4, data: Uint8Array.from([0xff, 0xff]) }
    const out = bytes(encodeEscPos([row.image(truncated)], { width: 58, cut: false, feedBeforeCut: 0 }))
    assert.ok(!out.join(',').includes([0x1d, 0x76, 0x30].join(',')), 'a short image was still sent')
  })

  test('rounds the width up to whole bytes', () => {
    // 12 dots still occupies 2 bytes on the wire.
    const odd = { width: 12, height: 1, data: Uint8Array.from([0xff, 0xf0]) }
    const out = bytes(encodeEscPos([row.image(odd)], { width: 58, cut: false, feedBeforeCut: 0 }))
    const start = out.findIndex((byte, index) => byte === 0x1d && out[index + 1] === 0x76)
    assert.equal(out[start + 4], 2)
  })

  test('is named in the text preview rather than vanishing from it', () => {
    // The preview cannot draw, but a receipt that silently loses its logo
    // would look shorter on screen than it comes out on paper.
    const lines = renderPlain([row.image(image)], 58)
    assert.equal(lines.length, 1)
    assert.ok(lines[0]?.includes('[ logo ]'))
  })

  test('a receipt without a logo emits no raster command at all', () => {
    const out = bytes(encodeEscPos([row.text('No logo here')], { width: 58 }))
    assert.ok(!out.join(',').includes([0x1d, 0x76, 0x30].join(',')))
  })
})

describe('a receipt laid out the way the shop wants it', () => {
  test('prints everything when the shop has said nothing', () => {
    const out = printed(receiptInput())
    assert.ok(out.includes('OFFICIAL RECEIPT'))
    assert.ok(out.includes('VATable sales'))
    assert.ok(out.includes('Thank you!'))
  })

  test('a section left out does not print', () => {
    const out = printed(receiptInput({ sections: ['BUSINESS', 'ITEMS', 'TOTALS'] }))
    assert.ok(out.includes('Corner Roasters'))
    assert.ok(!out.includes('Thank you!'))
    assert.ok(!out.includes('Served by'))
  })

  test('turning off the tax breakdown leaves the total alone', () => {
    const withTax = printed(receiptInput())
    const without = printed(receiptInput({ sections: ['BUSINESS', 'ITEMS', 'TOTALS'] }))

    assert.ok(withTax.includes('VATable sales'))
    assert.ok(!without.includes('VATable sales'))
    // The figure charged does not move because a line was hidden.
    assert.ok(/TOTAL\s+P280\.00/.test(without))
  })

  test('sections print in the order the shop put them in', () => {
    const out = printed(
      receiptInput({ sections: ['ITEMS', 'BUSINESS', 'TOTALS', 'FOOTER'] }),
    )
    assert.ok(out.indexOf('2 x') < out.indexOf('Corner Roasters'))
  })

  test('the parts a receipt is not valid without cannot be dropped', () => {
    // A stored setting that omits them entirely still produces a lawful receipt.
    const out = printed(receiptInput({ sections: ['FOOTER'] }))
    assert.ok(out.includes('Corner Roasters'))
    assert.ok(/TOTAL\s+P280\.00/.test(out))
    assert.ok(out.includes('2 x'))
  })

  test('an empty list means the usual receipt, not a blank one', () => {
    assert.equal(printed(receiptInput({ sections: [] })), printed(receiptInput()))
  })

  test('a section this version has never heard of is ignored', () => {
    const out = printed(
      receiptInput({ sections: ['BUSINESS', 'ITEMS', 'TOTALS', 'HOROSCOPE' as never] }),
    )
    assert.ok(out.includes('Corner Roasters'))
    assert.ok(!out.includes('HOROSCOPE'))
  })

  test('the loyalty line prints only when there is one', () => {
    assert.ok(!printed(receiptInput()).includes('free drink'))
    assert.ok(
      printed(receiptInput({ loyaltyNote: 'Buy 10, get a free drink' })).includes('free drink'),
    )
  })

  test('the paper is always cut, whatever was left out', () => {
    const rows = composeReceipt(receiptInput({ sections: ['BUSINESS', 'ITEMS', 'TOTALS'] }))
    assert.equal(rows.at(-1)?.kind, 'CUT')
  })
})
