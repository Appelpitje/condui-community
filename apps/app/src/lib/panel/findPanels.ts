import type { Panel, Placement } from '@/types/schema'
import { getAllEndpoints } from '@/lib/eendraad/projectElectricalDomain'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getPanelDisplayName } from '@/utils/panelNames'

export interface PanelSearchResult {
  id: string
  name: string
  path: string
  placements: Placement[]
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()

export function findPanels(
  project: ProjectWithOptionalV2Electrical & { project?: { locale?: string } },
  query: string
): PanelSearchResult[] {
  const roots = getProjectElectricalPanels(project)
  const endpoints = roots.flatMap(getAllEndpoints)
  const placementsByPanelId = new Map<string, Placement[]>()
  const legacyPlacementsByName = new Map<string, Placement[]>()
  for (const endpoint of endpoints) {
    if (endpoint.symbol !== 'panel_distribution' || !endpoint.placements?.length) continue
    const index = endpoint.panelId ? placementsByPanelId : legacyPlacementsByName
    const key = endpoint.panelId ?? endpoint.label
    if (key) index.set(key, [...(index.get(key) ?? []), ...endpoint.placements])
  }
  const panelsById = new Map<string, Panel>()
  const nameCounts = new Map<string, number>()
  const words = normalize(query).split(/\s+/).filter(Boolean)
  const results: PanelSearchResult[] = []
  const visit = (panels: Panel[], parents: string[]) => {
    for (const panel of panels) {
      panelsById.set(panel.id, panel)
      nameCounts.set(panel.name, (nameCounts.get(panel.name) ?? 0) + 1)
      const name = getPanelDisplayName(panel, project)
      const path = parents.join(' / ')
      const haystack = normalize(`${name} ${panel.name} ${path}`)
      const tokens = haystack.split(/[^\p{L}\p{N}]+/u)
      if (
        words.every((word) =>
          word.length === 1 && words.length > 1 ? tokens.includes(word) : haystack.includes(word)
        )
      ) {
        results.push({ id: panel.id, name, path, placements: [] })
      }
      visit(panel.subPanels ?? [], [...parents, name])
    }
  }
  visit(roots, [])
  for (const result of results) {
    const panel = panelsById.get(result.id)!
    const seen = new Set<string>()
    result.placements = [
      ...(placementsByPanelId.get(panel.id) ?? []),
      ...(nameCounts.get(panel.name) === 1 ? (legacyPlacementsByName.get(panel.name) ?? []) : []),
    ].filter((placement) => {
      if (seen.has(placement.id)) return false
      seen.add(placement.id)
      return true
    })
  }
  return results
}
