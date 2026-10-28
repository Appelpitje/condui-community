const DRAG_IMAGE_SIZE = 36

export type LibraryDragImageStrategy = 'element' | 'canvas-from-blob' | 'empty-canvas'

function createEmptyDragCanvas(ownerDocument: Document): HTMLCanvasElement {
  const canvas = ownerDocument.createElement('canvas')
  canvas.width = DRAG_IMAGE_SIZE
  canvas.height = DRAG_IMAGE_SIZE
  return canvas
}

function setCanvasDragImage(event: DragEvent, iconEl: HTMLElement, canvas: HTMLCanvasElement) {
  const rect = iconEl.getBoundingClientRect()
  // Chromium can fall back to the whole draggable row when the canvas has no
  // rendered box. Keep it in the source viewport through drag-image capture.
  Object.assign(canvas.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${DRAG_IMAGE_SIZE}px`,
    height: `${DRAG_IMAGE_SIZE}px`,
    pointerEvents: 'none',
  })
  canvas.setAttribute('aria-hidden', 'true')
  const ownerDocument = iconEl.ownerDocument
  ownerDocument.body.appendChild(canvas)
  try {
    canvas.getBoundingClientRect()
    event.dataTransfer?.setDragImage(canvas, DRAG_IMAGE_SIZE / 2, DRAG_IMAGE_SIZE / 2)
  } finally {
    // The browser captures after dragstart dispatch, before the next task.
    const ownerWindow = ownerDocument.defaultView ?? window
    ownerWindow.setTimeout(() => canvas.remove(), 0)
  }
}

function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const hasSafari = ua.includes('Safari')
  const hasChromium = ua.includes('Chrome') || ua.includes('Chromium') || ua.includes('CriOS')
  return hasSafari && !hasChromium
}

/**
 * Browsers such as Brave on Linux may abort HTML5 drag-and-drop when
 * setDragImage references DOM that contains blob-URL <img> nodes.
 * Draw loaded symbol previews onto a canvas drag image instead.
 *
 * Safari needs the opposite treatment: drawing a blob-URL SVG onto a canvas
 * taints it (WebKit treats SVG as cross-origin), and a tainted canvas passed
 * to setDragImage makes WebKit abort dragstart entirely, so the library drag
 * never begins. Skipping setDragImage lets the drag start, but then WebKit
 * snapshots the whole library row at half opacity as the drag image — a bulky,
 * text-laden ghost. Instead we hand Safari a transparent (empty, so untainted)
 * canvas: the drag starts and only the copy cursor shows.
 * The canvas is attached to the DOM while WebKit captures it, then removed.
 */
export function setLibrarySymbolDragImage(
  event: DragEvent,
  iconEl: HTMLElement
): LibraryDragImageStrategy {
  if (isSafari()) {
    const canvas = createEmptyDragCanvas(iconEl.ownerDocument)
    setCanvasDragImage(event, iconEl, canvas)
    return 'empty-canvas'
  }

  const blobImg = iconEl.querySelector<HTMLImageElement>('img[src^="blob:"]')
  if (blobImg) {
    const canvas = createEmptyDragCanvas(iconEl.ownerDocument)
    const ctx = canvas.getContext('2d')
    if (ctx && blobImg.complete && blobImg.naturalWidth > 0) {
      ctx.drawImage(blobImg, 0, 0, DRAG_IMAGE_SIZE, DRAG_IMAGE_SIZE)
    }
    setCanvasDragImage(event, iconEl, canvas)
    return blobImg.complete && blobImg.naturalWidth > 0 ? 'canvas-from-blob' : 'empty-canvas'
  }

  const rect = iconEl.getBoundingClientRect()
  event.dataTransfer?.setDragImage(iconEl, rect.width / 2, rect.height / 2)
  return 'element'
}
