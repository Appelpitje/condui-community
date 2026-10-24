import { clamp } from '@/lib/geometry'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import {
  findPanelOwnDistributionEndpoint,
  isDomoticaPanelFeedEndpoint,
  resolvePanelSupplyLinkForPanelInPanels,
} from '@/lib/eendraad/panelSupplyLink'
import {
  getMainBusOrder,
  isCircuitNestedUnderPanelBus,
  moveProtectionToMainBusInsertIndex,
} from '@/lib/eendraad/mainBusOrder'
import { findPanelById } from '@/lib/panel/panelTree'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import { generateId } from '@/utils/project'

export interface MovePanelAttachmentResult {
  sourcePanelId: string
  feederCircuitId: string
  parentCircuitId?: string
  rcdProtectionId?: string
}

export interface MoveCircuitsToRcdBusResult {
  panelId: string
  rcdProtectionId: string
  circuitIds: string[]
}

function createDirectFeederCircuit(source: Circuit, targetPanel: Panel): Circuit {
  const ownPanelEndpoint = findPanelOwnDistributionEndpoint(targetPanel)
  return {
    ...source,
    id: generateId(),
    endpoints: [
      ownPanelEndpoint
        ? { ...ownPanelEndpoint, id: generateId(), placements: [] }
        : {
            id: generateId(),
            type: 'fixed_appliance',
            label: targetPanel.name,
            symbol: 'panel_distribution',
            panelId: targetPanel.id,
            placements: [],
          },
    ],
    branches: undefined,
    trunkDevices: undefined,
    subCircuitIds: undefined,
    notes: undefined,
  }
}

function findCircuitOwner(
  panels: Panel[],
  circuitId: string
): { panel: Panel; circuit: Circuit; protection?: ProtectionDevice } | null {
  for (const panel of panels) {
    const directCircuit = panel.circuits.find((circuit) => circuit.id === circuitId)
    if (directCircuit) return { panel, circuit: directCircuit }
    for (const protection of panel.protections) {
      const circuit = protection.circuits?.find((candidate) => candidate.id === circuitId)
      if (circuit) return { panel, circuit, protection }
    }
    const nested = findCircuitOwner(panel.subPanels ?? [], circuitId)
    if (nested) return nested
  }
  return null
}

function panelContainsPanel(panel: Panel, candidatePanelId: string): boolean {
  return (
    panel.id === candidatePanelId ||
    (panel.subPanels ?? []).some((child) => panelContainsPanel(child, candidatePanelId))
  )
}

function detachFeederFromCurrentLocation(
  panels: Panel[],
  protection: ProtectionDevice,
  feederCircuit: Circuit
): void {
  const parentInfo = findParentCircuitInfo(feederCircuit.id, panels)
  if (parentInfo?.parentCircuit.subCircuitIds) {
    parentInfo.parentCircuit.subCircuitIds = parentInfo.parentCircuit.subCircuitIds.filter(
      (id) => id !== feederCircuit.id
    )
    if (parentInfo.parentCircuit.subCircuitIds.length === 0) {
      parentInfo.parentCircuit.subCircuitIds = undefined
    }
  }

  protection.circuits = protection.circuits?.filter((circuit) => circuit.id !== feederCircuit.id)
  protection.subPanelId = undefined
}

function removeFeederFromGroupingProtections(
  panels: Panel[],
  feederCircuitId: string,
  ownerProtectionId: string
): void {
  for (const panel of panels) {
    for (const protection of panel.protections) {
      if (protection.id === ownerProtectionId) continue
      protection.circuits = protection.circuits?.filter((circuit) => circuit.id !== feederCircuitId)
    }
    removeFeederFromGroupingProtections(panel.subPanels ?? [], feederCircuitId, ownerProtectionId)
  }
}

function ensureDirectPanelCarrier(
  panels: Panel[],
  targetPanelId: string
): {
  sourcePanel: Panel
  targetPanel: Panel
  protection: ProtectionDevice
  feederCircuit: Circuit
} | null {
  const link = resolvePanelSupplyLinkForPanelInPanels(panels, targetPanelId)
  if (!link?.feederCircuit) return null

  if (link.protection.directPanelFeeder) {
    return {
      sourcePanel: link.sourcePanel,
      targetPanel: link.targetPanel,
      protection: link.protection,
      feederCircuit: link.feederCircuit,
    }
  }

  let feederCircuit = link.feederCircuit
  const parentInfo = findParentCircuitInfo(feederCircuit.id, panels)
  if (!parentInfo) {
    feederCircuit = createDirectFeederCircuit(feederCircuit, link.targetPanel)
  }
  detachFeederFromCurrentLocation(panels, link.protection, feederCircuit)
  const protection: ProtectionDevice = {
    id: generateId(),
    type: 'OTHER',
    label: '',
    circuits: [feederCircuit],
    subPanelId: targetPanelId,
    directPanelFeeder: true,
  }
  link.sourcePanel.protections.push(protection)

  return {
    sourcePanel: link.sourcePanel,
    targetPanel: link.targetPanel,
    protection,
    feederCircuit,
  }
}

/**
 * Existing panel attachments are terminal consumers: relocating one may append it
 * to a bus, or attach it to an empty circuit's terminal protection, but may not
 * put it in front of or between the protections already on that bus. New
 * `panel_distribution` drops intentionally do not use this guard.
 */
export function isPanelAttachmentDropTargetTerminal(
  panels: Panel[],
  targetPanelId: string,
  target: DropTarget
): boolean {
  const link = resolvePanelSupplyLinkForPanelInPanels(panels, targetPanelId)
  if (!link) return false
  if (isDomoticaPanelFeedEndpoint(link.sourcePanelEndpoint)) return false
  const isCircuitTopTarget =
    target.type === 'circuit' && target.insertAfterCircuitContent === true
  if (
    target.type !== 'endpoint' &&
    !isCircuitTopTarget &&
    target.panelId !== link.sourcePanel.id
  ) {
    return false
  }

  if (target.type === 'mainBus') {
    if (typeof target.mainBusInsertIndex !== 'number') return false
    const order = getMainBusOrder(link.sourcePanel).filter(
      (item) => item.type !== 'protection' || item.id !== link.protection.id
    )
    return target.mainBusInsertIndex >= order.length
  }

  if (target.type === 'circuit') {
    if (target.insertAfterCircuitContent === true) {
      if (!target.circuitId || typeof target.secondaryBusInsertIndex === 'number') return false
      const targetOwner = findCircuitOwner(panels, target.circuitId)
      if (!targetOwner?.protection || targetOwner.protection.subPanelId) return false
      return !panelContainsPanel(link.targetPanel, targetOwner.panel.id)
    }
    if (!target.circuitId || typeof target.secondaryBusInsertIndex !== 'number') return false
    const targetOwner = findCircuitOwner(panels, target.circuitId)
    if (!targetOwner?.protection || targetOwner.panel.id !== link.sourcePanel.id) return false
    const order = targetOwner.circuit.subCircuitIds ?? []
    const currentIndex = order.indexOf(link.feederCircuit?.id ?? '')
    const remaining = order.filter(
      (circuitId) => circuitId !== link.feederCircuit?.id
    )
    const adjustedIndex =
      currentIndex >= 0 && target.secondaryBusInsertIndex > currentIndex
        ? target.secondaryBusInsertIndex - 1
        : target.secondaryBusInsertIndex
    return adjustedIndex >= remaining.length
  }

  if (target.type === 'rcd') {
    if (!target.protectionId || typeof target.secondaryBusInsertIndex !== 'number') return false
    const targetRcd = link.sourcePanel.protections.find(
      (protection) =>
        protection.id === target.protectionId &&
        (protection.type === 'RCD' || protection.type === 'RCBO')
    )
    if (!targetRcd || targetRcd.id === link.protection.id) return false
    const remaining = (targetRcd.circuits ?? []).filter(
      (circuit) => circuit.id !== link.feederCircuit?.id
    )
    return target.secondaryBusInsertIndex >= remaining.length
  }

  if (target.type === 'endpoint') {
    if (!target.circuitId || !target.endpointId) return false
    const targetOwner = findCircuitOwner(panels, target.circuitId)
    if (!targetOwner?.protection) return false
    if (panelContainsPanel(link.targetPanel, targetOwner.panel.id)) return false
    if (targetOwner.protection.subPanelId) return false
    const endpoint = targetOwner.circuit.endpoints.find((candidate) => candidate.id === target.endpointId)
    return !!endpoint && endpoint.symbol !== 'panel_distribution'
  }

  return false
}

/**
 * Reorder a directly connected secondary panel among the protections on one
 * secondary bus. Legacy implicit attachments are materialized as a panel-only
 * child circuit so their position can use the existing `subCircuitIds` order.
 */
export function movePanelAttachmentOnSecondaryBus(
  panels: Panel[],
  targetPanelId: string,
  parentCircuitId: string,
  insertIndex: number
): MovePanelAttachmentResult | null {
  const link = resolvePanelSupplyLinkForPanelInPanels(panels, targetPanelId)
  if (!link?.feederCircuit) return null

  const protection = link.protection
  const existingParent = findParentCircuitInfo(link.feederCircuit.id, panels)
  const targetOwner = findCircuitOwner(panels, parentCircuitId)
  const targetProtection = targetOwner?.protection
  if (!targetOwner || !targetProtection) return null
  const targetOrder = targetOwner.circuit.subCircuitIds ?? []
  const targetCurrentIndex = targetOrder.indexOf(link.feederCircuit?.id ?? '')
  const targetRemainingCount = targetOrder.filter(
    (circuitId) => circuitId !== link.feederCircuit?.id
  ).length
  const adjustedTargetIndex =
    targetCurrentIndex >= 0 && insertIndex > targetCurrentIndex
      ? insertIndex - 1
      : insertIndex
  if (
    targetOwner.panel.id !== link.sourcePanel.id ||
    adjustedTargetIndex < targetRemainingCount
  ) {
    return null
  }

  let feederCircuit = link.feederCircuit
  let parentCircuit = existingParent?.parentCircuit

  if (protection.directPanelFeeder) {
    removeFeederFromGroupingProtections(panels, feederCircuit.id, protection.id)
    detachFeederFromCurrentLocation(panels, protection, feederCircuit)
    link.sourcePanel.protections = link.sourcePanel.protections.filter(
      (candidate) => candidate.id !== protection.id
    )
    parentCircuit = targetOwner.circuit
    targetProtection.subPanelId = targetPanelId
    targetProtection.circuits ??= []
    if (!targetProtection.circuits.some((circuit) => circuit.id === feederCircuit.id)) {
      targetProtection.circuits.push(feederCircuit)
    }
  } else if (!parentCircuit) {
    if (link.feederCircuit.id !== parentCircuitId) return null
    parentCircuit = link.feederCircuit
    feederCircuit = createDirectFeederCircuit(parentCircuit, link.targetPanel)
    protection.circuits ??= []
    protection.circuits.push(feederCircuit)
  } else if (parentCircuit.id !== parentCircuitId) {
    return null
  }

  const order = parentCircuit.subCircuitIds ?? []
  const currentIndex = order.indexOf(feederCircuit.id)
  if (currentIndex >= 0) order.splice(currentIndex, 1)

  const adjustedIndex =
    currentIndex >= 0 && insertIndex > currentIndex ? insertIndex - 1 : insertIndex
  order.splice(clamp(adjustedIndex, 0, order.length), 0, feederCircuit.id)
  parentCircuit.subCircuitIds = order

  return {
    sourcePanelId: link.sourcePanel.id,
    feederCircuitId: feederCircuit.id,
    parentCircuitId: parentCircuit.id,
  }
}

/** Move a secondary-panel attachment onto an RCD/RCBO grouping bus. */
export function movePanelAttachmentOnRcdBus(
  panels: Panel[],
  targetPanelId: string,
  rcdProtectionId: string,
  insertIndex: number
): MovePanelAttachmentResult | null {
  const initialLink = resolvePanelSupplyLinkForPanelInPanels(panels, targetPanelId)
  if (
    !initialLink ||
    !isPanelAttachmentDropTargetTerminal(panels, targetPanelId, {
      type: 'rcd',
      panelId: initialLink.sourcePanel.id,
      protectionId: rcdProtectionId,
      secondaryBusInsertIndex: insertIndex,
    })
  ) {
    return null
  }
  const carrier = ensureDirectPanelCarrier(panels, targetPanelId)
  if (!carrier) return null

  const targetRcd = carrier.sourcePanel.protections.find(
    (protection) =>
      protection.id === rcdProtectionId && (protection.type === 'RCD' || protection.type === 'RCBO')
  )
  if (!targetRcd || targetRcd.id === carrier.protection.id) return null

  const parentInfo = findParentCircuitInfo(carrier.feederCircuit.id, panels)
  if (parentInfo?.parentCircuit.subCircuitIds) {
    parentInfo.parentCircuit.subCircuitIds = parentInfo.parentCircuit.subCircuitIds.filter(
      (id) => id !== carrier.feederCircuit.id
    )
  }
  removeFeederFromGroupingProtections(panels, carrier.feederCircuit.id, carrier.protection.id)

  targetRcd.circuits ??= []
  const order = targetRcd.circuits.filter((circuit) => circuit.id !== carrier.feederCircuit.id)
  order.splice(clamp(insertIndex, 0, order.length), 0, carrier.feederCircuit)
  targetRcd.circuits = order

  // The layout's first circuit owner must remain the structural carrier while
  // the RCD merely references the same feeder circuit for bus grouping.
  const carrierIndex = carrier.sourcePanel.protections.findIndex(
    (protection) => protection.id === carrier.protection.id
  )
  const rcdIndex = carrier.sourcePanel.protections.findIndex(
    (protection) => protection.id === targetRcd.id
  )
  if (carrierIndex > rcdIndex && rcdIndex >= 0) {
    carrier.sourcePanel.protections.splice(carrierIndex, 1)
    carrier.sourcePanel.protections.splice(rcdIndex, 0, carrier.protection)
  }

  return {
    sourcePanelId: carrier.sourcePanel.id,
    feederCircuitId: carrier.feederCircuit.id,
    rcdProtectionId: targetRcd.id,
  }
}

/**
 * Group direct main-bus protection circuits under an existing RCD/RCBO bus.
 *
 * The individual protection remains the circuit's structural owner. The RCD
 * keeps only its anchor circuit; the anchor's subCircuitIds link groups the
 * moved MCBs on the RCD secondary bus. Do not copy child circuit objects into
 * the RCD circuits list: that creates a second protection owner and renders a
 * duplicate circuit/protection.
 */
export function moveCircuitsToRcdBus(
  panels: Panel[],
  panelId: string,
  rcdProtectionId: string,
  circuitIds: string[],
  insertIndex: number
): MoveCircuitsToRcdBusResult | null {
  const panel = findPanelById(panels, panelId)
  const targetRcd = panel?.protections.find(
    (protection) =>
      protection.id === rcdProtectionId &&
      (protection.type === 'RCD' || protection.type === 'RCBO')
  )
  if (!panel || !targetRcd) return null

  const uniqueCircuitIds = [...new Set(circuitIds)]
  if (uniqueCircuitIds.length === 0) return null

  const mainBusProtectionIds = new Set(
    getMainBusOrder(panel)
      .filter((item) => item.type === 'protection')
      .map((item) => item.id)
  )
  for (const circuitId of uniqueCircuitIds) {
    // A previous version could leave the same circuit referenced by the RCD
    // before the structural child link was written. Prefer the non-target
    // protection so this operation can also repair that intermediate state.
    const owner =
      panel.protections.find(
        (protection) =>
          protection.id !== targetRcd.id &&
          protection.circuits?.some((circuit) => circuit.id === circuitId)
      ) ??
      panel.protections.find((protection) =>
        protection.circuits?.some((circuit) => circuit.id === circuitId)
      )
    const circuit = owner?.circuits?.find((candidate) => candidate.id === circuitId)
    if (
      !owner ||
      owner.id === targetRcd.id ||
      owner.circuits?.length !== 1 ||
      owner.directPanelFeeder ||
      owner.subPanelId ||
      !mainBusProtectionIds.has(owner.id) ||
      !circuit ||
      isCircuitNestedUnderPanelBus(panel, circuit.id) ||
      panel.protections.some(
        (protection) =>
          protection.id !== targetRcd.id &&
          (protection.type === 'RCD' || protection.type === 'RCBO') &&
          protection.circuits?.some((candidate) => candidate.id === circuit.id)
      )
    ) {
      return null
    }
  }

  const selectedIds = new Set(uniqueCircuitIds)
  const anchorCircuit = (targetRcd.circuits ?? []).find(
    (circuit) => !selectedIds.has(circuit.id)
  )
  if (!anchorCircuit) return null
  // Repair a previous bad move by removing selected children from the RCD's
  // own list. They remain owned by their MCB protections and are grouped only
  // through the anchor's subCircuitIds.
  targetRcd.circuits = (targetRcd.circuits ?? []).filter(
    (circuit) => !selectedIds.has(circuit.id)
  )
  const nestedOrder = (anchorCircuit.subCircuitIds ?? []).filter(
    (circuitId) => !selectedIds.has(circuitId)
  )
  const nestedInsertIndex = Math.max(
    0,
    Math.min(insertIndex, nestedOrder.length)
  )
  nestedOrder.splice(nestedInsertIndex, 0, ...uniqueCircuitIds)
  anchorCircuit.subCircuitIds = nestedOrder

  return { panelId, rcdProtectionId, circuitIds: uniqueCircuitIds }
}

/** Move a secondary-panel attachment directly onto its source panel's main bus. */
export function movePanelAttachmentToMainBus(
  panels: Panel[],
  targetPanelId: string,
  sourcePanelId: string,
  insertIndex: number
): MovePanelAttachmentResult | null {
  const link = resolvePanelSupplyLinkForPanelInPanels(panels, targetPanelId)
  if (!link?.feederCircuit || link.sourcePanel.id !== sourcePanelId) return null
  if (
    !isPanelAttachmentDropTargetTerminal(panels, targetPanelId, {
      type: 'mainBus',
      panelId: sourcePanelId,
      mainBusInsertIndex: insertIndex,
    })
  ) {
    return null
  }

  let feederCircuit = link.feederCircuit
  let directProtection = link.protection

  if (!directProtection.directPanelFeeder) {
    const parentInfo = findParentCircuitInfo(feederCircuit.id, panels)
    if (!parentInfo) {
      feederCircuit = createDirectFeederCircuit(feederCircuit, link.targetPanel)
    }
    detachFeederFromCurrentLocation(panels, link.protection, feederCircuit)
    directProtection = {
      id: generateId(),
      type: 'OTHER',
      label: '',
      circuits: [feederCircuit],
      subPanelId: targetPanelId,
      directPanelFeeder: true,
    }
    link.sourcePanel.protections.push(directProtection)
  }

  removeFeederFromGroupingProtections(panels, feederCircuit.id, directProtection.id)
  moveProtectionToMainBusInsertIndex(link.sourcePanel, directProtection.id, insertIndex)

  return {
    sourcePanelId: link.sourcePanel.id,
    feederCircuitId: feederCircuit.id,
  }
}
