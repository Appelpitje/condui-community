import { useProjectStore } from '@/stores/projectStore'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import type { Endpoint, Panel } from '@/types/schema'
import { buildControlLinkNoteMap } from './controlLink'
import { busDeviceAddressKey, busRowLabelKey, rowAddressKey } from './controlLinkNoteContext'

const cachedNoteMaps = new WeakMap<Panel[], Map<string, string>>()

function getRenderNoteMap(panels: Panel[]): ReadonlyMap<string, string> {
  const cached = Object.isFrozen(panels) ? cachedNoteMaps.get(panels) : undefined
  if (cached) return cached
  const notes = buildControlLinkNoteMap(panels)
  if (Object.isFrozen(panels)) cachedNoteMaps.set(panels, notes)
  return notes
}

/**
 * Resolved control-link note for an endpoint, or undefined when it has no valid link.
 * Renderers pass it to `getVisibleEndpointNoteText` so painted text matches the layout.
 */
export function useControlLinkNote(endpoint: Endpoint | undefined): string | undefined {
  return useProjectStore((state) => {
    const project = state.currentProject
    if (!endpoint?.controlLink || !project) return undefined
    return getRenderNoteMap(getProjectElectricalPanels(project)).get(endpoint.id)
  })
}

/** Same resolved bus identity used by the scoped layout map, cached once per project snapshot. */
export function useBusDeviceAddress(endpoint: Endpoint | undefined): string | undefined {
  return useProjectStore((state) => {
    if (!endpoint?.busDeviceProps?.deviceAddress?.trim() || !state.currentProject) return undefined
    return getRenderNoteMap(getProjectElectricalPanels(state.currentProject)).get(busDeviceAddressKey(endpoint.id))
  })
}

/** Wired Domotica output channel shown below the final symbol on its row. */
export function useDomoticaRowAddress(endpoint: Endpoint | undefined): string | undefined {
  return useProjectStore((state) => {
    if (!endpoint?.domoticaChildProps || !state.currentProject) return undefined
    const notes = getRenderNoteMap(getProjectElectricalPanels(state.currentProject))
    if (notes.has(busRowLabelKey(endpoint.id))) return undefined
    return notes.get(rowAddressKey(endpoint.id))
  })
}
