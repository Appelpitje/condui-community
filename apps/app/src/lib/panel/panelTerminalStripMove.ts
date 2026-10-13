import type { ProjectV2 } from '@/types/projectV2'
import type { PanelGridSlot } from '@/types/schema'
import { findPanelById } from './panelTree'
import {
  findTerminalStripEntity,
  getAllCircuits,
  isTerminalStripDevice,
  isTerminalStripEndpoint,
  panelGridModuleRefKey,
  setTerminalStripPanelId,
} from '@/lib/eendraad/projectElectricalDomain'
import {
  getEditableProjectElectricalPanels,
  editProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { getTerminalStripId } from '@/lib/terminalStrip/labels'
import { DEFAULT_PANEL_GRID_ROWS, DEFAULT_PANEL_GRID_COLUMNS } from './panelGridDefaults'
import { arePanelGridSlotArraysEqual } from './panelSupplySlots'

export function moveTerminalStripToPanelInProject(
  project: ProjectV2,
  deviceId: string,
  panelId: string,
  slot: PanelGridSlot,
  enclosureId?: string
): boolean {
  const targetPanel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  const device = findTerminalStripEntity(project, deviceId)
  const enclosures = editProjectAuxiliaryElectricalEnclosures(project)
  const targetEnclosure = enclosureId
    ? enclosures.find((entry) => entry.id === enclosureId)
    : undefined
  if ((!targetPanel && !targetEnclosure) || (enclosureId && !targetEnclosure) || !device)
    return false
  const targetSlots = targetEnclosure?.gridView.slots ?? targetPanel?.gridView?.slots ?? []
  const currentSlot = targetSlots.find(
    (candidate) => panelGridModuleRefKey(candidate.module) === panelGridModuleRefKey(slot.module)
  )
  const mounting = 'panelMounting' in device ? device.panelMounting : undefined
  const sameMounting = enclosureId
    ? mounting?.kind === 'auxiliary' && mounting.enclosureId === enclosureId
    : device.terminalStripPanelId === panelId && !mounting
  if (currentSlot && sameMounting && arePanelGridSlotArraysEqual([currentSlot], [slot]))
    return false

  const identity = (getTerminalStripId(device) || device.id).trim().toUpperCase()
  const panels = getEditableProjectElectricalPanels(project)
  const isMatchingTerminalRef = (module: PanelGridSlot['module']): boolean => {
    const candidateId =
      module.kind === 'domotica'
        ? module.endpointId
        : module.kind === 'trunkDevice' && module.scope === 'circuit'
          ? module.id
          : undefined
    if (!candidateId) return false
    const candidate = findTerminalStripEntity(project, candidateId)
    return (
      candidate != null &&
      (getTerminalStripId(candidate) || candidate.id).trim().toUpperCase() === identity
    )
  }

  setTerminalStripPanelId(project, deviceId, panelId, enclosureId)
  const matchingKeys = new Set<string>()
  for (const ownerPanel of panels) {
    for (const circuit of getAllCircuits(ownerPanel)) {
      for (const candidate of circuit.trunkDevices ?? []) {
        if (!isTerminalStripDevice(candidate)) continue
        if ((getTerminalStripId(candidate) || candidate.id).trim().toUpperCase() !== identity) {
          continue
        }
        matchingKeys.add(`trunkDevice:${candidate.id}:circuit${circuit.id}`)
      }
      for (const candidate of circuit.endpoints) {
        if (!isTerminalStripEndpoint(candidate)) continue
        if ((getTerminalStripId(candidate) || candidate.id).trim().toUpperCase() !== identity) {
          continue
        }
        matchingKeys.add(
          panelGridModuleRefKey({
            kind: 'domotica',
            endpointId: candidate.id,
            circuitId: circuit.id,
          })
        )
      }
    }
  }

  for (const panel of panels) {
    if (!panel.gridView) continue
    panel.gridView.slots = (panel.gridView.slots ?? []).filter(
      (candidate) => !isMatchingTerminalRef(candidate.module)
    )
    panel.gridView.supplyPanelSlots = (panel.gridView.supplyPanelSlots ?? []).filter(
      (candidate) => !isMatchingTerminalRef(candidate.module)
    )
    if (matchingKeys.size > 0) {
      panel.gridView.hiddenModuleKeys = (panel.gridView.hiddenModuleKeys ?? []).filter(
        (key) => !matchingKeys.has(key)
      )
      if (panel.gridView.hiddenModuleKeys.length === 0) {
        panel.gridView.hiddenModuleKeys = undefined
      }
    }
  }

  for (const enclosure of enclosures) {
    enclosure.gridView.slots = enclosure.gridView.slots.filter(
      (candidate) => !isMatchingTerminalRef(candidate.module)
    )
  }
  if (targetEnclosure) {
    targetEnclosure.gridView.slots.push(slot)
    return true
  }
  if (!targetPanel) return false
  targetPanel.gridView ??= {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  targetPanel.gridView.slots = [...(targetPanel.gridView.slots ?? []), slot]
  return true
}
