import type { BaseCanvasProps } from './baseCanvasModel'

import type { useViewportUIApi } from '@/components/viewport/ViewportUIStore'

import { useCallback } from 'react'

import type Konva from 'konva'

import type { CanvasSize, Point } from '@/types/ui'
import { ZOOM_MAX } from '@/constants/canvasConstants'

import { resolveKonvaElementId } from './baseCanvasElementId'

import type { RefObject } from 'react'

type KonvaNodeCollectionLike = Konva.Node[] | {
  each: (callback: (node: Konva.Node) => void) => void
}
interface BaseCanvasFitToViewOptions extends Pick<BaseCanvasProps,
  'onGetSelectionBounds' | 'onPrepareFitToView' | 'selectionFitMaxZoom'> {
  containerRef: RefObject<HTMLDivElement | null>
  emitViewTransformPatch: (patch: { pan?: Point; zoom?: number }) => void
  fin: (n: number, fallback: number) => number
  gridInTransformedLayer: boolean
  minZoomRef: RefObject<number>
  safePan: Point
  safeZoom: number
  size: CanvasSize
  stageRef: RefObject<Konva.Stage | null>
  viewportUI: ReturnType<typeof useViewportUIApi>
}

export function useBaseCanvasFitToView({
  containerRef,
  emitViewTransformPatch,
  fin,
  gridInTransformedLayer,
  minZoomRef,
  onGetSelectionBounds,
  onPrepareFitToView,
  safePan,
  safeZoom,
  selectionFitMaxZoom,
  size,
  stageRef,
  viewportUI,
}: BaseCanvasFitToViewOptions) {
  // Helper function to recursively get bounds of a node and all its children
  const getNodeBounds = useCallback(
    function getNodeBounds(
      node: Konva.Node,
      parentX: number = 0,
      parentY: number = 0
    ): { minX: number; minY: number; maxX: number; maxY: number } | null {
      const nodeX = node.x() + parentX
      const nodeY = node.y() + parentY

      // For Groups, we need to check all children recursively
      if (node.getType() === 'Group') {
        const group = node as Konva.Group
        const children = group.getChildren()

        if (children.length === 0) {
          return null
        }

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        let hasValidBounds = false

        children.forEach((child) => {
          const childBounds = getNodeBounds(child, nodeX, nodeY)
          if (childBounds) {
            minX = Math.min(minX, childBounds.minX)
            minY = Math.min(minY, childBounds.minY)
            maxX = Math.max(maxX, childBounds.maxX)
            maxY = Math.max(maxY, childBounds.maxY)
            hasValidBounds = true
          }
        })

        if (hasValidBounds) {
          return { minX, minY, maxX, maxY }
        }
        return null
      }

      // For Images, use width() and height() directly as getClientRect can be unreliable
      if (node.getType() === 'Image') {
        const image = node as Konva.Image
        let width = image.width()
        let height = image.height()

        // Fallback: if width/height are 0, try to get from the image element itself
        if ((width === 0 || height === 0) && image.image()) {
          const imgElement = image.image() as HTMLImageElement
          if (imgElement) {
            if (width === 0) width = imgElement.naturalWidth || imgElement.width || 0
            if (height === 0) height = imgElement.naturalHeight || imgElement.height || 0
          }
        }

        if (width > 0 && height > 0) {
          // Account for offset if set
          const offsetX = image.offsetX() || 0
          const offsetY = image.offsetY() || 0

          return {
            minX: nodeX - offsetX,
            minY: nodeY - offsetY,
            maxX: nodeX - offsetX + width,
            maxY: nodeY - offsetY + height,
          }
        }
        return null
      }

      // For Lines, calculate bounds from points
      if (node.getType() === 'Line') {
        const line = node as Konva.Line
        const points = line.points()
        if (points.length >= 2) {
          let minX = Infinity
          let minY = Infinity
          let maxX = -Infinity
          let maxY = -Infinity

          for (let i = 0; i < points.length; i += 2) {
            const x = points[i] ?? 0
            const y = points[i + 1] ?? 0
            if (isFinite(x) && isFinite(y)) {
              minX = Math.min(minX, nodeX + x)
              minY = Math.min(minY, nodeY + y)
              maxX = Math.max(maxX, nodeX + x)
              maxY = Math.max(maxY, nodeY + y)
            }
          }

          if (
            isFinite(minX) &&
            isFinite(minY) &&
            isFinite(maxX) &&
            isFinite(maxY) &&
            maxX > minX &&
            maxY > minY
          ) {
            return { minX, minY, maxX, maxY }
          }
        }
        return null
      }

      // For other node types (Rect, Circle, Text, etc.), get their bounds
      const box = node.getClientRect({ skipTransform: true })

      if (box && isFinite(box.width) && isFinite(box.height) && box.width > 0 && box.height > 0) {
        return {
          minX: nodeX + box.x,
          minY: nodeY + box.y,
          maxX: nodeX + box.x + box.width,
          maxY: nodeY + box.y + box.height,
        }
      }

      return null
    },
    []
  )

  // Compute bounds for the current selection within this canvas, if any.
  // Uses Konva node names (endpoint-*, protection-*, panel-*, etc.) resolved via resolveKonvaElementId
  // so it naturally respects whatever elements this particular canvas renders.
  const getSelectionBounds = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const selection = viewportUI.getState().selection
    if (!selection.ids || selection.ids.length === 0) return null

    // When gridInTransformedLayer is true, the content layer is at index 0.
    // Otherwise, the background grid layer is at index 0 and content at index 1.
    const contentLayerIndex = gridInTransformedLayer ? 0 : 1
    const contentLayer = stage.children?.[contentLayerIndex]
    if (!contentLayer) return null

    // Walk all descendant nodes of the content layer and aggregate bounds
    const allNodes = (contentLayer as Konva.Container).find('*') as KonvaNodeCollectionLike

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let hasValidBounds = false

    const visitNode = (node: Konva.Node) => {
      const elementId = resolveKonvaElementId(node, stage)
      if (!elementId) return
      if (!selection.ids.includes(elementId)) return

      const bounds = getNodeBounds(node, 0, 0)
      if (!bounds) return

      minX = Math.min(minX, bounds.minX)
      minY = Math.min(minY, bounds.minY)
      maxX = Math.max(maxX, bounds.maxX)
      maxY = Math.max(maxY, bounds.maxY)
      hasValidBounds = true
    }

    if (Array.isArray(allNodes)) {
      allNodes.forEach((n: Konva.Node) => visitNode(n))
    } else if (allNodes && typeof allNodes.each === 'function') {
      allNodes.each((n: Konva.Node) => visitNode(n))
    }

    if (
      !hasValidBounds ||
      !isFinite(minX) ||
      !isFinite(minY) ||
      !isFinite(maxX) ||
      !isFinite(maxY)
    ) {
      return null
    }

    return { minX, minY, maxX, maxY }
  }, [gridInTransformedLayer, getNodeBounds, viewportUI, stageRef])

  // Handle fit to view — returns true when content bounds were found and applied.
  const handleFitToView = useCallback((options?: { ignoreSelection?: boolean }): boolean => {
    const stage = stageRef.current
    if (!stage) return false
    const liveRect = containerRef.current?.getBoundingClientRect()
    const viewportWidth = Math.max(1, Math.round(liveRect?.width ?? size.width))
    const viewportHeight = Math.max(1, Math.round(liveRect?.height ?? size.height))
    const viewportCenterX = viewportWidth / 2
    const viewportCenterY = viewportHeight / 2

    const contentLayerIndex = gridInTransformedLayer ? 0 : 1
    const contentLayer = stage.children?.[contentLayerIndex]
    if (!contentLayer) {
      emitViewTransformPatch({
        zoom: fin(1, safeZoom),
        pan: { x: fin(viewportCenterX, 0), y: fin(viewportCenterY, 0) },
      })
      return false
    }

    let boundsForFit: { minX: number; minY: number; maxX: number; maxY: number } | null = null
    const selection = viewportUI.getState().selection

    if (!options?.ignoreSelection && selection.ids && selection.ids.length > 0) {
      onPrepareFitToView?.()
      const cbBounds = onGetSelectionBounds?.()
      if (cbBounds) {
        boundsForFit = {
          minX: cbBounds.x,
          minY: cbBounds.y,
          maxX: cbBounds.x + cbBounds.width,
          maxY: cbBounds.y + cbBounds.height,
        }
      } else {
        boundsForFit = getSelectionBounds()
      }
    }

    if (!boundsForFit) {
      const children = contentLayer.getChildren()
      if (children.length === 0) {
        emitViewTransformPatch({
          zoom: fin(1, safeZoom),
          pan: { x: fin(viewportCenterX, 0), y: fin(viewportCenterY, 0) },
        })
        return false
      }

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let hasValidBounds = false

      children.forEach((child) => {
        if (child.getClassName() === 'Line' && !child.isListening()) return
        const bounds = getNodeBounds(child, 0, 0)
        if (bounds) {
          minX = Math.min(minX, bounds.minX)
          minY = Math.min(minY, bounds.minY)
          maxX = Math.max(maxX, bounds.maxX)
          maxY = Math.max(maxY, bounds.maxY)
          hasValidBounds = true
        }
      })

      if (!hasValidBounds) {
        emitViewTransformPatch({
          zoom: fin(1, safeZoom),
          pan: { x: fin(viewportCenterX, 0), y: fin(viewportCenterY, 0) },
        })
        return false
      }

      boundsForFit = { minX, minY, maxX, maxY }
    }

    const contentWidth = boundsForFit.maxX - boundsForFit.minX
    const contentHeight = boundsForFit.maxY - boundsForFit.minY

    // If no valid content, center at origin
    if (
      !isFinite(contentWidth) ||
      !isFinite(contentHeight) ||
      contentWidth === 0 ||
      contentHeight === 0
    ) {
      emitViewTransformPatch({
        zoom: fin(1, safeZoom),
        pan: { x: fin(viewportCenterX, 0), y: fin(viewportCenterY, 0) },
      })
      return false
    }

    const padding = Math.min(viewportWidth, viewportHeight) * 0.1

    const scaleX = (viewportWidth - padding * 2) / contentWidth
    const scaleY = (viewportHeight - padding * 2) / contentHeight
    const fitMaxZoom =
      selection.ids && selection.ids.length > 0 && selectionFitMaxZoom != null
        ? selectionFitMaxZoom
        : ZOOM_MAX
    const newScale = Math.min(scaleX, scaleY, fitMaxZoom)

    const clampedScale = Math.max(minZoomRef.current, newScale)

    const contentCenterX = boundsForFit.minX + contentWidth / 2
    const contentCenterY = boundsForFit.minY + contentHeight / 2

    const newPan = {
      x: viewportCenterX - contentCenterX * clampedScale,
      y: viewportCenterY - contentCenterY * clampedScale,
    }

    emitViewTransformPatch({
      zoom: Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(clampedScale, safeZoom))),
      pan: { x: fin(newPan.x, safePan.x), y: fin(newPan.y, safePan.y) },
    })
    return true
  }, [
    size,
    onPrepareFitToView,
    getNodeBounds,
    gridInTransformedLayer,
    fin,
    safePan,
    safeZoom,
    selectionFitMaxZoom,
    onGetSelectionBounds,
    getSelectionBounds,
    emitViewTransformPatch,
    viewportUI,
    stageRef,
    containerRef,
    minZoomRef,
  ])

  return { handleFitToView }
}
