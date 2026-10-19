let measureCanvas: HTMLCanvasElement | null = null
let measureDocument: Document | null = null
let measuredFonts: FontFaceSet | undefined
const measuredWidths = new Map<string, number>()
// Campus drawings contain thousands of distinct labels. Keep a complete working
// set across the two preview layout passes instead of evicting it on every pass.
const MAX_MEASURED_WIDTHS = 8192
const invalidateWidths = () => measuredWidths.clear()

function prepareMeasurementDocument(currentDocument: Document): void {
  if (measureDocument !== currentDocument || measuredFonts !== currentDocument.fonts) {
    measuredFonts?.removeEventListener('loading', invalidateWidths)
    measuredFonts?.removeEventListener('loadingdone', invalidateWidths)
    measuredFonts?.removeEventListener('loadingerror', invalidateWidths)
    measureDocument = currentDocument
    measuredFonts = currentDocument.fonts
    measuredFonts?.addEventListener('loading', invalidateWidths)
    measuredFonts?.addEventListener('loadingdone', invalidateWidths)
    measuredFonts?.addEventListener('loadingerror', invalidateWidths)
    measureCanvas = null
    measuredWidths.clear()
  }
}

export function measureSymbolLabelTextWidth(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontStyle: 'normal' | 'italic' | 'bold' | 'italic bold' = 'normal'
): number {
  if (typeof document === 'undefined') {
    return Math.max(...text.split('\n').map((line) => line.length * fontSize * 0.6))
  }
  prepareMeasurementDocument(document)
  const font = `${fontStyle === 'normal' ? '' : `${fontStyle} `}${fontSize}px ${fontFamily}`
  // Keep long notes/source strings out of this small shared symbol-metrics cache.
  // During font loading, measure every read rather than retaining fallback widths.
  const key = text.length <= 512 && Number.isFinite(fontSize) && fontSize > 0 &&
    fontFamily.trim().length > 0 && measuredFonts?.status !== 'loading'
    ? JSON.stringify([font, text]) : null
  const cached = key === null ? undefined : measuredWidths.get(key)
  if (key !== null && cached !== undefined) {
    measuredWidths.delete(key)
    measuredWidths.set(key, cached)
    return cached
  }
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
  }
  if (typeof measureCanvas.getContext !== 'function') {
    return Math.max(...text.split('\n').map((line) => line.length * fontSize * 0.6))
  }
  const context = measureCanvas.getContext('2d')
  if (!context) {
    return Math.max(...text.split('\n').map((line) => line.length * fontSize * 0.6))
  }
  if (context.font !== font) context.font = font
  const width = Math.ceil(Math.max(...text.split('\n').map((line) => context.measureText(line).width)))
  if (key !== null && Number.isFinite(width)) {
    measuredWidths.set(key, width)
    if (measuredWidths.size > MAX_MEASURED_WIDTHS)
      measuredWidths.delete(measuredWidths.keys().next().value!)
  }
  return width
}
