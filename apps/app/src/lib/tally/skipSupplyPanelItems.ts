import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Panel } from '@/types/schema'
import type { TallyData, TallyDetail } from './buildHardwareTally'

/** Physical supply-panel membership; independent of the tally's yellow supply-wire marking. */
export function skipSupplyPanelItems(
  data: TallyData,
  project: ProjectWithOptionalV2Electrical
): TallyData {
  const excluded = new Set<string>()
  const collectSlots = (panels: Panel[]) => {
    for (const panel of panels) {
      for (const { module } of panel.gridView?.supplyPanelSlots ?? []) {
        // Supply trunks have a canonical physical mounting which takes precedence over old slots.
        if (module.kind === 'trunkDevice' && module.scope === 'supply') continue
        excluded.add(
          module.kind === 'domotica'
            ? `endpoint:${module.endpointId}`
            : `${module.kind}:${module.id}`
        )
      }
      collectSlots(panel.subPanels ?? [])
    }
  }
  collectSlots(getProjectElectricalPanels(project))
  for (const device of queryAllSupplyTrunkDevices(project)) {
    if (resolveSupplyDeviceMounting(project, device.id)?.kind === 'grid') {
      excluded.add(`trunkDevice:${device.id}`)
    }
  }
  if (excluded.size === 0) return data
  const isExcluded = (detail: TallyDetail) => {
    const selection = detail.selection
    return selection && selection.ids.some((id) => excluded.has(`${selection.type}:${id}`))
  }
  return data.flatMap((category) => {
    if (category.lengthsOnly) return [category]
    const groups = category.groups.flatMap((group) => {
      const details = group.details.filter((detail) => !isExcluded(detail))
      const removed = group.details.length - details.length
      if (removed === 0) return [group]
      const count = group.count - removed
      return count > 0 ? [{ ...group, count, details }] : []
    })
    if (groups.length === 0) return []
    return [
      {
        ...category,
        groups,
        typeCount: groups.length,
        totalDevices: groups.reduce((total, group) => total + group.count, 0),
      },
    ]
  })
}
