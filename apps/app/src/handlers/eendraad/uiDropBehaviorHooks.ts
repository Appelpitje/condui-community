import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import type { DropBehaviorEditorHooks } from '@/lib/eendraad/dropBehaviors'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { ensureEarthingSitplanPlacement } from '@/lib/plan/ensureEarthingSitplanPlacement'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'

/**
 * The editor-side parts of the drop engine: the active floor and visible plan centre, live
 * store follow-ups and analytics. Spread into every editor `DropBehaviorCallbacks`; project
 * commands supply their own explicit inputs instead.
 */
export function createUiDropBehaviorHooks(): DropBehaviorEditorHooks {
  return {
    getSitplanTarget: () => {
      const ui = useUIStore.getState()
      return {
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
        activePanelId: ui.activePanelId,
      }
    },
    ensureEarthingSitplanPlacement: (floorId, pos) => {
      ensureEarthingSitplanPlacement(floorId, pos)
    },
    ensureSecondaryPanelEarthingStem: (panelId) =>
      useProjectStore.getState().ensureSecondaryPanelEarthingStem(panelId),
    onSymbolPlaced: trackSymbolPlace,
    onNotePlaced: () =>
      trackGoogleAnalyticsEvent('note_place', { canvas: 'eendraad', source: 'symbol_drop' }),
  }
}
