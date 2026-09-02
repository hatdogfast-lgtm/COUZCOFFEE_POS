/**
 * Stamp the shop in `brand.config.json` onto the things a build bakes in.
 *
 * Two of the shop's marks cannot be changed once an app is installed: the name
 * under the home-screen icon, and the icon itself. Android reads both from
 * resources compiled into the APK, so they are decided here at build time
 * rather than in Settings like the rest of the branding.
 *
 * That is the only reason this script exists. Everything a till shows on
 * screen - the header, the receipts, the colours - stays editable at
 * Settings -> Shop, syncs between devices, and is not touched by any of this.
 *
 * Run: npm run brand
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const brand = JSON.parse(await readFile(path.join(root, 'brand.config.json'), 'utf8'))

/** Densities Android expects, and the launcher icon size each one wants. */
const DENSITIES = [
  { dir: 'mipmap-mdpi', icon: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', icon: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', icon: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', icon: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', icon: 192, foreground: 432 },
]

const done = []
const skipped = []

/* ------------------------------------------------------------------ name -- */

/**
 * XML text, not XML markup. A shop called "Bean & Co" would otherwise write a
 * strings.xml that does not parse, and the build would fail somewhere far away
 * from the cause.
 */
function xmlEscape(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function writeAppName() {
  const file = path.join(root, 'android/app/src/main/res/values/strings.xml')
  if (!existsSync(file)) {
    skipped.push('strings.xml (no android project here)')
    return
  }
  const name = xmlEscape(brand.appName)
  const before = await readFile(file, 'utf8')
  const after = before
    .replace(/(<string name="app_name">)[\s\S]*?(<\/string>)/, `$1${name}$2`)
    .replace(/(<string name="title_activity_main">)[\s\S]*?(<\/string>)/, `$1${name}$2`)

  if (after === before) {
    skipped.push(`app name (already "${brand.appName}")`)
    return
  }
  await writeFile(file, after)
  done.push(`app name -> "${brand.appName}"`)
}

/**
 * Capacitor's own config, which it reads when generating a native project.
 *
 * Rewritten as text rather than having that file read this one, because the
 * Capacitor CLI loads capacitor.config.ts as CommonJS: a runtime import there
 * throws before the config is ever parsed.
 */
async function writeCapacitorName() {
  const file = path.join(root, 'capacitor.config.ts')
  if (!existsSync(file)) {
    skipped.push('capacitor.config.ts (not found)')
    return
  }
  const escaped = brand.appName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const before = await readFile(file, 'utf8')
  const after = before.replace(/(\n  appName: )'(?:[^'\\]|\\.)*'/, `$1'${escaped}'`)

  if (after === before) {
    skipped.push('capacitor.config.ts (already current)')
    return
  }
  await writeFile(file, after)
  done.push('capacitor.config.ts appName')
}

/* ----------------------------------------------------------------- icons -- */

/**
 * The source artwork, padded out to a square before anything is scaled.
 *
 * A wide wordmark squeezed into a square icon is the usual way a launcher
 * icon ends up stretched. Fitting it inside instead keeps the proportions and
 * pays for it in empty space, which the background colour then fills.
 */
async function squareSource(file, size, background) {
  return sharp(file)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
    alpha: 1,
  }
}

async function writeIcons() {
  const source = path.join(root, brand.launcherIcon)
  if (!existsSync(source)) {
    skipped.push(`launcher icons (no ${brand.launcherIcon} - the existing ones are left alone)`)
    return
  }

  const resDir = path.join(root, 'android/app/src/main/res')
  if (!existsSync(resDir)) {
    skipped.push('launcher icons (no android project here)')
    return
  }

  const background = hexToRgb(brand.launcherBackground)
  const zoom = Math.min(Math.max(brand.launcherZoom ?? 0.62, 0.2), 1)

  for (const density of DENSITIES) {
    const dir = path.join(resDir, density.dir)
    await mkdir(dir, { recursive: true })

    // The plain icon: artwork on the brand colour, filling the square. This is
    // what Android 7 and below show, and what a launcher falls back to.
    const flat = await squareSource(source, Math.round(density.icon * zoom))
    const legacy = await sharp({
      create: { width: density.icon, height: density.icon, channels: 4, background },
    })
      .composite([{ input: flat, gravity: 'center' }])
      .png()
      .toBuffer()

    await writeFile(path.join(dir, 'ic_launcher.png'), legacy)
    await writeFile(path.join(dir, 'ic_launcher_round.png'), legacy)

    // The adaptive foreground: artwork alone on transparency, sized to the
    // safe zone, because the launcher crops this layer to whatever shape the
    // phone's theme happens to use.
    const inner = Math.round(density.foreground * zoom * 0.66)
    const art = await squareSource(source, inner)
    const foreground = await sharp({
      create: {
        width: density.foreground,
        height: density.foreground,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: art, gravity: 'center' }])
      .png()
      .toBuffer()

    await writeFile(path.join(dir, 'ic_launcher_foreground.png'), foreground)
  }

  const colourFile = path.join(resDir, 'values/ic_launcher_background.xml')
  await writeFile(
    colourFile,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${brand.launcherBackground}</color>\n</resources>\n`,
  )

  done.push(`launcher icons from ${brand.launcherIcon} (5 densities, adaptive + legacy)`)
}

/* --------------------------------------------------------------- web app -- */

/**
 * The icons the browser and "Add to Home Screen" use. Generated from the same
 * artwork so a till bookmarked in Chrome and a till installed from the APK do
 * not end up wearing different badges.
 */
async function writeWebIcons() {
  const source = path.join(root, brand.launcherIcon)
  if (!existsSync(source)) {
    skipped.push('web icons (no launcher artwork)')
    return
  }

  const background = hexToRgb(brand.launcherBackground)
  const publicDir = path.join(root, 'public')
  await mkdir(publicDir, { recursive: true })

  const sizes = [
    { file: 'icon-192.png', size: 192, zoom: 0.72 },
    { file: 'icon-512.png', size: 512, zoom: 0.72 },
    { file: 'apple-touch-icon.png', size: 180, zoom: 0.72 },
    // Maskable icons are cropped hard by the launcher, so the artwork sits
    // well inside the frame rather than against its edges.
    { file: 'icon-512-maskable.png', size: 512, zoom: 0.56 },
  ]

  for (const entry of sizes) {
    const art = await squareSource(source, Math.round(entry.size * entry.zoom))
    const out = await sharp({
      create: { width: entry.size, height: entry.size, channels: 4, background },
    })
      .composite([{ input: art, gravity: 'center' }])
      .png()
      .toBuffer()
    await writeFile(path.join(publicDir, entry.file), out)
  }

  done.push('web and PWA icons (4 sizes)')
}

/* ------------------------------------------------------------------ main -- */

await writeAppName()
await writeCapacitorName()
await writeIcons()
await writeWebIcons()

console.log(`\nBranded as "${brand.appName}" for ${brand.businessName}.\n`)
for (const line of done) console.log(`  updated  ${line}`)
for (const line of skipped) console.log(`  skipped  ${line}`)
console.log(
  '\nThe web title, PWA manifest and a new till\'s starting branding read brand.config.json' +
    '\ndirectly, so they need no generating. Run `npm run build:native` to put this in an APK.\n',
)
