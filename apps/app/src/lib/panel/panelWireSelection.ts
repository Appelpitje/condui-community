import type { ModulePlacement } from '@/lib/panel/panelGridLayout'
import type { PanelGridModuleRef } from '@/types/schema'
import type { Selection } from '@/types/ui'

export interface PanelWireSelectionFocus {
  ref: PanelGridModuleRef
  side: 'incoming' | 'outgoing'
  peerRef?: PanelGridModuleRef
}

function findPlacedRef(
  placements: ModulePlacement[],
  elementId: string
): PanelGridModuleRef | null {
  for (const placement of placements) {
    const refs = [placement.ref, ...(placement.terminalStripMemberRefs ?? [])]
    const match = refs.find((ref) =>
      ref.kind === 'domotica' ? ref.endpointId === elementId : ref.id === elementId
    )
    if (match) return match
  }
  return null
}

/** Resolve a selected one-wire span to its exact connection between placed panel devices. */
export function resolvePanelWireSelectionFocus(
  selection: Selection,
  placements: ModulePlacement[]
): PanelWireSelectionFocus | null {
  if (selection.type !== 'wire' || selection.ids.length !== 1) return null
  const metadata =
    selection.wireMetadata?.find((item) => item.id === selection.ids[0]) ??
    selection.wireMetadata?.[0]
  if (!metadata) return null

  const fromRef = metadata.fromElementId ? findPlacedRef(placements, metadata.fromElementId) : null
  const toRef = metadata.toElementId ? findPlacedRef(placements, metadata.toElementId) : null
  const candidates: Array<{
    ref: PanelGridModuleRef | null
    peerRef: PanelGridModuleRef | null
    side: 'incoming' | 'outgoing'
  }> = [
    { ref: toRef, peerRef: fromRef, side: 'incoming' },
    { ref: fromRef, peerRef: toRef, side: 'outgoing' },
  ]
  for (const candidate of candidates) {
    if (!candidate.ref) continue
    return {
      ref: candidate.ref,
      side: candidate.side,
      ...(candidate.peerRef ? { peerRef: candidate.peerRef } : {}),
    }
  }
  return null
}
