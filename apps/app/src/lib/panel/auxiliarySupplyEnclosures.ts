import { getAllCircuits, isTerminalStripDevice } from '@/lib/eendraad/projectElectricalDomain'
import { panelGridModuleRefKey, resolveModuleWidthCols } from '@/lib/panel/panelGridLayout'
import { findFirstFreeMainOrOverflowSlot } from '@/lib/panel/autoArrangeLayout'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import {
  selectProjectAuxiliaryElectricalEnclosures,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  editProjectAuxiliaryElectricalEnclosures,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { supplyNodeReferencesDevice } from '@/lib/supplyAssembly/deviceReferences'
import type { Panel, PanelGridModuleRef, PanelGridSlot, Point2, TrunkDevice } from '@/types/schema'
import type { AuxiliaryElectricalEnclosure, ElectricalEnclosureRef } from '@/types/supplyAssembly'
import { MIN_PANEL_GRID_MODULE_WIDTH } from '@/lib/panel/panelGridUnits'
import { releaseCircuitModulesFromEnclosure } from '@/lib/panel/circuitModuleMounting'

export const MIN_AUXILIARY_COLUMNS = 12
const DEFAULT_AUXILIARY_COLUMNS = 18

function supplyModuleRef(deviceId: string): PanelGridModuleRef {
  return { kind: 'trunkDevice', id: deviceId, scope: 'supply' }
}

function removeModuleFromSlots(slots: PanelGridSlot[] | undefined, key: string): PanelGridSlot[] {
  return (slots ?? []).filter((slot) => panelGridModuleRefKey(slot.module) !== key)
}

function visitPanels(panels: Panel[], visit: (panel: Panel) => void): void {
  for (const panel of panels) {
    visit(panel)
    visitPanels(panel.subPanels ?? [], visit)
  }
}

function findPanel(panels: Panel[], panelId: string): Panel | undefined {
  let found: Panel | undefined
  visitPanels(panels, (panel) => {
    if (panel.id === panelId) found = panel
  })
  return found
}

function getKnownSupplyDevices(project: ProjectWithOptionalV2Electrical): TrunkDevice[] {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const candidates = [
    ...(installation.mainSupply.supplyTrunkDevices ?? []),
    ...(installation.feedTopology?.sharedFeed.trunkDevices ?? []),
    ...(installation.feedTopology?.rootFeeds.flatMap((feed) => feed.trunkDevices ?? []) ?? []),
  ]
  const seen = new Set<string>()
  return candidates.filter((device) => {
    if (seen.has(device.id)) return false
    seen.add(device.id)
    return true
  })
}

/** Ids of the supply-side trunk devices (grid connection and board feeds). */
export function getKnownSupplyDeviceIds(project: ProjectWithOptionalV2Electrical): string[] {
  return getKnownSupplyDevices(project).map((device) => device.id)
}

function removeSupplyDeviceFromVisualSlots(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string
): void {
  const key = panelGridModuleRefKey(supplyModuleRef(deviceId))
  visitPanels(getProjectElectricalPanels(project), (panel) => {
    if (!panel.gridView) return
    panel.gridView.slots = removeModuleFromSlots(panel.gridView.slots, key)
    panel.gridView.supplyPanelSlots = removeModuleFromSlots(panel.gridView.supplyPanelSlots, key)
  })
  for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(project)) {
    enclosure.gridView.slots = removeModuleFromSlots(enclosure.gridView.slots, key)
  }
}

export function getSupplyDeviceSlot(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string
): PanelGridSlot | undefined {
  const key = panelGridModuleRefKey(supplyModuleRef(deviceId))
  let found: PanelGridSlot | undefined
  visitPanels(getProjectElectricalPanels(project), (panel) => {
    found ??= [...(panel.gridView?.slots ?? []), ...(panel.gridView?.supplyPanelSlots ?? [])].find(
      (slot) => panelGridModuleRefKey(slot.module) === key
    )
  })
  return (
    found ??
    selectProjectAuxiliaryElectricalEnclosures(project)
      .flatMap((enclosure) => enclosure.gridView.slots)
      .find((slot) => panelGridModuleRefKey(slot.module) === key)
  )
}

function supplyDeviceWidthProps(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string
): Pick<PanelGridSlot, 'moduleWidth' | 'moduleWidthManual'> {
  const previous = getSupplyDeviceSlot(project, deviceId)
  return previous?.moduleWidthManual && previous.moduleWidth != null
    ? { moduleWidth: previous.moduleWidth, moduleWidthManual: true }
    : {}
}

export function getSupplyDeviceMounting(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string
): ElectricalEnclosureRef | undefined {
  const device = getKnownSupplyDevices(project).find((candidate) => candidate.id === deviceId)
  if (device?.panelMounting) return device.panelMounting
  for (const assembly of selectProjectSupplyAssemblies(project)) {
    const node = assembly.nodes.find((candidate) => supplyNodeReferencesDevice(candidate, deviceId))
    if (node?.mounting) return node.mounting.enclosure
  }
  const refKey = panelGridModuleRefKey(supplyModuleRef(deviceId))
  let slotMounting: ElectricalEnclosureRef | undefined
  visitPanels(getProjectElectricalPanels(project), (panel) => {
    if (panel.gridView?.slots.some((slot) => panelGridModuleRefKey(slot.module) === refKey)) {
      slotMounting = { kind: 'panel', panelId: panel.id }
    } else if (
      panel.gridView?.supplyPanelSlots?.some(
        (slot) => panelGridModuleRefKey(slot.module) === refKey
      )
    ) {
      slotMounting = { kind: 'grid' }
    }
  })
  if (slotMounting) return slotMounting
  return undefined
}

export function resolveSupplyDeviceMounting(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string
): ElectricalEnclosureRef | undefined {
  const explicit = getSupplyDeviceMounting(project, deviceId)
  if (explicit) return explicit
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return undefined
  const topology = installation.feedTopology
  const sharedDevices = [
    ...(installation.mainSupply.supplyTrunkDevices ?? []),
    ...(topology?.sharedFeed.trunkDevices ?? []),
  ]
  if (sharedDevices.some((device) => device.id === deviceId)) {
    return { kind: 'grid' }
  }
  const rootFeed = topology?.rootFeeds.find((feed) =>
    feed.trunkDevices?.some((device) => device.id === deviceId)
  )
  return rootFeed ? { kind: 'panel', panelId: rootFeed.panelId } : undefined
}

export function isAuxiliaryMountableSupplyDevice(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string
): boolean {
  return getKnownSupplyDevices(project).some((device) => device.id === deviceId)
}

export function getAuxiliaryEnclosureSupplyDeviceIds(
  project: ProjectWithOptionalV2Electrical,
  enclosureId: string
): string[] {
  return getKnownSupplyDevices(project)
    .filter((device) => {
      const mounting = resolveSupplyDeviceMounting(project, device.id)
      return mounting?.kind === 'auxiliary' && mounting.enclosureId === enclosureId
    })
    .map((device) => device.id)
}

export function getAuxiliaryMountedSupplyDeviceIds(
  project: ProjectWithOptionalV2Electrical
): ReadonlySet<string> {
  return new Set(
    selectProjectAuxiliaryElectricalEnclosures(project).flatMap((enclosure) =>
      getAuxiliaryEnclosureSupplyDeviceIds(project, enclosure.id)
    )
  )
}

export function setSupplyDeviceMounting(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  enclosure: ElectricalEnclosureRef
): boolean {
  const device = getKnownSupplyDevices(project).find((candidate) => candidate.id === deviceId)
  if (!device) return false
  device.panelMounting = enclosure
  // The shared-feed projection may hold a separate copy after hydration/Immer.
  // Persist the physical device's mounting consistently on every stored carrier.
  const installation = getProjectElectricalInstallation(project)!
  for (const candidate of [
    ...(installation.mainSupply.supplyTrunkDevices ?? []),
    ...(installation.feedTopology?.sharedFeed.trunkDevices ?? []),
    ...(installation.feedTopology?.rootFeeds.flatMap((feed) => feed.trunkDevices ?? []) ?? []),
  ])
    if (candidate.id === deviceId) candidate.panelMounting = enclosure
  // Older project versions stored this fact on mirrored assembly nodes. Clear that
  // compatibility copy once the physical device owns the canonical mounting.
  for (const assembly of selectProjectSupplyAssemblies(project)) {
    for (const node of assembly.nodes) {
      if (!supplyNodeReferencesDevice(node, deviceId)) continue
      delete node.mounting
    }
  }
  return true
}

function enclosureRefsEqual(
  left: ElectricalEnclosureRef | undefined,
  right: ElectricalEnclosureRef
): boolean {
  if (!left || left.kind !== right.kind) return false
  if (left.kind === 'grid') return true
  if (left.kind === 'panel' && right.kind === 'panel') return left.panelId === right.panelId
  return (
    left.kind === 'auxiliary' &&
    right.kind === 'auxiliary' &&
    left.enclosureId === right.enclosureId
  )
}

/**
 * Change a supply device's physical enclosure from one-wire drag/drop. The panel-grid
 * position is deliberately automatic because the one-wire canvas has no row/column intent.
 */
export function moveSupplyDeviceToEnclosureAutomatically(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  enclosure: ElectricalEnclosureRef,
  ownerPanelId: string
): boolean {
  if (enclosureRefsEqual(resolveSupplyDeviceMounting(project, deviceId), enclosure)) return true
  const panel = findPanel(getProjectElectricalPanels(project), ownerPanelId)
  const auxiliary =
    enclosure.kind === 'auxiliary'
      ? selectProjectAuxiliaryElectricalEnclosures(project).find(
          (candidate) => candidate.id === enclosure.enclosureId
        )
      : undefined
  const targetPanel =
    enclosure.kind === 'panel'
      ? findPanel(getProjectElectricalPanels(project), enclosure.panelId)
      : panel
  if (enclosure.kind === 'auxiliary' && !auxiliary) return false
  if (enclosure.kind !== 'auxiliary' && !targetPanel) return false

  removeSupplyDeviceFromVisualSlots(project, deviceId)
  if (!setSupplyDeviceMounting(project, deviceId, enclosure)) return false

  const ref = supplyModuleRef(deviceId)
  const width = Math.max(MIN_PANEL_GRID_MODULE_WIDTH, resolveModuleWidthCols(ref, project))
  if (auxiliary) {
    const occupied = auxiliary.gridView.slots.map((slot) => ({
      row: slot.row,
      col: slot.col,
      width: Math.max(
        MIN_PANEL_GRID_MODULE_WIDTH,
        resolveModuleWidthCols(slot.module, project, slot)
      ),
    }))
    const spot = findFirstFreeMainOrOverflowSlot(
      occupied,
      width,
      Math.max(1, auxiliary.gridView.rows),
      Math.max(MIN_AUXILIARY_COLUMNS, auxiliary.gridView.columns),
      auxiliary.gridView.feedFromTop
    )
    auxiliary.gridView.rows = Math.max(auxiliary.gridView.rows, spot.row + 1)
    auxiliary.gridView.columns = Math.max(MIN_AUXILIARY_COLUMNS, auxiliary.gridView.columns)
    auxiliary.gridView.slots.push({ row: spot.row, col: spot.col, module: ref })
    return true
  }

  const grid =
    targetPanel!.gridView ??
    (targetPanel!.gridView = {
      rows: DEFAULT_PANEL_GRID_ROWS,
      columns: DEFAULT_PANEL_GRID_COLUMNS,
      feedFromTop: false,
      slots: [],
    })
  const slots = enclosure.kind === 'grid' ? (grid.supplyPanelSlots ??= []) : grid.slots
  const occupied = slots.map((slot) => ({
    row: slot.row,
    col: slot.col,
    width: Math.max(
      MIN_PANEL_GRID_MODULE_WIDTH,
      resolveModuleWidthCols(slot.module, project, slot)
    ),
  }))
  const spot = findFirstFreeMainOrOverflowSlot(
    occupied,
    width,
    grid.rows,
    grid.columns,
    grid.feedFromTop
  )
  slots.push({ row: spot.row, col: spot.col, module: ref })
  if (
    enclosure.kind === 'panel' &&
    getKnownSupplyDevices(project).find((device) => device.id === deviceId)?.symbol !== 'inverter'
  ) {
    const key = panelGridModuleRefKey(ref)
    grid.hiddenModuleKeys = grid.hiddenModuleKeys?.filter((candidate) => candidate !== key)
    grid.shownModuleKeys = [...new Set([...(grid.shownModuleKeys ?? []), key])]
  }
  return true
}

export function planAuxiliarySupplyEnclosureGrid(
  project: ProjectWithOptionalV2Electrical,
  deviceIds: string[]
): AuxiliaryElectricalEnclosure['gridView'] | null {
  const uniqueDeviceIds = [...new Set(deviceIds)]
  if (
    uniqueDeviceIds.length === 0 ||
    uniqueDeviceIds.some((deviceId) => !isAuxiliaryMountableSupplyDevice(project, deviceId))
  ) {
    return null
  }

  const widths = uniqueDeviceIds.map((deviceId) => {
    const ref = supplyModuleRef(deviceId)
    return Math.max(
      MIN_PANEL_GRID_MODULE_WIDTH,
      resolveModuleWidthCols(ref, project, getSupplyDeviceSlot(project, deviceId))
    )
  })
  const columns = Math.max(
    MIN_AUXILIARY_COLUMNS,
    Math.max(...widths),
    Math.min(
      DEFAULT_AUXILIARY_COLUMNS,
      widths.reduce((sum, width) => sum + width, 0)
    )
  )
  const slots: PanelGridSlot[] = []
  let row = 0
  let col = 0
  uniqueDeviceIds.forEach((deviceId, index) => {
    const width = widths[index]!
    if (col > 0 && col + width > columns) {
      row += 1
      col = 0
    }
    slots.push({
      row,
      col,
      module: supplyModuleRef(deviceId),
      ...supplyDeviceWidthProps(project, deviceId),
    })
    col += width
  })
  return {
    rows: row + 1,
    columns,
    feedFromTop: true,
    slots,
  }
}

export function createAuxiliarySupplyEnclosure(
  project: ProjectWithOptionalV2Electrical,
  options: {
    id: string
    deviceIds: string[]
    ownerPanelId: string
    position: Point2
  }
): AuxiliaryElectricalEnclosure | null {
  if (
    selectProjectAuxiliaryElectricalEnclosures(project).some(
      (enclosure) => enclosure.id === options.id
    )
  ) {
    return null
  }
  const gridView = planAuxiliarySupplyEnclosureGrid(project, options.deviceIds)
  if (!gridView) return null
  for (const deviceId of options.deviceIds) {
    setSupplyDeviceMounting(project, deviceId, {
      kind: 'auxiliary',
      enclosureId: options.id,
    })
    removeSupplyDeviceFromVisualSlots(project, deviceId)
  }
  const enclosure: AuxiliaryElectricalEnclosure = {
    id: options.id,
    name: '',
    kind: 'supply',
    ownerPanelId: options.ownerPanelId,
    panelViewPosition: options.position,
    gridView,
  }
  editProjectAuxiliaryElectricalEnclosures(project).push(enclosure)
  return enclosure
}

export function moveSupplyDeviceToAuxiliaryEnclosure(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  enclosureId: string,
  row: number,
  col: number
): boolean {
  const enclosure = selectProjectAuxiliaryElectricalEnclosures(project).find(
    (candidate) => candidate.id === enclosureId
  )
  if (!enclosure) return false
  const manual = supplyDeviceWidthProps(project, deviceId)
  if (!setSupplyDeviceMounting(project, deviceId, { kind: 'auxiliary', enclosureId })) return false
  enclosure.gridView.rows = Math.max(1, enclosure.gridView.rows)
  enclosure.gridView.columns = Math.max(MIN_AUXILIARY_COLUMNS, enclosure.gridView.columns)
  removeSupplyDeviceFromVisualSlots(project, deviceId)
  enclosure.gridView.slots.push({ row, col, module: supplyModuleRef(deviceId), ...manual })
  const key = panelGridModuleRefKey(supplyModuleRef(deviceId))
  enclosure.gridView.hiddenModuleKeys = enclosure.gridView.hiddenModuleKeys?.filter(
    (candidate) => candidate !== key
  )
  enclosure.gridView.shownModuleKeys = [
    ...new Set([...(enclosure.gridView.shownModuleKeys ?? []), key]),
  ]
  return true
}

export function moveSupplyDeviceToPanelEnclosure(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  panelId: string,
  row: number,
  col: number
): boolean {
  const panel = findPanel(getProjectElectricalPanels(project), panelId)
  if (!panel?.gridView) return false
  const manual = supplyDeviceWidthProps(project, deviceId)
  if (!setSupplyDeviceMounting(project, deviceId, { kind: 'panel', panelId })) return false
  removeSupplyDeviceFromVisualSlots(project, deviceId)
  const ref = supplyModuleRef(deviceId)
  const key = panelGridModuleRefKey(ref)
  panel.gridView.hiddenModuleKeys = panel.gridView.hiddenModuleKeys?.filter(
    (candidate) => candidate !== key
  )
  panel.gridView.shownModuleKeys = [...new Set([...(panel.gridView.shownModuleKeys ?? []), key])]
  panel.gridView.slots.push({ row, col, module: ref, ...manual })
  return true
}

export function moveSupplyDeviceToGridEnclosure(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  panelId: string,
  row: number,
  col: number
): boolean {
  const panel = findPanel(getProjectElectricalPanels(project), panelId)
  if (!panel?.gridView) return false
  const manual = supplyDeviceWidthProps(project, deviceId)
  if (!setSupplyDeviceMounting(project, deviceId, { kind: 'grid' })) return false
  removeSupplyDeviceFromVisualSlots(project, deviceId)
  panel.gridView.supplyPanelSlots ??= []
  panel.gridView.supplyPanelSlots.push({ row, col, module: supplyModuleRef(deviceId), ...manual })
  const key = panelGridModuleRefKey(supplyModuleRef(deviceId))
  const ownerPanel =
    getProjectElectricalPanels(project).find((candidate) => candidate.isMain) ?? panel
  ownerPanel.gridView ??= {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  ownerPanel.gridView.hiddenModuleKeys = ownerPanel.gridView.hiddenModuleKeys?.filter(
    (candidate) => candidate !== key
  )
  ownerPanel.gridView.shownModuleKeys = [
    ...new Set([...(ownerPanel.gridView.shownModuleKeys ?? []), key]),
  ]
  return true
}

export function deleteAuxiliarySupplyEnclosure(
  project: ProjectWithOptionalV2Electrical,
  enclosureId: string
): boolean {
  const enclosures = editProjectAuxiliaryElectricalEnclosures(project)
  const index = enclosures.findIndex((enclosure) => enclosure.id === enclosureId)
  if (index < 0) return false
  const enclosure = enclosures[index]!
  // A physical terminal strip must be moved out before its enclosure is removed.
  if (
    getProjectElectricalPanels(project).some((panel) =>
      getAllCircuits(panel).some((circuit) =>
        (circuit.trunkDevices ?? []).some(
          (device) =>
            isTerminalStripDevice(device) &&
            device.panelMounting?.kind === 'auxiliary' &&
            device.panelMounting.enclosureId === enclosureId
        )
      )
    )
  )
    return false
  const deviceIds = getAuxiliaryEnclosureSupplyDeviceIds(project, enclosureId)
  const ownerPanel = enclosure.ownerPanelId
    ? findPanel(getProjectElectricalPanels(project), enclosure.ownerPanelId)
    : undefined
  if (ownerPanel && !ownerPanel.gridView) {
    ownerPanel.gridView = {
      rows: DEFAULT_PANEL_GRID_ROWS,
      columns: DEFAULT_PANEL_GRID_COLUMNS,
      feedFromTop: false,
      slots: [],
    }
  }
  const ownerGrid = ownerPanel?.gridView
  const previousSlots = new Map(
    enclosure.gridView.slots.map((slot) => [panelGridModuleRefKey(slot.module), slot] as const)
  )
  // Older interaction paths could leave a stale explicit panel slot behind while the
  // mounting reference correctly pointed at this enclosure. Normalize every visual
  // slot first so restoring a device can only create one canonical panel placement.
  for (const deviceId of deviceIds) removeSupplyDeviceFromVisualSlots(project, deviceId)
  const occupied = (ownerGrid?.slots ?? []).map((slot) => ({
    row: slot.row,
    col: slot.col,
    width: Math.max(
      MIN_PANEL_GRID_MODULE_WIDTH,
      resolveModuleWidthCols(slot.module, project, slot)
    ),
  }))
  for (const deviceId of deviceIds) {
    if (enclosure.ownerPanelId) {
      setSupplyDeviceMounting(project, deviceId, {
        kind: 'panel',
        panelId: enclosure.ownerPanelId,
      })
      if (ownerGrid) {
        const ref = supplyModuleRef(deviceId)
        const previousSlot = previousSlots.get(panelGridModuleRefKey(ref))
        const width = Math.max(
          MIN_PANEL_GRID_MODULE_WIDTH,
          resolveModuleWidthCols(ref, project, previousSlot)
        )
        const spot = findFirstFreeMainOrOverflowSlot(
          occupied,
          width,
          ownerGrid.rows,
          ownerGrid.columns,
          ownerGrid.feedFromTop
        )
        ownerGrid.slots.push({
          row: spot.row,
          col: spot.col,
          module: ref,
          ...(previousSlot?.moduleWidthManual === true && previousSlot.moduleWidth != null
            ? {
                moduleWidth: previousSlot.moduleWidth,
                moduleWidthManual: true as const,
              }
            : {}),
        })
        occupied.push({ row: spot.row, col: spot.col, width })
        const device = getKnownSupplyDevices(project).find((candidate) => candidate.id === deviceId)
        if (device?.supplyPath === 'converter-branch') {
          const key = panelGridModuleRefKey(ref)
          ownerGrid.hiddenModuleKeys = ownerGrid.hiddenModuleKeys?.filter(
            (candidate) => candidate !== key
          )
          ownerGrid.shownModuleKeys = [...new Set([...(ownerGrid.shownModuleKeys ?? []), key])]
        }
      }
    } else {
      const device = getKnownSupplyDevices(project).find((candidate) => candidate.id === deviceId)
      if (device) delete device.panelMounting
      for (const assembly of selectProjectSupplyAssemblies(project)) {
        for (const node of assembly.nodes) {
          if (supplyNodeReferencesDevice(node, deviceId)) delete node.mounting
        }
      }
    }
  }
  releaseCircuitModulesFromEnclosure(project, enclosureId)
  enclosures.splice(index, 1)
  return true
}
