import { lazy, memo, Suspense, useCallback } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { EendraadCanvas, PlanCanvas, PanelCanvas } from '@/components/canvas'
import { CanvasSwitcher } from './CanvasSwitcher'
import { MeasuredCanvasViewport } from '@/components/layout/MeasuredCanvasViewport'
import { useViewportWindowApi } from './ViewportWindowStore'
import type { CanvasType } from '@/types/ui'
import type { EditorCapabilities } from '@/lib/viewerMode'
/* @project-documents-strip-start */
import { isProjectDocumentsEnabled } from '@/lib/documents/availability'
/* @project-documents-strip-end */
const StructuralCanvas =
  
      null

const DocumentsCanvas =
  /* @project-documents-strip-start */
  isProjectDocumentsEnabled()
    ? lazy(() => import('@/components/documents/DocumentsCanvas'))
    : /* @project-documents-strip-end */
      null

type MultiFingerSwipeHandler = (
  direction: 'left' | 'right' | 'up' | 'down',
  fingerCount: number,
  startClientX: number
) => void

function CanvasForType({
  type,
  onMultiFingerSwipe,
  capabilities,
}: {
  type: CanvasType
  onMultiFingerSwipe?: MultiFingerSwipeHandler
  capabilities?: EditorCapabilities
}) {
  switch (type) {
    case 'eendraad':
      return <EendraadCanvas onMultiFingerSwipe={onMultiFingerSwipe} capabilities={capabilities} />
    case 'plan':
      return <PlanCanvas onMultiFingerSwipe={onMultiFingerSwipe} capabilities={capabilities} />
    case 'panel':
      return <PanelCanvas onMultiFingerSwipe={onMultiFingerSwipe} capabilities={capabilities} />
    case 'structure':
      return StructuralCanvas ? (
        <Suspense fallback={null}>
          <StructuralCanvas onMultiFingerSwipe={onMultiFingerSwipe} />
        </Suspense>
      ) : null
    case 'documents':
      return DocumentsCanvas ? (
        <Suspense fallback={null}>
          <DocumentsCanvas canEditProject={capabilities?.canEditProject ?? true} />
        </Suspense>
      ) : null
  }
}

const ViewportCanvasSurface = memo(function ViewportCanvasSurface({
  panelIndex,
  type,
  capabilities,
  onCompactAuxPanelVisibilityChange,
}: {
  panelIndex: number
  type: CanvasType
  capabilities?: EditorCapabilities
  onCompactAuxPanelVisibilityChange?: (visible: boolean) => void
}) {
  const windowUI = useViewportWindowApi()
  const onMultiFingerSwipe = useCallback<MultiFingerSwipeHandler>(
    (direction, fingerCount, startClientX) => {
      if (fingerCount !== 3) return

      if (direction === 'up' || direction === 'down') {
        if (onCompactAuxPanelVisibilityChange) {
          onCompactAuxPanelVisibilityChange(direction === 'up')
          return
        }
        windowUI.getState().toggleViewportPanelFocus(panelIndex)
        return
      }

      const { panels, leftDockCollapsed, setLeftDockCollapsed, togglePanel } = useUIStore.getState()
      const leftHalf = startClientX < window.innerWidth / 2
      if (leftHalf) {
        if (direction === 'left' && !leftDockCollapsed) setLeftDockCollapsed(true)
        if (direction === 'right' && leftDockCollapsed) setLeftDockCollapsed(false)
        return
      }

      if (direction === 'right' && panels.properties.visible) togglePanel('properties')
      if (direction === 'left' && !panels.properties.visible) togglePanel('properties')
    },
    [onCompactAuxPanelVisibilityChange, panelIndex, windowUI]
  )

  return (
    <MeasuredCanvasViewport>
      <CanvasForType
        type={type}
        onMultiFingerSwipe={onMultiFingerSwipe}
        capabilities={capabilities}
      />
    </MeasuredCanvasViewport>
  )
})

export function ViewportPanel({
  panelIndex,
  type,
  capabilities,
  compact = false,
  compactOrientation = 'portrait',
  onCompactAuxPanelVisibilityChange,
}: {
  panelIndex: number
  type: CanvasType
  capabilities?: EditorCapabilities
  compact?: boolean
  compactOrientation?: 'portrait' | 'landscape'
  onCompactAuxPanelVisibilityChange?: (visible: boolean) => void
}) {
  const setLastInteractedCanvas = useUIStore((s) => s.setLastInteractedCanvas)
  return (
    <div
      className="relative h-full w-full"
      data-viewport-panel={panelIndex}
      data-viewport-canvas={type}
    >
      <div className="absolute left-3 top-3 z-[60] pointer-events-auto">
        <CanvasSwitcher
          panelIndex={panelIndex}
          currentCanvas={type}
          compact={compact}
          compactOrientation={compactOrientation}
        />
      </div>
      <div
        className="relative h-full w-full"
        data-canvas-surface={type}
        onPointerDownCapture={() => setLastInteractedCanvas(type)}
        onFocusCapture={() => setLastInteractedCanvas(type)}
        onWheelCapture={() => setLastInteractedCanvas(type)}
      >
        <ViewportCanvasSurface
          panelIndex={panelIndex}
          type={type}
          capabilities={capabilities}
          onCompactAuxPanelVisibilityChange={onCompactAuxPanelVisibilityChange}
        />
      </div>
    </div>
  )
}
