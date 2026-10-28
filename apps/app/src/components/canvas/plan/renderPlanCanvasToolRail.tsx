import type { TFunction } from 'i18next'
import type { usePlanQuickPlacerController } from '@/hooks/plan/usePlanQuickPlacerController'
import React from 'react'
import RoomPlanScanControl from '@/components/plan/RoomPlanScanControl'
import { QuickPlacerToolIcon } from '@/components/plan/QuickPlacerToolIcon'
import CanvasFloatingControlRail from '@/components/canvas/CanvasFloatingControlRail'
import { FloatingControl } from '@/components/canvas/FloatingControls'
import {
  DrawModeIcon,
  UploadFloorIcon,
  MoveFloorIcon,
  ScaleIcon,
  WiringIcon,
} from '@/components/icons/UiIcons'

interface PlanCanvasToolRailOptions {
  canPlaceSymbols: boolean
  isFloorPlanMode: boolean
  awaitingPlanPlacementCount: number
  t: TFunction
  quickPlacerOpen: boolean
  quickPlacerDocked: boolean
  closeQuickPlacer: ReturnType<typeof usePlanQuickPlacerController>['closeQuickPlacer']
  openQuickPlacerAtFirstAwaiting: ReturnType<
    typeof usePlanQuickPlacerController
  >['openQuickPlacerAtFirstAwaiting']
  activeTool: import('@/types/ui').PlanToolMode
  applyActiveTool: (tool: import('@/types/ui').PlanToolMode) => void
  canEditFloorPlan: boolean
  applyFloorPlanModeAndClearSelection: (enabled: boolean) => void
  setPendingImportFile: React.Dispatch<React.SetStateAction<File | null>>
  applyIsImportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  hasPlanImage: boolean
  canResetPlanScale: boolean
  isResettingScale: boolean
  handleScaleRulerCancel: () => void
  handleResetScaleStart: () => void
}

export function renderPlanCanvasToolRail({
  canPlaceSymbols,
  isFloorPlanMode,
  awaitingPlanPlacementCount,
  t,
  quickPlacerOpen,
  quickPlacerDocked,
  closeQuickPlacer,
  openQuickPlacerAtFirstAwaiting,
  activeTool,
  applyActiveTool,
  canEditFloorPlan,
  applyFloorPlanModeAndClearSelection,
  setPendingImportFile,
  applyIsImportDialogOpen,
  hasPlanImage,
  canResetPlanScale,
  isResettingScale,
  handleScaleRulerCancel,
  handleResetScaleStart,
}: PlanCanvasToolRailOptions) {
  return (
    canPlaceSymbols &&
    !isFloorPlanMode && (
      <CanvasFloatingControlRail
        side="left"
        verticalAlign="center"
        topOverlayInsetPx={68}
        zIndex={30}
        dataCanvasOverlayAnchor="left"
      >
        <>
          <FloatingControl
            icon={<QuickPlacerToolIcon awaitingCount={awaitingPlanPlacementCount} />}
            label={t('quickPlacer.title')}
            tooltipDescription={
              awaitingPlanPlacementCount > 0
                ? t('quickPlacer.unplaced.count', { count: awaitingPlanPlacementCount })
                : undefined
            }
            variant="tool"
            side="left"
            active={quickPlacerOpen || quickPlacerDocked}
            primary={false}
            onClick={() => {
              if (quickPlacerOpen) {
                closeQuickPlacer()
              } else {
                openQuickPlacerAtFirstAwaiting()
              }
            }}
          />

          <FloatingControl
            icon={<WiringIcon className="w-6 h-6" />}
            label={t('planWiring.tool')}
            tooltipDescription={t('planWiring.toolDescription')}
            variant="tool"
            side="left"
            active={activeTool === 'wiring'}
            primary
            onClick={() => {
              applyActiveTool(activeTool === 'wiring' ? 'none' : 'wiring')
            }}
          />

          <RoomPlanScanControl enabled={canEditFloorPlan} />

          {/* Draw mode toggle */}
          <FloatingControl
            icon={<DrawModeIcon className="w-6 h-6" />}
            label={t('floorPlanTools.drawMode')}
            variant="tool"
            side="left"
            primary={false}
            triggerTestId="e2e-plan-enter-draw-mode"
            onClick={() => {
              applyFloorPlanModeAndClearSelection(true)
            }}
          />

          <>
            {/* Upload floorplan */}
            <FloatingControl
              icon={<UploadFloorIcon className="w-6 h-6" />}
              label={t('canvas.uploadFloorPlan')}
              variant="tool"
              side="left"
              triggerTestId="e2e-plan-upload-floor"
              onClick={() => {
                setPendingImportFile(null)
                applyIsImportDialogOpen(true)
              }}
            />

            {/* Move floor (plan image) */}
            <FloatingControl
              icon={<MoveFloorIcon className="w-6 h-6" />}
              label={t('planTools.movePlanImage')}
              tooltipDescription={hasPlanImage ? undefined : t('planTools.uploadFloorPlanFirst')}
              variant="tool"
              side="left"
              active={hasPlanImage && activeTool === 'move'}
              disabled={!hasPlanImage}
              onClick={() => {
                if (!hasPlanImage) return
                applyActiveTool(activeTool === 'move' ? 'none' : 'move')
              }}
            />

            {/* Change scale */}
            <FloatingControl
              icon={<ScaleIcon className="w-6 h-6" />}
              label={t('planTools.resetScale')}
              tooltipDescription={
                canResetPlanScale
                  ? t('planTools.resetScaleTooltip')
                  : t('planTools.uploadFloorPlanFirst')
              }
              variant="tool"
              side="left"
              active={canResetPlanScale && activeTool === 'resetScale'}
              disabled={!canResetPlanScale}
              onClick={() => {
                if (!canResetPlanScale) return
                if (activeTool === 'resetScale') {
                  if (isResettingScale) {
                    handleScaleRulerCancel()
                  } else {
                    applyActiveTool('none')
                  }
                } else {
                  handleResetScaleStart()
                }
              }}
            />
          </>
        </>
      </CanvasFloatingControlRail>
    )
  )
}
