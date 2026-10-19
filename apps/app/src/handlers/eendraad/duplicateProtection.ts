import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { useUIStore } from '@/stores/uiStore'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'

export function duplicateProtection(options: {
  protectionId: string
  copyCircuitContents?: boolean
  mainBusPlacement?: { panelId: string; mainBusInsertIndex: number }
  gridPlacement?: { panelId: string; row: number; col: number }
  dropTarget?: DropTarget
  label?: string
}): string | null {
  const ui = useUIStore.getState()
  const sitplanTarget = {
    activeFloorId: ui.activeFloorId,
    viewportCenter: ui.activeFloorId
      ? getViewportCenterPlanSpaceIfApplicable(
          ui.viewportLayout,
          ui.planCanvasViewportPx,
          ui.activeFloorId,
          ui.activeFloorId,
          ui.planView
        )
      : null,
  }
  const outcome = runProjectCommand(
    'electrical.duplicateProtection',
    {
      protectionId: options.protectionId,
      copyCircuitContents: options.copyCircuitContents,
      mainBusPlacement: options.mainBusPlacement,
      gridPlacement: options.gridPlacement,
      dropTarget: options.dropTarget,
      sitplanTarget,
    },
    { label: options.label ?? 'duplicate circuit' }
  )
  return outcome?.results[0]?.select?.find((ref) => ref.kind === 'protection')?.id ?? null
}
