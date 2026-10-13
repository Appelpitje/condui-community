import type { Panel, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

export function getCircuitIdFromModuleRef(
  ref: PanelGridModuleRef,
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null
): string | null {
  if (!project) return null
  if (ref.kind === 'protection') {
    const find = (owner: Panel): ProtectionDevice | undefined =>
      owner.protections.find((protection) => protection.id === ref.id) ??
      owner.subPanels.map(find).find(Boolean)
    return find(panel)?.circuits?.[0]?.id ?? null
  }
  if (ref.kind === 'trunkDevice' && ref.scope === 'circuit' && ref.circuitId) return ref.circuitId
  if (ref.kind === 'domotica') return ref.circuitId
  return null
}
