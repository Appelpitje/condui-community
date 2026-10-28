import type Konva from 'konva'
import type { useDialog } from '@/hooks/useDialog'
import React, { useCallback, useEffect } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'

import {
  normalizePlanImageRotationDeg,
  planImageLocalToScenePoint,
} from '@/lib/plan/planImageRotation'

interface PlanImageInteractionsOptions {
  activeTool: import('@/types/ui').PlanToolMode
  planImageRef: Konva.Image | null
  transformerRef: Konva.Transformer | null
  activeFloorId: string | null
  planImagePosition: import('@/types/schema').Point2
  planImageRotationDeg: number
  clearSelection: () => void
  applySelectedPlanImageId: React.Dispatch<React.SetStateAction<string | null>>
  getFloorById: (id: string) => import('@/types/schema').Floor | undefined
  dialog: Pick<ReturnType<typeof useDialog>, 'confirm'>
  t: import('i18next').TFunction<'translation', undefined>
  applyActiveTool: (tool: import('@/types/ui').PlanToolMode) => void
}

export function usePlanImageInteractions({
  activeTool,
  planImageRef,
  transformerRef,
  activeFloorId,
  planImagePosition,
  planImageRotationDeg,
  clearSelection,
  applySelectedPlanImageId,
  getFloorById,
  dialog,
  t,
  applyActiveTool,
}: PlanImageInteractionsOptions) {
  useEffect(
    function () {
      if (activeTool === 'move' && planImageRef && transformerRef) {
        transformerRef.nodes([planImageRef])
        transformerRef.getLayer()?.batchDraw()
      } else if (activeTool !== 'move' && transformerRef) {
        transformerRef.nodes([])
        transformerRef.getLayer()?.batchDraw()
      }
    },
    [activeTool, planImageRef, transformerRef]
  )

  const handlePlanImageTransformEnd = useCallback(
    (event: KonvaEventObject<Event>) => {
      const node = event.target
      if (!activeFloorId) return
      const origin = planImageLocalToScenePoint(
        { x: node.x(), y: node.y() },
        planImagePosition,
        planImageRotationDeg
      )
      const rotationDeg = normalizePlanImageRotationDeg(planImageRotationDeg + node.rotation())
      node.position({ x: 0, y: 0 })
      node.rotation(0)
      node.scale({ x: 1, y: 1 })
      runProjectCommand('plan.transformBackground', {
        floorId: activeFloorId,
        offset: origin,
        rotationDeg,
      })
      useProjectStore.getState().setPlanCanvasPlanImageOffset(activeFloorId, origin)
    },
    [activeFloorId, planImagePosition, planImageRotationDeg]
  )

  const handlePlanImageClick = useCallback(
    function () {
      clearSelection()
      if (activeTool === 'move') {
        applySelectedPlanImageId(activeFloorId || null)
      } else {
        applySelectedPlanImageId(null)
      }
    },
    [activeTool, activeFloorId, applySelectedPlanImageId, clearSelection]
  )

  const handleDeleteSelectedPlanImage = useCallback(
    function () {
      if (!activeFloorId) return
      const floorId = activeFloorId
      const floor = getFloorById(floorId)
      const hasImage = !!(floor?.planAsset || floor?.planImportAsset)
      if (!hasImage) return
      dialog.confirm({
        title: t('contextMenu.deletePlanImageConfirmTitle'),
        message: t('contextMenu.deletePlanImageConfirmMessage', { floor: floor?.name ?? '' }),
        variant: 'danger',
        confirmLabel: t('contextMenu.deletePlanImage'),
        onConfirm: () => {
          if (!runProjectCommand('plan.detachBackground', { floorId })) return
          applySelectedPlanImageId(null)
          // Deleting the image disables the move-tool button, so leave move mode here instead
          // of stranding its adjacent-floor ghost overlay on the canvas.
          applyActiveTool('none')
        },
      })
    },
    [activeFloorId, applyActiveTool, applySelectedPlanImageId, dialog, getFloorById, t]
  )

  return { handlePlanImageTransformEnd, handlePlanImageClick, handleDeleteSelectedPlanImage }
}
