import { ZOOM_MIN } from '@/constants/canvasConstants'
import { COMPACT_PANEL_THRESHOLD } from '@/lib/layout/compactPanelPacking'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

/** Large diagrams must fit inside split panes as well as full-screen canvases. */
export function getPanelCanvasZoomMinimum(project: ProjectWithOptionalV2Electrical | null): number {
  if (!project) return ZOOM_MIN
  let remaining = COMPACT_PANEL_THRESHOLD
  const count = (panels: ReturnType<typeof getProjectElectricalPanels>): boolean => {
    for (const panel of panels) {
      if (--remaining <= 0 || count(panel.subPanels ?? [])) return true
    }
    return false
  }
  return count(getProjectElectricalPanels(project)) ? ZOOM_MIN / 10 : ZOOM_MIN
}
