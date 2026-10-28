import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { selectProjectElectricalPanels, type ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { getElectricalLookupIndex } from '@/lib/projectV2/electricalLookupIndex'
import type { Selection } from '@/types/ui'

/** Anchor a board's date editor to the distribution symbol actually drawn for it. */
export function resolveInstallDateAnchorSelection(
  project: ProjectWithOptionalV2Electrical | null,
  layout: Pick<BottomUpLayoutResult, 'panels'> | null,
  targets: readonly { type: string; id: string }[],
  selection: Selection
): Selection {
  if (!project || !layout || targets.length !== 1 || targets[0]?.type !== 'panel') return selection
  const target = targets[0]
  const endpoints = getElectricalLookupIndex(selectProjectElectricalPanels(project)).endpointsById
  for (const panelLayout of layout.panels) {
    for (const element of panelLayout.elements) {
      if (element.type !== 'endpoint' || !element.endpointId) continue
      const endpoint = endpoints.get(element.endpointId)?.endpoint
      if (endpoint?.symbol === 'panel_distribution' && endpoint.panelId === target.id) {
        return { type: 'endpoint', ids: [endpoint.id] }
      }
    }
  }
  return selection
}
