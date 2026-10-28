import { useCallback, useEffect, useState } from 'react'
import type { PdfImportPageCandidate } from '@/lib/plan/pdfImport'
import {
  applyDarkModeInversion,
  getRasterThemePreviewUrl,
  getVectorSvgThemePreviewUrl,
  processPdfRasterBackground,
  svgHasUnresolvedEmbeddedImages,
} from '@/utils/planImageProcessing'

/** Publishes quick page thumbnails before the more expensive full-size previews. */
export function usePlanImportPagePreviews({
  isPdfImport, isCadMultiCropImport, pdfPages, pdfPageCroppedPreviewMap, isDarkMode,
}: {
  isPdfImport: boolean
  isCadMultiCropImport: boolean
  pdfPages: PdfImportPageCandidate[]
  pdfPageCroppedPreviewMap: Record<number, string>
  isDarkMode: boolean
}) {
  const [pdfPageThemePreviewMap, setPdfPageThemePreviewMap] = useState<Record<number, string>>({})
  const [pdfPageRasterThemePreviewMap, setPdfPageRasterThemePreviewMap] = useState<
    Record<number, string>
  >({})
  const hasPages = (isPdfImport || isCadMultiCropImport) && pdfPages.length > 0
  if (!hasPages) {
    if (Object.keys(pdfPageThemePreviewMap).length) setPdfPageThemePreviewMap({})
    if (Object.keys(pdfPageRasterThemePreviewMap).length) setPdfPageRasterThemePreviewMap({})
  }
  const getPdfRasterThemePreviewUrl = useCallback(
    async (dataUrl: string, darkMode: boolean): Promise<string> => {
      const processed = await processPdfRasterBackground(dataUrl)
      const source = processed.hasWhiteBackground ? processed.processedDataUrl : dataUrl
      return darkMode ? applyDarkModeInversion(source) : source
    },
    []
  )
  useEffect(() => {
    if (!hasPages) return
    let cancelled = false
    void (async () => {
      const thumbEntries = await Promise.all(
        pdfPages.map(async (page) => {
          const cropped = pdfPageCroppedPreviewMap[page.pageIndex]
          if (cropped) {
            return [
              page.pageIndex,
              isPdfImport
                ? await getPdfRasterThemePreviewUrl(cropped, isDarkMode)
                : await getRasterThemePreviewUrl(cropped, isDarkMode),
            ] as const
          }
          if (page.vectorSvg && !svgHasUnresolvedEmbeddedImages(page.vectorSvg)) {
            return [
              page.pageIndex,
              await getVectorSvgThemePreviewUrl(page.vectorSvg, isDarkMode),
            ] as const
          }
          return [
            page.pageIndex,
            isPdfImport
              ? await getPdfRasterThemePreviewUrl(page.previewDataUrl, isDarkMode)
              : isDarkMode
                ? await getRasterThemePreviewUrl(page.previewDataUrl, isDarkMode)
                : page.previewDataUrl,
          ] as const
        })
      )
      if (cancelled) return
      // Publish thumbnails first; full-size raster theming can take seconds per page.
      const thumbMap = Object.fromEntries(thumbEntries)
      setPdfPageThemePreviewMap(thumbMap)
      const rasterEntries = await Promise.all(
        pdfPages.map(async (page) => {
          const cropped = pdfPageCroppedPreviewMap[page.pageIndex]
          const themedVector = thumbMap[page.pageIndex]
          if (isCadMultiCropImport && !cropped && page.vectorSvg && themedVector) {
            // The themed SVG has the page's own size, so it serves the scale step
            // without a per-pixel inversion pass.
            return [page.pageIndex, themedVector] as const
          }
          const raster = cropped ?? page.rasterDataUrl
          if (!isDarkMode) return [page.pageIndex, raster] as const
          return [
            page.pageIndex,
            isPdfImport
              ? await getPdfRasterThemePreviewUrl(raster, isDarkMode)
              : await getRasterThemePreviewUrl(raster, isDarkMode),
          ] as const
        })
      )
      if (!cancelled) setPdfPageRasterThemePreviewMap(Object.fromEntries(rasterEntries))
    })()
    return () => {
      cancelled = true
    }
  }, [
    hasPages,
    isPdfImport,
    isCadMultiCropImport,
    pdfPages,
    pdfPageCroppedPreviewMap,
    isDarkMode,
    getPdfRasterThemePreviewUrl,
  ])

  return {
    pdfPageThemePreviewMap, setPdfPageThemePreviewMap,
    pdfPageRasterThemePreviewMap, setPdfPageRasterThemePreviewMap,
  }
}
