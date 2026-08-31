import {
  composeReceipt,
  drawerKick,
  encodeEscPos,
  renderPlain,
  type PaperWidth,
  type PrintRoute,
  type ReceiptInput,
  type ReceiptRow,
} from '@pos/shared'

/**
 * Getting a receipt onto paper.
 *
 * There are three ways a coffee shop actually prints, and this supports all
 * three rather than pretending there is one:
 *
 *   - **Bluetooth** - what the cheap counter-top printers use, and what a
 *     phone or tablet till will reach for. Web Bluetooth, where the browser
 *     has it.
 *   - **USB** - a printer plugged into a desktop till. WebUSB, where the
 *     browser has it.
 *   - **The browser's own print dialogue** - which works with any printer the
 *     operating system already knows about, including a shared network one,
 *     and is the only route on iOS. Slower and it needs a person to press a
 *     button, but it never fails to exist.
 *
 * The first two send ESC/POS bytes straight to the printer. The third renders
 * the identical receipt as monospaced HTML sized to the paper. All three are
 * laid out by the same composer, so the shop never has two different receipts
 * depending on how it printed.
 */

export type { PrintRoute }

export interface PrinterCapabilities {
  bluetooth: boolean
  usb: boolean
  browser: boolean
}

/** What this device can actually do, asked rather than assumed. */
export function capabilities(): PrinterCapabilities {
  const nav = navigator as Navigator & { bluetooth?: unknown; usb?: unknown }
  return {
    bluetooth: typeof nav.bluetooth === 'object' && nav.bluetooth !== null,
    usb: typeof nav.usb === 'object' && nav.usb !== null,
    browser: typeof window !== 'undefined' && typeof window.print === 'function',
  }
}

export function buildRows(input: ReceiptInput): ReceiptRow[] {
  return composeReceipt(input)
}

export function previewLines(input: ReceiptInput): string[] {
  return renderPlain(composeReceipt(input), input.paperWidth)
}

// -------------------------------------------------------------- bluetooth --

/**
 * The serial-over-Bluetooth service every cheap thermal printer exposes.
 *
 * There is no registered standard for this, so printers use one of a handful
 * of vendor UUIDs. All the common ones are offered, and the browser picks
 * whichever the chosen printer actually has.
 */
const BLUETOOTH_SERVICES = [
  0x18f0, // Most Chinese thermal printers (Xprinter, Rongta, Goojprt).
  0xff00,
  0xffe0,
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Issc / BLE serial bridges.
]

interface BluetoothLike {
  requestDevice(options: unknown): Promise<BluetoothDeviceLike>
}
interface BluetoothDeviceLike {
  name?: string
  gatt?: { connect(): Promise<BluetoothServerLike>; disconnect(): void; connected: boolean }
}
interface BluetoothServerLike {
  getPrimaryServices(): Promise<BluetoothServiceLike[]>
}
interface BluetoothServiceLike {
  getCharacteristics(): Promise<BluetoothCharacteristicLike[]>
}
interface BluetoothCharacteristicLike {
  properties: { write: boolean; writeWithoutResponse: boolean }
  writeValueWithoutResponse?(value: ArrayBufferView | ArrayBuffer): Promise<void>
  writeValue(value: ArrayBufferView | ArrayBuffer): Promise<void>
}

let pairedDevice: BluetoothDeviceLike | null = null

/**
 * Ask the person to choose a printer.
 *
 * The browser insists this is triggered by a real click, and deliberately so:
 * a page cannot go looking for nearby devices on its own.
 */
export async function pairBluetoothPrinter(): Promise<string> {
  const nav = navigator as Navigator & { bluetooth?: BluetoothLike }
  if (!nav.bluetooth) throw new Error('This device or browser cannot connect to a Bluetooth printer.')

  const device = await nav.bluetooth.requestDevice({
    filters: BLUETOOTH_SERVICES.map((service) => ({ services: [service] })),
    optionalServices: BLUETOOTH_SERVICES,
  })
  pairedDevice = device
  return device.name ?? 'Bluetooth printer'
}

export function pairedPrinterName(): string | null {
  return pairedDevice?.name ?? null
}

export function forgetBluetoothPrinter(): void {
  try {
    pairedDevice?.gatt?.disconnect()
  } catch {
    // Already gone; nothing to do.
  }
  pairedDevice = null
}

/** Bluetooth LE caps a write at 512 bytes, and most printers want less. */
const CHUNK = 180

async function sendBluetooth(data: Uint8Array): Promise<void> {
  if (!pairedDevice?.gatt) throw new Error('No printer is paired. Pair one in Settings first.')

  const server = pairedDevice.gatt.connected
    ? await pairedDevice.gatt.connect()
    : await pairedDevice.gatt.connect()

  const services = await server.getPrimaryServices()
  let target: BluetoothCharacteristicLike | null = null

  for (const service of services) {
    for (const characteristic of await service.getCharacteristics()) {
      if (characteristic.properties.writeWithoutResponse || characteristic.properties.write) {
        target = characteristic
        break
      }
    }
    if (target) break
  }

  if (!target) throw new Error('That printer did not offer anything to write to.')

  // Sent in chunks with the connection kept open: a printer that is handed a
  // whole receipt at once silently drops the tail.
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    const slice = data.slice(offset, offset + CHUNK)
    if (target.writeValueWithoutResponse && target.properties.writeWithoutResponse) {
      await target.writeValueWithoutResponse(slice)
    } else {
      await target.writeValue(slice)
    }
  }
}

// -------------------------------------------------------------------- usb --

interface UsbLike {
  requestDevice(options: unknown): Promise<UsbDeviceLike>
}
interface UsbDeviceLike {
  productName?: string
  opened: boolean
  open(): Promise<void>
  selectConfiguration(value: number): Promise<void>
  claimInterface(value: number): Promise<void>
  transferOut(endpoint: number, data: ArrayBufferView | ArrayBuffer): Promise<unknown>
  configuration?: {
    interfaces: Array<{
      interfaceNumber: number
      alternate: { interfaceClass: number; endpoints: Array<{ direction: string; endpointNumber: number }> }
    }>
  }
}

let usbDevice: UsbDeviceLike | null = null

export async function pairUsbPrinter(): Promise<string> {
  const nav = navigator as Navigator & { usb?: UsbLike }
  if (!nav.usb) throw new Error('This browser cannot talk to a USB printer.')

  // Class 7 is the USB printer class; every ESC/POS printer declares it.
  const device = await nav.usb.requestDevice({ filters: [{ classCode: 7 }] })
  usbDevice = device
  return device.productName ?? 'USB printer'
}

async function sendUsb(data: Uint8Array): Promise<void> {
  if (!usbDevice) throw new Error('No USB printer is paired. Pair one in Settings first.')

  if (!usbDevice.opened) await usbDevice.open()
  await usbDevice.selectConfiguration(1)

  const printerInterface = usbDevice.configuration?.interfaces.find(
    (entry) => entry.alternate.interfaceClass === 7,
  )
  if (!printerInterface) throw new Error('That USB device is not a printer.')

  await usbDevice.claimInterface(printerInterface.interfaceNumber)
  const endpoint = printerInterface.alternate.endpoints.find((entry) => entry.direction === 'out')
  if (!endpoint) throw new Error('That printer has nowhere to send data to.')

  await usbDevice.transferOut(endpoint.endpointNumber, data)
}

// ---------------------------------------------------------------- browser --

const PRINT_ROOT_ID = 'receipt-print-root'

/**
 * Render the receipt into a hidden element and open the print dialogue.
 *
 * The page's own print stylesheet hides everything except this element and
 * sizes the page to the paper, so what comes out is a receipt rather than a
 * screenshot of the till.
 */
const PAGE_STYLE_ID = 'receipt-print-page-size'

export function printInBrowser(input: ReceiptInput, logoDataUrl?: string | null): void {
  // The text renderer can only write "[ logo ]", so on this route the real
  // image is put above the text and the placeholder is taken out. The thermal
  // route has no such trouble - it prints the dots directly.
  const lines = previewLines(input).filter((line) => line.trim() !== '[ logo ]')
  printLinesInBrowser(lines, input.paperWidth, logoDataUrl)
}

/**
 * Put arbitrary already-laid-out lines on paper.
 *
 * An X or Z reading is not a receipt but it goes on the same roll, so it uses
 * the same path rather than a second one that could drift.
 */
export function printLinesInBrowser(
  lines: string[],
  paperWidth: PaperWidth,
  logoDataUrl?: string | null,
): void {
  document.getElementById(PRINT_ROOT_ID)?.remove()
  document.getElementById(PAGE_STYLE_ID)?.remove()

  // @page cannot be varied by a selector, so the paper size is written in at
  // print time. Without it the driver scales the receipt to fit A4.
  const pageStyle = document.createElement('style')
  pageStyle.id = PAGE_STYLE_ID
  pageStyle.textContent = `@media print { @page { margin: 0; size: ${paperWidth}mm auto; } }`
  document.head.appendChild(pageStyle)

  const root = document.createElement('div')
  root.id = PRINT_ROOT_ID
  root.setAttribute('data-paper', String(paperWidth))

  if (logoDataUrl) {
    const logo = document.createElement('img')
    logo.src = logoDataUrl
    logo.alt = ''
    logo.className = 'receipt-logo'
    root.appendChild(logo)
  }

  // The text goes in its own node so the logo is not caught by white-space:
  // pre, and so the body keeps exactly the columns that were counted for it.
  const body = document.createElement('pre')
  body.className = 'receipt-body'
  body.textContent = lines.join('\n')
  root.appendChild(body)

  document.body.appendChild(root)

  const done = (): void => {
    root.remove()
    pageStyle.remove()
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)

  window.print()

  // Safari never fires afterprint reliably, so the node is swept up anyway.
  setTimeout(done, 60_000)
}

// ------------------------------------------------------------------ print --

export interface PrintOptions {
  route: PrintRoute
  openDrawer?: boolean
  copies?: number
  /** For the browser route, which prints the picture rather than the dots. */
  logoDataUrl?: string | null
}

/**
 * Print a receipt by whichever route the till is set up for.
 *
 * Printing is never allowed to take a sale down with it: the caller decides
 * what to do with a failure, and in the till that is a toast rather than a
 * blocked screen. A sale is complete when it is committed, not when it is
 * printed.
 */
export async function printReceipt(input: ReceiptInput, options: PrintOptions): Promise<void> {
  if (options.route === 'BROWSER') {
    printInBrowser(input, options.logoDataUrl)
    return
  }

  const bytes = encodeEscPos(composeReceipt(input), {
    width: input.paperWidth,
    openDrawer: options.openDrawer,
  })

  for (let copy = 0; copy < Math.max(1, options.copies ?? 1); copy++) {
    if (options.route === 'BLUETOOTH') await sendBluetooth(bytes)
    else await sendUsb(bytes)
  }
}

/** Open the cash drawer without printing anything. */
export async function openDrawer(route: PrintRoute): Promise<void> {
  if (route === 'BROWSER') throw new Error('The browser cannot open a cash drawer. Use a connected printer.')
  const bytes = drawerKick()
  if (route === 'BLUETOOTH') await sendBluetooth(bytes)
  else await sendUsb(bytes)
}

/** A short receipt used to check the paper width and the connection. */
export function testReceipt(paperWidth: PaperWidth, businessName: string): ReceiptInput {
  return {
    paperWidth,
    currency: { symbol: '₱', code: 'PHP', locale: 'en-PH', minorPerMajor: 100 },
    business: { name: businessName },
    meta: {
      receiptNo: 'TEST-PRINT',
      occurredAt: Date.now(),
      cashierName: 'Test print',
    },
    items: [
      { quantity: 1, name: 'Test line', detail: 'checking the width', amount: 12300 },
      { quantity: 2, name: 'Second line', amount: 24600 },
    ],
    discounts: [],
    totals: {
      subtotal: 36900,
      discountTotal: 0,
      taxableSales: 32946,
      taxExemptSales: 0,
      zeroRatedSales: 0,
      taxTotal: 3954,
      taxExemptTotal: 0,
      total: 36900,
      taxLabel: 'VAT',
      taxEnabled: true,
    },
    payments: [{ label: 'Cash', amount: 40000 }],
    change: 3100,
    footer: 'If this line is not cut off, the paper width is right.',
  }
}
