/**
 * 1-bit Windows bitmap encoding. P-touch Editor cannot print white text, so inverted
 * label content is embedded as a black-and-white image, the same way Brother's own
 * templates store pictures in an LBX archive.
 */
export function encodeMonochromeBmp(
  width: number,
  height: number,
  isWhite: (x: number, y: number) => boolean,
  dpi = 360
): Uint8Array {
  const rowBytes = Math.ceil(width / 32) * 4
  const paletteSize = 8
  const headerSize = 14 + 40 + paletteSize
  const fileSize = headerSize + rowBytes * height
  const bytes = new Uint8Array(fileSize)
  const view = new DataView(bytes.buffer)
  const pixelsPerMeter = Math.round(dpi / 0.0254)

  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(2, fileSize, true)
  view.setUint32(10, headerSize, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 1, true)
  view.setUint32(34, rowBytes * height, true)
  view.setInt32(38, pixelsPerMeter, true)
  view.setInt32(42, pixelsPerMeter, true)
  view.setUint32(46, 2, true)
  // Palette index 0 is black, index 1 is white (BGRA).
  bytes.set([0, 0, 0, 0, 255, 255, 255, 0], 54)

  // Rows are stored bottom-up, most significant bit first.
  for (let y = 0; y < height; y += 1) {
    const rowOffset = headerSize + (height - 1 - y) * rowBytes
    for (let x = 0; x < width; x += 1) {
      if (isWhite(x, y)) bytes[rowOffset + (x >> 3)]! |= 0x80 >> (x & 7)
    }
  }
  return bytes
}

/**
 * Draws white bold text on a black band at the given pixel size. Returns null where no
 * 2D canvas is available (tests, server tooling), so callers can fall back to plain text.
 */
export function rasterizeInvertedBand(
  text: string,
  widthPx: number,
  heightPx: number
): Uint8Array | null {
  if (typeof document === 'undefined' || widthPx < 1 || heightPx < 1) return null
  let context: CanvasRenderingContext2D | null = null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    context = canvas.getContext('2d')
  } catch {
    return null
  }
  if (!context) return null

  context.fillStyle = '#000000'
  context.fillRect(0, 0, widthPx, heightPx)
  let fontSize = Math.floor(heightPx * 0.62)
  const setFont = () => {
    context!.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`
  }
  setFont()
  while (fontSize > 4 && context.measureText(text).width > widthPx * 0.92) {
    fontSize -= 1
    setFont()
  }
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, widthPx / 2, heightPx / 2)

  const { data } = context.getImageData(0, 0, widthPx, heightPx)
  return encodeMonochromeBmp(widthPx, heightPx, (x, y) => data[(y * widthPx + x) * 4]! >= 128)
}
