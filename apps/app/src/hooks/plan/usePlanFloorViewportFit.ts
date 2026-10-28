import type { usePlanCanvasWiringModel } from '@/hooks/plan/usePlanCanvasWiringModel'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import {
  ContentBounds,
  includePointInBounds,
  includeRectInBounds,
} from '@/components/canvas/plan/planCanvasBindings'
import React, { useRef, useEffect } from 'react'
import type { Note } from '@/types/schema'
import { getStairBounds } from '@/components/canvas/plan'
import { getPlacementWorldBounds } from '@/utils/plan/placementBounds'
import { getPlanImageSceneBounds } from '@/lib/plan/planImageRotation'

interface PlanFloorViewportFitOptions {
  activeFloorId: string | null
  activeFloor: import('@/types/schema').Floor | null | undefined
  planCanvasViewportPx: { width: number; height: number } | null
  containerRef: React.RefObject<HTMLDivElement | null>
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  planVisibility: import('@/types/ui').PlanVisibilityState
  planImage: HTMLImageElement | null
  planImagePosition: import('@/types/schema').Point2
  planImageDisplayWidth: number
  planImageDisplayHeight: number
  planImageRotationDeg: number
  baseWalls: ReturnType<typeof usePlanCanvasGeometry>['baseWalls']
  stairsForRender: ReturnType<typeof usePlanCanvasGeometry>['stairsForRender']
  visiblePlacements: ReturnType<typeof usePlanCanvasWiringModel>['visiblePlacements']
  baseSymbolSizePx: ReturnType<typeof usePlanCanvasGeometry>['baseSymbolSizePx']
  getEndpointById: (id: string) => import('@/types/schema').Endpoint | undefined
  sitplanNotes: import('@/types/schema').Note[]
  requestFitToView: (canvases: import('@/types/ui').CanvasType[]) => void
  currentProject: import('@/types/projectV2').ProjectV2 | null
}

export function usePlanFloorViewportFit({
  activeFloorId,
  activeFloor,
  planCanvasViewportPx,
  containerRef,
  viewportUI,
  planVisibility,
  planImage,
  planImagePosition,
  planImageDisplayWidth,
  planImageDisplayHeight,
  planImageRotationDeg,
  baseWalls,
  stairsForRender,
  visiblePlacements,
  baseSymbolSizePx,
  getEndpointById,
  sitplanNotes,
  requestFitToView,
  currentProject,
}: PlanFloorViewportFitOptions) {
  const pendingFloorViewportAutoFitRef = useRef<string | null>(null)

  // On floor switch, keep current zoom/pan only if the new floor still has visible content in view.
  // If the viewport lands on "empty space" for that floor, auto-fit once to reorient the user.
  useEffect(
    function () {
      pendingFloorViewportAutoFitRef.current = activeFloorId
    },
    [activeFloorId]
  )

  useEffect(
    function () {
      const pendingFloorId = pendingFloorViewportAutoFitRef.current
      if (!activeFloorId || pendingFloorId !== activeFloorId || !activeFloor) return

      const viewportWidth = planCanvasViewportPx?.width ?? containerRef.current?.clientWidth ?? 0
      const viewportHeight = planCanvasViewportPx?.height ?? containerRef.current?.clientHeight ?? 0
      const { planView: currentPlanView } = viewportUI.getState()
      if (
        viewportWidth <= 0 ||
        viewportHeight <= 0 ||
        !Number.isFinite(currentPlanView.zoom) ||
        currentPlanView.zoom <= 0
      )
        return

      if (planVisibility.groundPlansVisible) {
        const hasImageAsset = !!(activeFloor.planAsset || activeFloor.planImportAsset)
        if (hasImageAsset && !planImage) return
      }

      let contentBounds: ContentBounds | null = null

      if (planVisibility.groundPlansVisible && planImage) {
        contentBounds = includeRectInBounds(
          contentBounds,
          getPlanImageSceneBounds(
            planImagePosition,
            planImageDisplayWidth,
            planImageDisplayHeight,
            planImageRotationDeg
          )
        )
      }

      for (const wall of baseWalls) {
        for (const p of wall.points) {
          contentBounds = includePointInBounds(contentBounds, p.x, p.y)
        }
      }

      for (const stair of stairsForRender) {
        const bounds = getStairBounds(stair)
        if (!bounds) continue
        contentBounds = includeRectInBounds(contentBounds, {
          left: bounds.x,
          top: bounds.y,
          right: bounds.x + bounds.width,
          bottom: bounds.y + bounds.height,
        })
      }

      for (const placement of visiblePlacements) {
        if (placement.isEarthing) {
          const b = getPlacementWorldBounds(
            placement.pos,
            placement.rotationDeg,
            placement.scale,
            1,
            'earthing',
            baseSymbolSizePx
          )
          contentBounds = includeRectInBounds(contentBounds, b)
          continue
        }
        if (placement.junctionPanelLabel != null) {
          const b = getPlacementWorldBounds(
            placement.pos,
            placement.rotationDeg,
            placement.scale,
            1,
            'junction_panel',
            baseSymbolSizePx
          )
          contentBounds = includeRectInBounds(contentBounds, b)
          continue
        }
        const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : undefined
        if (!endpoint) continue
        const socketCount =
          (endpoint.type === 'socket' ? endpoint.socketProps?.socketCount : undefined) || 1
        const b = getPlacementWorldBounds(
          placement.pos,
          placement.rotationDeg,
          placement.scale,
          socketCount,
          endpoint.symbol,
          baseSymbolSizePx
        )
        contentBounds = includeRectInBounds(contentBounds, b)
      }

      const floorNotes = sitplanNotes.filter((note: Note) => note.floorId === activeFloorId)
      for (const note of floorNotes) {
        contentBounds = includePointInBounds(contentBounds, note.pos.x, note.pos.y)
      }

      if (!contentBounds) {
        pendingFloorViewportAutoFitRef.current = null
        return
      }

      const viewLeft = Math.min(
        -currentPlanView.pan.x / currentPlanView.zoom,
        (viewportWidth - currentPlanView.pan.x) / currentPlanView.zoom
      )
      const viewRight = Math.max(
        -currentPlanView.pan.x / currentPlanView.zoom,
        (viewportWidth - currentPlanView.pan.x) / currentPlanView.zoom
      )
      const viewTop = Math.min(
        -currentPlanView.pan.y / currentPlanView.zoom,
        (viewportHeight - currentPlanView.pan.y) / currentPlanView.zoom
      )
      const viewBottom = Math.max(
        -currentPlanView.pan.y / currentPlanView.zoom,
        (viewportHeight - currentPlanView.pan.y) / currentPlanView.zoom
      )

      const overlapWidth = Math.max(
        0,
        Math.min(contentBounds.maxX, viewRight) - Math.max(contentBounds.minX, viewLeft)
      )
      const overlapHeight = Math.max(
        0,
        Math.min(contentBounds.maxY, viewBottom) - Math.max(contentBounds.minY, viewTop)
      )
      const overlapScreenArea =
        overlapWidth * overlapHeight * currentPlanView.zoom * currentPlanView.zoom
      const hasVisibleReference = overlapScreenArea > 64

      pendingFloorViewportAutoFitRef.current = null
      if (!hasVisibleReference) {
        requestAnimationFrame(() => requestFitToView(['plan']))
      }
    },
    [
      activeFloorId,
      activeFloor,
      baseWalls,
      stairsForRender,
      visiblePlacements,
      currentProject,
      planVisibility.groundPlansVisible,
      planImage,
      planImageDisplayWidth,
      planImageDisplayHeight,
      planImagePosition,
      planImageRotationDeg,
      planCanvasViewportPx,
      sitplanNotes,
      baseSymbolSizePx,
      getEndpointById,
      requestFitToView,
      viewportUI,
      containerRef,
    ]
  )
}
