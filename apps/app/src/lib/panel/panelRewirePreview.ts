import type { Panel, PanelGridModuleRef } from '@/types/schema'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { panelGridModuleRefKey } from './panelGridLayout'
import { getPanelRewireOperation, type PanelRewireOperation } from './panelRewire'

/** A query belongs to one project revision and drag origin, never the committed edit. */
export function createPanelRewirePreviewQuery(
  project: ProjectWithOptionalV2Electrical | null,
  origin: PanelGridModuleRef | null
) {
  const results = new Map<Panel, Map<string, PanelRewireOperation | null>>()
  return (panel: Panel | null, target: PanelGridModuleRef | null): PanelRewireOperation | null => {
    if (!panel || !project || !origin) return null
    let targets = results.get(panel)
    if (!targets) results.set(panel, (targets = new Map()))
    const key = target ? panelGridModuleRefKey(target) : 'frame'
    if (!targets.has(key)) targets.set(key, getPanelRewireOperation(panel, project, origin, target))
    return targets.get(key)!
  }
}
