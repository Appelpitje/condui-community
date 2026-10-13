import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  findEndpointById,
  getAllCircuits,
  getAllProtections,
  getDefaultPanelGridModuleRefs,
  isModuleRefValid,
  panelGridModuleIsAlwaysVisibleInPanel,
  panelGridModuleIsVisibleByDefault,
  panelGridModuleRefKey,
  resolveTerminalStripModule,
} from '@/lib/eendraad/projectElectricalDomain'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { findPanelById } from '@/lib/panel/panelTree'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import { isSupplyDeviceVisibleInPanel } from '@/lib/panel/supplyPanelVisibility'
import { getSuppressedPanelGridModuleKeys } from '@/lib/panel/panelGridDuplicates'
import { getTerminalStripId } from '@/lib/terminalStrip/labels'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'
import { getJunctionPanelIdentity } from '@/lib/junctionPanel/grid'
import { findRemountableCircuitModule } from '@/lib/panel/circuitModuleMounting'
import type { Panel, PanelGridModuleRef, PanelGridSlot, TrunkDevice } from '@/types/schema'

export type PanelGridModule = {
  ref: PanelGridModuleRef
  terminalStripMemberRefs?: PanelGridModuleRef[]
  slot?: Pick<
    PanelGridSlot,
    'row' | 'col' | 'moduleWidth' | 'moduleWidthManual' | 'terminalStripRail'
  >
  inSupplyPanel?: boolean
}

function supplyDevicesForPanel(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel
): TrunkDevice[] {
  const installation = getProjectElectricalInstallation(project)
  if (!installation || !panel.isMain) return []
  const topology = installation.feedTopology
  const shared =
    installation.mainSupply.supplyTrunkDevices ?? topology?.sharedFeed.trunkDevices ?? []
  const sectionId = getPrimaryPanelBusSectionId(panel)
  const root = topology?.rootFeeds.find(
    (feed) => feed.panelId === panel.id && (feed.busSectionId ?? sectionId) === sectionId
  )
  const seen = new Set<string>()
  return [...shared, ...(root?.trunkDevices ?? [])].filter((device) => {
    if (seen.has(device.id)) return false
    seen.add(device.id)
    return true
  })
}

const isJunctionPanelDevice = (device: TrunkDevice) =>
  device.type === 'junction_panel' || device.symbol === 'junction_panel'

/**
 * Identity of the junction panel a module sits behind on its circuit (`''` for an unnamed
 * one), or undefined when it is not behind one. Such a module hangs in that junction panel.
 */
function getJunctionPanelBehind(
  ref: PanelGridModuleRef,
  panel: Panel,
  project: ProjectWithOptionalV2Electrical
): string | undefined {
  const circuits = getAllCircuits(panel)
  const identityOf = (device: TrunkDevice | undefined) =>
    device ? (getJunctionPanelIdentity(device) ?? '') : undefined
  const boundaryIdentity = new Map<string, string>()
  for (const circuit of circuits) {
    const boundary = (circuit.trunkDevices ?? []).find(isJunctionPanelDevice)
    if (boundary) boundaryIdentity.set(circuit.id, identityOf(boundary)!)
  }
  const downstreamIdentity = new Map<string, string>()
  const frontier = [...boundaryIdentity.keys()]
  while (frontier.length > 0) {
    const circuitId = frontier.pop()!
    const identity = boundaryIdentity.get(circuitId) ?? downstreamIdentity.get(circuitId)!
    const circuit = circuits.find((candidate) => candidate.id === circuitId)
    for (const childId of circuit?.subCircuitIds ?? []) {
      if (downstreamIdentity.has(childId)) continue
      downstreamIdentity.set(childId, identity)
      frontier.push(childId)
    }
  }
  if (ref.kind === 'domotica') {
    if (resolveTerminalStripModule(project, ref)?.panelId === panel.id) return undefined
    return boundaryIdentity.get(ref.circuitId) ?? downstreamIdentity.get(ref.circuitId)
  }
  if (ref.kind === 'protection') {
    const protection = getAllProtections(panel).find((candidate) => candidate.id === ref.id)
    for (const circuit of protection?.circuits ?? []) {
      const identity = downstreamIdentity.get(circuit.id)
      if (identity !== undefined) return identity
    }
    return undefined
  }
  if (ref.scope === 'circuit' && ref.circuitId) {
    if (resolveTerminalStripModule(project, ref)?.panelId === panel.id) return undefined
    const inherited = downstreamIdentity.get(ref.circuitId)
    if (inherited !== undefined) return inherited
    const circuit = circuits.find((candidate) => candidate.id === ref.circuitId)
    const devices = [...(circuit?.trunkDevices ?? [])].sort(
      (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
    )
    const boundaryIndex = devices.findIndex(isJunctionPanelDevice)
    const deviceIndex = devices.findIndex((device) => device.id === ref.id)
    return boundaryIndex >= 0 && deviceIndex > boundaryIndex
      ? identityOf(devices[boundaryIndex])
      : undefined
  }
  if (ref.scope === 'supply') {
    const devices = queryAllSupplyTrunkDevices(project)
    const boundaryIndex = devices.findIndex(isJunctionPanelDevice)
    const deviceIndex = devices.findIndex((device) => device.id === ref.id)
    return boundaryIndex >= 0 && deviceIndex > boundaryIndex
      ? identityOf(devices[boundaryIndex])
      : undefined
  }
  return undefined
}

function isDownstreamOfJunctionPanel(
  ref: PanelGridModuleRef,
  panel: Panel,
  project: ProjectWithOptionalV2Electrical
): boolean {
  // A module explicitly hung in a panel or enclosure is not left in the junction panel.
  if (findRemountableCircuitModule(project, ref)?.entity.panelMounting) return false
  return getJunctionPanelBehind(ref, panel, project) !== undefined
}

export function getPanelGridModulesInProject(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): PanelGridModule[] {
  const panels = getProjectElectricalPanels(project)
  const panel = findPanelById(panels, panelId)
  const installation = getProjectElectricalInstallation(project)
  if (!panel || !installation) return []

  const supplyDevices = queryAllSupplyTrunkDevices(project)
  const panelFeedDevices = supplyDevicesForPanel(project, panel)
  const sharedSupplyKeys = new Set(
    panel.isMain
      ? (
          installation.mainSupply.supplyTrunkDevices ??
          installation.feedTopology?.sharedFeed.trunkDevices ??
          []
        ).map((device) =>
          panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
        )
      : []
  )
  const sectionId = getPrimaryPanelBusSectionId(panel)
  const rootFeed = installation.feedTopology?.rootFeeds.find(
    (feed) => feed.panelId === panel.id && (feed.busSectionId ?? sectionId) === sectionId
  )
  const rootSupplyKeys = new Set(
    panel.isMain
      ? (rootFeed?.trunkDevices ?? []).map((device) =>
          panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
        )
      : []
  )
  const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
  const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
  const defaultRefs = getDefaultPanelGridModuleRefs(panel, installation, panels, panelFeedDevices)
  const defaultKeys = new Set(defaultRefs.map(panelGridModuleRefKey))
  const mountedSupplyKeys = new Set<string>()
  for (const device of supplyDevices) {
    const mounting = resolveSupplyDeviceMounting(project, device.id)
    const ref: PanelGridModuleRef = { kind: 'trunkDevice', id: device.id, scope: 'supply' }
    const key = panelGridModuleRefKey(ref)
    if (mounting?.kind === 'panel' && mounting.panelId === panel.id) {
      mountedSupplyKeys.add(key)
      if (!defaultKeys.has(key)) defaultRefs.push(ref)
    }
  }
  const slots = panel.gridView?.slots ?? []
  const supplySlots = panel.gridView?.supplyPanelSlots ?? []
  const validSlots = slots.filter((slot) => {
    try {
      return isModuleRefValid(slot.module, project)
    } catch {
      return false
    }
  })
  const validSupplySlots = supplySlots.filter((slot) => {
    try {
      return isModuleRefValid(slot.module, project)
    } catch {
      return false
    }
  })
  const sharedSupplySlots = panel.isMain
    ? validSupplySlots.filter((slot) => sharedSupplyKeys.has(panelGridModuleRefKey(slot.module)))
    : validSupplySlots
  const rootSupplySlots = panel.isMain
    ? validSupplySlots.filter((slot) => rootSupplyKeys.has(panelGridModuleRefKey(slot.module)))
    : []
  const supplyKeys = new Set(sharedSupplySlots.map((slot) => panelGridModuleRefKey(slot.module)))
  const mainKeys = new Set(validSlots.map((slot) => panelGridModuleRefKey(slot.module)))
  const slotMap = new Map(
    [...validSlots, ...rootSupplySlots].map((slot) => [panelGridModuleRefKey(slot.module), slot])
  )
  const result: PanelGridModule[] = defaultRefs
    .filter((ref) => {
      const assignedPanelId = resolveTerminalStripModule(project, ref)?.panelId
      if (assignedPanelId != null && assignedPanelId !== panel.id) return false
      if (assignedPanelId !== panel.id && isDownstreamOfJunctionPanel(ref, panel, project))
        return false
      const key = panelGridModuleRefKey(ref)
      if (ref.kind === 'trunkDevice' && ref.scope === 'supply') {
        const device = supplyDevices.find((candidate) => candidate.id === ref.id)
        if (!device || !isSupplyDeviceVisibleInPanel(project, ref.id, device)) return false
        const mounting = resolveSupplyDeviceMounting(project, ref.id)
        if (mounting?.kind === 'auxiliary' || mounting?.kind === 'grid') return false
        if (mounting?.kind === 'panel' && mounting.panelId !== panel.id) return false
      }
      if (hiddenKeys.has(key) && !panelGridModuleIsAlwaysVisibleInPanel(ref, panels)) return false
      if (
        !panelGridModuleIsVisibleByDefault(ref, panel, installation, panels, panelFeedDevices) &&
        !mountedSupplyKeys.has(key) &&
        !shownKeys.has(key)
      )
        return false
      if (panel.isMain && ref.kind === 'trunkDevice' && ref.scope === 'supply') {
        if (rootSupplyKeys.has(key)) return true
        if (supplyKeys.has(key) && !mountedSupplyKeys.has(key)) return false
        return mainKeys.has(key) || mountedSupplyKeys.has(key)
      }
      return !supplyKeys.has(key)
    })
    .map((ref) => {
      const slot = slotMap.get(panelGridModuleRefKey(ref))
      return {
        ref,
        slot: slot
          ? {
              row: slot.row,
              col: slot.col,
              moduleWidth: slot.moduleWidth,
              moduleWidthManual: slot.moduleWidthManual,
              terminalStripRail: slot.terminalStripRail,
            }
          : undefined,
        inSupplyPanel: false,
      }
    })

  if (panel.isMain) {
    const gridSupplyDevices = panelFeedDevices.filter(
      (device) =>
        sharedSupplyKeys.has(
          panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
        ) && resolveSupplyDeviceMounting(project, device.id)?.kind === 'grid'
    )
    const supplySlotMap = new Map(
      sharedSupplySlots.map((slot) => [panelGridModuleRefKey(slot.module), slot])
    )
    for (const device of gridSupplyDevices) {
      const ref: PanelGridModuleRef = { kind: 'trunkDevice', id: device.id, scope: 'supply' }
      const key = panelGridModuleRefKey(ref)
      if (hiddenKeys.has(key)) continue
      if (mainKeys.has(key) && !supplyKeys.has(key)) continue
      const slot = supplySlotMap.get(key)
      result.push({
        ref,
        slot: slot
          ? {
              row: slot.row,
              col: slot.col,
              moduleWidth: slot.moduleWidth,
              moduleWidthManual: slot.moduleWidthManual,
              terminalStripRail: slot.terminalStripRail,
            }
          : undefined,
        inSupplyPanel: true,
      })
    }
  } else {
    for (const slot of validSupplySlots) {
      result.push({
        ref: slot.module,
        slot: {
          row: slot.row,
          col: slot.col,
          moduleWidth: slot.moduleWidth,
          moduleWidthManual: slot.moduleWidthManual,
          terminalStripRail: slot.terminalStripRail,
        },
        inSupplyPanel: true,
      })
    }
  }

  const suppressedDuplicateKeys = getSuppressedPanelGridModuleKeys(
    project,
    result.map((item, index) => ({
      ref: item.ref,
      area: item.inSupplyPanel ? 'supply' : 'main',
      row: item.slot?.row ?? 0,
      col: item.slot?.col ?? 0,
      order: index,
    }))
  )
  const terminalGroups = new Map<string, PanelGridModule[]>()
  for (const item of result) {
    const ref = item.ref
    let strip:
      | { symbol?: string; type?: string; junctionIdentity?: string; label?: string }
      | undefined
    if (ref.kind === 'trunkDevice') {
      strip = supplyDevices.find((device) => device.id === ref.id)
      if (!strip) {
        for (const candidatePanel of panels) {
          const device = getAllCircuits(candidatePanel)
            .flatMap((circuit) => circuit.trunkDevices ?? [])
            .find((candidate) => candidate.id === ref.id)
          if (device) {
            strip = device
            break
          }
        }
      }
    } else if (ref.kind === 'domotica') {
      strip = panels
        .map((candidate) => findEndpointById(candidate, ref.endpointId))
        .find((candidate) => candidate != null)?.endpoint
    }
    if (!strip || (strip.symbol !== 'terminal_strip' && strip.type !== 'terminal_strip')) continue
    const identity = getTerminalStripId(strip).trim().toUpperCase()
    if (!identity) continue
    const group = terminalGroups.get(identity) ?? []
    group.push(item)
    terminalGroups.set(identity, group)
  }
  const collapsedTerminalKeys = new Set<string>()
  for (const group of terminalGroups.values()) {
    if (group.length < 2) continue
    const representative = group.find((item) => item.slot != null) ?? group[0]
    if (!representative) continue
    representative.terminalStripMemberRefs = group.map((item) => item.ref)
    for (const item of group) {
      if (item !== representative) collapsedTerminalKeys.add(panelGridModuleRefKey(item.ref))
    }
  }
  const seen = new Set<string>()
  return result.filter((item) => {
    const assignedPanelId = resolveTerminalStripModule(project, item.ref)?.panelId
    if (assignedPanelId != null && assignedPanelId !== panel.id) return false
    if (assignedPanelId !== panel.id && isDownstreamOfJunctionPanel(item.ref, panel, project))
      return false
    const key = panelGridModuleRefKey(item.ref)
    if (item.ref.kind === 'trunkDevice' && item.ref.scope === 'supply') {
      const id = item.ref.id
      const device = supplyDevices.find((candidate) => candidate.id === id)
      if (!device || !isSupplyDeviceVisibleInPanel(project, item.ref.id, device)) return false
    }
    if (hiddenKeys.has(key) && !panelGridModuleIsAlwaysVisibleInPanel(item.ref, panels))
      return false
    if (
      !panelGridModuleIsVisibleByDefault(item.ref, panel, installation, panels, panelFeedDevices) &&
      !mountedSupplyKeys.has(key) &&
      !shownKeys.has(key)
    )
      return false
    if (suppressedDuplicateKeys.has(key) || collapsedTerminalKeys.has(key) || seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

/**
 * Modules hanging in a junction panel: every visible module that sits behind a junction
 * panel with this identity on its circuit. Boards leave them out of their own grid.
 */
export function getJunctionPanelModulesInProject(
  project: ProjectWithOptionalV2Electrical,
  identity: string,
  slots: PanelGridSlot[]
): PanelGridModule[] {
  const panels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const slotMap = new Map(slots.map((slot) => [panelGridModuleRefKey(slot.module), slot]))
  const result: PanelGridModule[] = []
  const seen = new Set<string>()
  const visit = (panel: Panel) => {
    const panelFeedDevices = supplyDevicesForPanel(project, panel)
    const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
    const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
    for (const ref of getDefaultPanelGridModuleRefs(
      panel,
      installation,
      panels,
      panelFeedDevices
    )) {
      const key = panelGridModuleRefKey(ref)
      if (seen.has(key)) continue
      if (getJunctionPanelBehind(ref, panel, project) !== identity) continue
      if (findRemountableCircuitModule(project, ref)?.entity.panelMounting) continue
      if (hiddenKeys.has(key) && !panelGridModuleIsAlwaysVisibleInPanel(ref, panels)) continue
      if (
        !panelGridModuleIsVisibleByDefault(ref, panel, installation, panels, panelFeedDevices) &&
        !shownKeys.has(key)
      )
        continue
      seen.add(key)
      const slot = slotMap.get(key)
      result.push({
        ref,
        slot: slot
          ? {
              row: slot.row,
              col: slot.col,
              moduleWidth: slot.moduleWidth,
              moduleWidthManual: slot.moduleWidthManual,
              terminalStripRail: slot.terminalStripRail,
            }
          : undefined,
      })
    }
    for (const child of panel.subPanels ?? []) visit(child)
  }
  for (const panel of panels) visit(panel)
  return result
}
