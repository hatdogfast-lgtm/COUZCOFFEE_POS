import type { RasterImage } from '@pos/shared'

/**
 * Preparing a logo.
 *
 * The logo travels inside the settings record, which syncs to every till and
 * to the server. That is convenient - a shop uploads it once and every device
 * has it - but it means the file is carried in full on every settings change,
 * so it is shrunk hard before it is ever stored. A 4MB photograph off a phone
 * would otherwise be pushed around the shop forever.
 */

/** Comfortably enough for a header at any screen density, and small to sync. */
export const LOGO_MAX_DIMENSION = 512
export const LOGO_MAX_BYTES = 400_000

async function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('That file could not be read as an image.'))
    image.src = source
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Shrink a chosen file to something worth syncing.
 *
 * Transparency is preserved by keeping PNG when the source has an alpha
 * channel, because a coffee shop logo on a dark header looks wrong on a white
 * rectangle. Everything else becomes JPEG, which is far smaller for a photo.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')

  const source = await readAsDataUrl(file)
  const image = await loadImage(source)

  const scale = Math.min(1, LOGO_MAX_DIMENSION / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This device cannot process images.')
  context.drawImage(image, 0, 0, width, height)

  const wantsAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif'
  let out = canvas.toDataURL(wantsAlpha ? 'image/png' : 'image/jpeg', 0.85)

  // A PNG photograph can still be enormous. Fall back to JPEG rather than
  // refuse the upload, and only complain if even that is too big.
  if (out.length > LOGO_MAX_BYTES && wantsAlpha) {
    out = canvas.toDataURL('image/jpeg', 0.82)
  }
  if (out.length > LOGO_MAX_BYTES) {
    throw new Error('That image is too large even after shrinking. Try a simpler logo.')
  }

  return out
}

/**
 * Convert a logo to the one-bit form a thermal print head needs.
 *
 * Uses ordered dithering rather than a hard threshold: a flat cut-off turns
 * any logo with shading into a black blob, whereas a 4x4 Bayer matrix keeps
 * the shape readable on a device that only knows burned or not burned.
 */
export async function toRaster(dataUrl: string, dotWidth: number): Promise<RasterImage | null> {
  try {
    const image = await loadImage(dataUrl)

    // Never wider than the head, and never stretched beyond its own size.
    const width = Math.min(dotWidth, image.width, 8 * Math.floor(dotWidth / 8))
    const scale = width / image.width
    const height = Math.max(1, Math.round(image.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null

    // Transparent areas must become paper, not black: the printer has no idea
    // what alpha is, and an unpainted canvas reads as zero everywhere.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const { data } = context.getImageData(0, 0, width, height)
    const widthBytes = Math.ceil(width / 8)
    const packed = new Uint8Array(widthBytes * height)

    const BAYER = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4
        const red = data[offset] ?? 255
        const green = data[offset + 1] ?? 255
        const blue = data[offset + 2] ?? 255
        // Perceptual luminance: a pure blue logo is dark to the eye and must
        // burn, even though its raw average is middling.
        const luminance = 0.299 * red + 0.587 * green + 0.114 * blue
        const threshold = ((BAYER[y % 4]?.[x % 4] ?? 8) + 0.5) * (255 / 16)

        if (luminance < threshold) {
          // A set bit burns a dot. Bits run left to right within the byte.
          packed[y * widthBytes + (x >> 3)]! |= 0x80 >> (x & 7)
        }
      }
    }

    return { width, height, data: packed }
  } catch {
    // A logo that will not convert must never stop a receipt printing.
    return null
  }
}
