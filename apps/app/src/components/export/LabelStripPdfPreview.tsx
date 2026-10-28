import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getPdfJs } from '@/lib/plan/pdfImport'

interface PdfViewportLike {
  width: number
  height: number
}

interface PdfPageLike {
  getViewport(options: { scale: number }): PdfViewportLike
  render(options: {
    canvas: HTMLCanvasElement
    canvasContext: CanvasRenderingContext2D
    viewport: PdfViewportLike
    transform?: [number, number, number, number, number, number]
  }): PdfRenderTaskLike
}

interface PdfRenderTaskLike {
  promise: Promise<unknown>
  cancel?: () => void
}

interface PdfDocumentLike {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageLike>
  destroy(): Promise<void> | void
}

interface LabelStripPdfPreviewProps {
  blob: Blob
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1
const INITIAL_ZOOM = 0.5

export function LabelStripPdfPreview({ blob }: LabelStripPdfPreviewProps) {
  const { t } = useTranslation()
  const [pdfDocument, setPdfDocument] = useState<PdfDocumentLike | null>(null)
  const [pageNumbers, setPageNumbers] = useState<number[]>([])
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set())
  const [previousBlob, setPreviousBlob] = useState(blob)
  if (previousBlob !== blob) {
    setPreviousBlob(blob)
    setPdfDocument(null)
    setPageNumbers([])
    setVisiblePages(new Set())
    setIsLoading(true)
    setLoadError(false)
  }
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({})
  const pageRefs = useRef<Record<number, HTMLElement | null>>({})
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const renderedAtZoomRef = useRef<Record<number, number>>({})

  useEffect(() => {
    let cancelled = false
    let loadedDocument: PdfDocumentLike | null = null

    renderedAtZoomRef.current = {}

    void (async () => {
      try {
        const pdfjs = await getPdfJs()
        const bytes = await blob.arrayBuffer()
        const nextDocument = (await pdfjs.getDocument({ data: bytes }).promise) as PdfDocumentLike
        loadedDocument = nextDocument

        if (cancelled) {
          void nextDocument.destroy()
          return
        }

        setPdfDocument(nextDocument)
        const nextPageNumbers = Array.from(
          { length: nextDocument.numPages },
          (_, index) => index + 1
        )
        setPageNumbers(nextPageNumbers)
        setVisiblePages(new Set(nextPageNumbers.slice(0, 1)))
        setIsLoading(false)
      } catch {
        if (!cancelled) {
          setIsLoading(false)
          setLoadError(true)
        }
      }
    })()

    return () => {
      cancelled = true
      if (loadedDocument) void loadedDocument.destroy()
    }
  }, [blob])

  useEffect(() => {
    if (!pdfDocument || pageNumbers.length === 0) return

    const root = previewContainerRef.current
    if (!root || typeof IntersectionObserver === 'undefined') {
      setVisiblePages(new Set(pageNumbers))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisiblePages = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number((entry.target as HTMLElement).dataset.pageNumber))
          .filter((pageNumber) => Number.isFinite(pageNumber))
        if (newlyVisiblePages.length === 0) return

        setVisiblePages((currentPages) => {
          const nextPages = new Set(currentPages)
          newlyVisiblePages.forEach((pageNumber) => nextPages.add(pageNumber))
          return nextPages
        })
      },
      { root, rootMargin: '400px 0px' }
    )

    pageNumbers.forEach((pageNumber) => {
      const pageElement = pageRefs.current[pageNumber]
      if (pageElement) observer.observe(pageElement)
    })

    return () => observer.disconnect()
  }, [pageNumbers, pdfDocument])

  useEffect(() => {
    if (!pdfDocument || visiblePages.size === 0) return

    let cancelled = false
    const outputScale = window.devicePixelRatio || 1
    const renderTasks = new Set<PdfRenderTaskLike>()
    const pagesToRender = [...visiblePages].filter(
      (pageNumber) => renderedAtZoomRef.current[pageNumber] !== zoom
    )

    void Promise.all(
      pagesToRender.map(async (pageNumber) => {
        const canvas = canvasRefs.current[pageNumber]
        if (!canvas) return

        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled) return

        const cssViewport = page.getViewport({ scale: zoom })
        canvas.width = Math.ceil(cssViewport.width * outputScale)
        canvas.height = Math.ceil(cssViewport.height * outputScale)
        canvas.style.width = `${cssViewport.width}px`
        canvas.style.height = `${cssViewport.height}px`

        const context = canvas.getContext('2d')
        if (!context) return
        context.clearRect(0, 0, canvas.width, canvas.height)
        const renderTask = page.render({
          canvasContext: context,
          canvas,
          viewport: cssViewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        })
        renderTasks.add(renderTask)
        try {
          await renderTask.promise
          if (!cancelled) renderedAtZoomRef.current[pageNumber] = zoom
        } finally {
          renderTasks.delete(renderTask)
        }
      })
    ).catch(() => {
      // A document can be destroyed while its pages are rendering.
    })

    return () => {
      cancelled = true
      renderTasks.forEach((renderTask) => renderTask.cancel?.())
    }
  }, [pdfDocument, visiblePages, zoom])

  const adjustZoom = (amount: number) => {
    setZoom((value) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((value + amount) * 10) / 10))
    )
  }

  return (
    <div className="overflow-hidden rounded border border-sky-200 bg-slate-100 dark:border-sky-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-2 border-b border-sky-200 bg-white px-2 py-1.5 dark:border-sky-800 dark:bg-gray-900">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          {pageNumbers.length > 0
            ? t('labelStripExport.previewPages', { count: pageNumbers.length })
            : t('labelStripExport.preview')}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => adjustZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            className="rounded p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label={t('canvas.zoomOut')}
            title={t('canvas.zoomOut')}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <span className="min-w-12 px-1 text-center text-xs font-semibold text-gray-700 dark:text-gray-200">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => adjustZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            className="rounded p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label={t('canvas.zoomIn')}
            title={t('canvas.zoomIn')}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setZoom(INITIAL_ZOOM)}
            className="ml-1 rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label={t('canvas.resetZoom')}
            title={t('canvas.resetZoom')}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div ref={previewContainerRef} data-export-scroll="true" className="h-80 overflow-auto p-2">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            {t('labelStripExport.previewLoading')}
          </div>
        ) : loadError || !pdfDocument ? (
          <div className="flex h-48 items-center justify-center text-sm text-red-600 dark:text-red-400">
            {t('labelStripExport.previewError')}
          </div>
        ) : (
          <div className="flex min-w-full flex-col items-center gap-3">
            {pageNumbers.map((pageNumber) => (
              <figure
                key={pageNumber}
                ref={(element) => {
                  pageRefs.current[pageNumber] = element
                }}
                data-page-number={pageNumber}
                className="flex min-h-[120px] max-w-full flex-col items-center justify-center gap-1"
              >
                <canvas
                  ref={(canvas) => {
                    canvasRefs.current[pageNumber] = canvas
                  }}
                  className={`block max-w-none bg-white shadow-sm ${visiblePages.has(pageNumber) ? '' : 'hidden'}`}
                />
                {!visiblePages.has(pageNumber) ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {t('planImport.pageLabel', { page: pageNumber })}
                  </span>
                ) : null}
                {visiblePages.has(pageNumber) ? (
                  <figcaption className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t('planImport.pageLabel', { page: pageNumber })}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
