/** Full Konva text box, including whitespace advances and a small scaled allowance. */
let measureCanvas: HTMLCanvasElement | null = null

export function getLabelBoxSize(
  text: string,
  fontSize: number,
  fontFamily: string
): { width: number; height: number } {
  const lines = text.split('\n')
  const padding = fontSize / 6
  const fallbackWidth = Math.max(0, ...lines.map((line) => line.length * fontSize * 0.6))
  let width = fallbackWidth
  if (typeof document !== 'undefined') {
    measureCanvas ??= document.createElement('canvas')
    const ctx = measureCanvas.getContext('2d')
    if (ctx) {
      ctx.font = `${fontSize}px ${fontFamily}`
      width = Math.max(
        0,
        ...lines.map((line) => {
          const metrics = ctx.measureText(line)
          // Konva positions text using its advance width, not just the ink bounds.
          const inkWidth =
            (metrics.actualBoundingBoxLeft ?? 0) + (metrics.actualBoundingBoxRight ?? 0)
          return Math.max(metrics.width, inkWidth)
        })
      )
    }
  }
  return { width: width + padding, height: lines.length * fontSize + padding }
}

/** Use the same margin to generate candidates and to check symbol collisions. */
export function getPlanLabelClearance(fontSize: number): number {
  return (fontSize * 2) / 3
}
