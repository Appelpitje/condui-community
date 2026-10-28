import type { TFunction } from 'i18next'
import React from 'react'
import SitplanVisibilityPanel from '@/components/plan/SitplanVisibilityPanel'
import CanvasFloatingControlRail from '@/components/canvas/CanvasFloatingControlRail'
import FloorSelectionDialog from '@/components/plan/FloorSelectionDialog'
import { FloatingControl } from '@/components/canvas/FloatingControls'
import { GridIcon, FloorIcon, VisibilityIcon } from '@/components/icons/UiIcons'
import { PlanGridSizeControl } from '@/components/canvas/plan/PlanGridSizeControl'

interface PlanCanvasViewRailOptions {
  openMenu: import('@/hooks/plan/usePlanCanvasToolState').PlanFloatingMenu
  t: TFunction
  applyOpenMenu: React.Dispatch<
    React.SetStateAction<import('@/hooks/plan/usePlanCanvasToolState').PlanFloatingMenu>
  >
  planView: import('@/types/ui').ViewState
  applyPlanView: (view: Partial<import('@/types/ui').ViewState>) => void
  canEditFloorPlan: boolean
  i18n: import('i18next').i18n
  activeFloorId: string | null
  isFloorPlanMode: boolean
  applyActiveFloor: (floorId: string | null) => void
  requestFitToView: (canvases: import('@/types/ui').CanvasType[]) => void
  activeTool: import('@/types/ui').PlanToolMode
}

export function renderPlanCanvasViewRail({
  openMenu,
  t,
  applyOpenMenu,
  planView,
  applyPlanView,
  canEditFloorPlan,
  i18n,
  activeFloorId,
  isFloorPlanMode,
  applyActiveFloor,
  requestFitToView,
  activeTool,
}: PlanCanvasViewRailOptions) {
  return (
    <CanvasFloatingControlRail
      side="right"
      verticalAlign="top"
      offsetPx={12}
      topOffsetPx={12}
      zIndex={30}
      menuOpen={openMenu !== null}
      dataCanvasOverlayAnchor="right"
      dataCanvasOverlayPosition="top-right"
    >
      <>
        {/* Grid menu (rounded square) */}
        <FloatingControl
          icon={<GridIcon className="w-6 h-6 text-gray-700 dark:text-gray-200" />}
          label={t('canvas.grid')}
          variant="menu"
          side="right"
          open={openMenu === 'grid'}
          onOpenChange={(next) => applyOpenMenu(next ? 'grid' : null)}
        >
          <div className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 min-w-[220px] space-y-3 text-xs">
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={planView.showGrid}
                  onChange={(e) => applyPlanView({ showGrid: e.target.checked })}
                  className="rounded border-gray-400"
                />
                <span>{t('canvas.grid')}</span>
              </label>
              {canEditFloorPlan && (
                <>
                  <label className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={planView.snapToGrid}
                      onChange={(e) => applyPlanView({ snapToGrid: e.target.checked })}
                      className="rounded border-gray-400"
                    />
                    <span>{t('canvas.snap')}</span>
                  </label>
                  <label className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={planView.snapToProjection ?? true}
                      onChange={(e) => applyPlanView({ snapToProjection: e.target.checked })}
                      className="rounded border-gray-400"
                    />
                    <span>{t('canvas.projectedSnap')}</span>
                  </label>
                </>
              )}
            </div>
            <div className="space-y-1">
              <PlanGridSizeControl
                gridSize={planView.gridSize}
                language={i18n.language}
                label={t('canvas.gridSize')}
                onGridSizeChange={(gridSize) => applyPlanView({ gridSize })}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
                <span>{t('canvas.gridOpacity')}</span>
                <span className="tabular-nums">
                  {Math.round((Math.min(planView.gridIntensity ?? 75, 75) / 75) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={planView.gridIntensity ?? 75}
                onChange={(e) => applyPlanView({ gridIntensity: Number(e.target.value) })}
                className="w-full h-1.5 rounded appearance-none bg-gray-300 dark:bg-gray-600"
              />
            </div>
          </div>
        </FloatingControl>

        {/* Floor selector (rounded square) */}
        <FloatingControl
          icon={<FloorIcon className="w-6 h-6 text-gray-700 dark:text-gray-200" />}
          label={t('floorSelection.selectFloor')}
          variant="menu"
          side="right"
          open={openMenu === 'floor'}
          onOpenChange={(next) => applyOpenMenu(next ? 'floor' : null)}
        >
          <div className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 min-w-[360px] max-w-[min(92vw,460px)] text-xs">
            <FloorSelectionDialog
              currentFloorId={activeFloorId}
              showReferenceOverlayToggles={isFloorPlanMode}
              allowFloorDuplication
              readOnly={!canEditFloorPlan}
              onSelect={(floorId, options) => {
                applyActiveFloor(floorId)
                if (options?.fitToView) {
                  requestAnimationFrame(() => {
                    requestFitToView(['plan'])
                  })
                }
                if (options?.closeMenu ?? true) {
                  applyOpenMenu(null)
                }
              }}
              onCancel={() => applyOpenMenu(null)}
            />
          </div>
        </FloatingControl>

        {/* Visibility (rounded square) */}
        <FloatingControl
          icon={<VisibilityIcon className="w-6 h-6 text-gray-700 dark:text-gray-200" />}
          label={t('sitplanVisibility.title')}
          variant="menu"
          side="right"
          mobileMenuFitCanvas
          open={openMenu === 'visibility'}
          onOpenChange={(next) => applyOpenMenu(next ? 'visibility' : null)}
        >
          <SitplanVisibilityPanel
            readOnly={!canEditFloorPlan}
            wireToolActive={activeTool === 'wiring'}
          />
        </FloatingControl>
      </>
    </CanvasFloatingControlRail>
  )
}
