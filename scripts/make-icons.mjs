/**
 * Generates every icon the project ships: the PWA set for the browser and the
 * launcher set for the Android app.
 *
 * Written from scratch with zlib so the project gains no image-processing
 * dependency for something it does exactly once. Re-run after changing BRAND.
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB_PUBLIC = path.join(ROOT, 'packages', 'web', 'public')
const ANDROID_RES = path.join(ROOT, 'packages', 'web', 'android', 'app', 'src', 'main', 'res')

const BRAND = [122, 74, 44] // #7A4A2C
const INK = [255, 251, 246]

// ------------------------------------------------------------- PNG encoding --

function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // no filter
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ----------------------------------------------------------------- drawing --

/** Signed distance to a rounded rectangle, for clean anti-aliased edges. */
function roundedRect(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius)
  const dy = Math.abs(y - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

function blend(target, offset, colour, alpha) {
  for (let channel = 0; channel < 3; channel++) {
    target[offset + channel] = Math.round(target[offset + channel] * (1 - alpha) + colour[channel] * alpha)
  }
  target[offset + 3] = Math.max(target[offset + 3], Math.round(255 * alpha))
}

/**
 * Draws the cup mark.
 *
 * `shape` controls the plate behind it: a rounded square for a normal icon, a
 * circle for Android's round launcher variant, or nothing at all for an
 * adaptive foreground, where the launcher supplies its own background and
 * crops the edges. `artScale` keeps the drawing inside whatever safe area the
 * target demands.
 */
function drawIcon(size, { shape = 'squircle', artScale = 0.92 } = {}) {
  const pixels = Buffer.alloc(size * size * 4)
  const scale = size / 512
  const cx = size / 2
  const cy = size / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4

      if (shape === 'squircle') {
        const plate = roundedRect(x, y, cx, cy, size / 2, size / 2, 112 * scale)
        const alpha = Math.min(1, Math.max(0, 0.5 - plate))
        if (alpha > 0) blend(pixels, offset, BRAND, alpha)
      } else if (shape === 'circle') {
        const alpha = Math.min(1, Math.max(0, 0.5 - (Math.hypot(x - cx, y - cy) - size / 2)))
        if (alpha > 0) blend(pixels, offset, BRAND, alpha)
      } else if (shape === 'full') {
        blend(pixels, offset, BRAND, 1)
      }
      // shape === 'none' leaves the background transparent.

      // Artwork, authored in a 512 space and scaled into place.
      const ax = (x - cx) / (scale * artScale) + 256
      const ay = (y - cy) / (scale * artScale) + 256

      // Cup body: a trapezoid narrowing towards the base.
      const bodyTop = 176
      const bodyBottom = 356
      let inBody = 0
      if (ay >= bodyTop && ay <= bodyBottom) {
        const progress = (ay - bodyTop) / (bodyBottom - bodyTop)
        const halfWidth = 108 - progress * 30
        inBody = Math.min(1, Math.max(0, 0.5 - (Math.abs(ax - 246) - halfWidth)))
        inBody = Math.min(inBody, Math.min(1, Math.max(0, ay - bodyTop + 0.5)))
        inBody = Math.min(inBody, Math.min(1, Math.max(0, bodyBottom - ay + 0.5)))
      }

      // Handle: an annulus clipped to the right of the cup wall, so it reads
      // as attached rather than as a ring lying on top of the body.
      let inHandle = 0
      if (ax > 344) {
        const ring = Math.abs(Math.hypot(ax - 356, ay - 236) - 46)
        inHandle = Math.min(1, Math.max(0, 0.5 - (ring - 15)))
      }

      const saucer = Math.min(1, Math.max(0, 0.5 - roundedRect(ax, ay, 246, 384, 132, 15, 15)))

      let inSteam = 0
      if (ay > 96 && ay < 152) {
        for (const steamX of [214, 278]) {
          const wobble = Math.sin((ay - 96) / 22) * 11
          inSteam = Math.max(inSteam, Math.min(1, Math.max(0, 0.5 - (Math.abs(ax - (steamX + wobble)) - 9))) * 0.85)
        }
      }

      const mark = Math.max(inBody, inHandle, saucer, inSteam)
      if (mark > 0) blend(pixels, offset, INK, mark)
    }
  }
  return encodePng(size, size, pixels)
}

// ------------------------------------------------------------------ outputs --

function write(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buffer)
}

// The PWA set, used by the browser and by "Add to Home Screen" on iOS.
fs.mkdirSync(WEB_PUBLIC, { recursive: true })
const pwa = [
  ['icon-192.png', 192, { shape: 'squircle' }],
  ['icon-512.png', 512, { shape: 'squircle' }],
  // A maskable icon is cropped by the launcher, so it fills the canvas and
  // keeps the mark well inside the safe area.
  ['icon-512-maskable.png', 512, { shape: 'full', artScale: 0.62 }],
  ['apple-touch-icon.png', 180, { shape: 'squircle' }],
]
for (const [name, size, options] of pwa) {
  write(path.join(WEB_PUBLIC, name), drawIcon(size, options))
  console.log(`web    ${name} (${size}px)`)
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#7A4A2C"/>
  <path d="M138 176h216v72a108 108 0 0 1-108 108 108 108 0 0 1-108-108z" fill="#FFFBF6"/>
  <path d="M354 200a52 52 0 1 1 0 104" fill="none" stroke="#FFFBF6" stroke-width="30"/>
  <rect x="114" y="369" width="264" height="30" rx="15" fill="#FFFBF6"/>
  <path d="M214 100c-14 18-14 34 0 52M278 100c-14 18-14 34 0 52" fill="none" stroke="#FFFBF6" stroke-width="18" stroke-linecap="round" opacity=".85"/>
</svg>
`
fs.writeFileSync(path.join(WEB_PUBLIC, 'favicon.svg'), favicon)
console.log('web    favicon.svg')

// The Android launcher set. Skipped silently when the native project has not
// been generated yet, so this script is safe to run in a fresh checkout.
if (fs.existsSync(ANDROID_RES)) {
  const densities = [
    ['mdpi', 48, 108],
    ['hdpi', 72, 162],
    ['xhdpi', 96, 216],
    ['xxhdpi', 144, 324],
    ['xxxhdpi', 192, 432],
  ]

  for (const [density, legacy, adaptive] of densities) {
    const dir = path.join(ANDROID_RES, `mipmap-${density}`)
    write(path.join(dir, 'ic_launcher.png'), drawIcon(legacy, { shape: 'squircle' }))
    write(path.join(dir, 'ic_launcher_round.png'), drawIcon(legacy, { shape: 'circle' }))
    // Adaptive foregrounds are 108dp with only the middle 72dp guaranteed
    // visible, so the mark is drawn at two thirds scale on a clear background.
    write(path.join(dir, 'ic_launcher_foreground.png'), drawIcon(adaptive, { shape: 'none', artScale: 0.62 }))
    console.log(`android mipmap-${density} (${legacy}px, ${adaptive}px adaptive)`)
  }

  // The adaptive background is a flat brand colour behind the foreground.
  write(
    path.join(ANDROID_RES, 'values', 'ic_launcher_background.xml'),
    Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#7A4A2C</color>\n</resources>\n`,
      'utf8',
    ),
  )
  console.log('android ic_launcher_background.xml')
} else {
  console.log('android project not generated yet - skipping launcher icons')
}
