import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, TrunkDevice } from '@/types/schema'
import { collectCircuitFrameRemovalIds, pruneEendraadFrames } from './frameContent'
import { findParentCircuitInfo } from './findParentCircuitInfo'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { migrateEndpointLabelsAfterCircuitCodeChange } from '@/lib/eendraad/circuitEndpointLabels'
import {
  ensureRcboSensitivityOnTrunkDevice,
  findCircuitById,
  findPanelContainingCircuit,
  maybeApplyAutomaticEendraadNamingForPanel,
  migrateCircuitContentToParent,
  pruneStaleElectricalEndpointRecords,
  syncManualChronologyForInstallDateUpdate,
} from '@/lib/eendraad/projectElectricalDomain'
import { logger } from '@/lib/logger'
import { findPanelById } from '@/lib/panel/panelTree'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { healPlanWiring } from '@/lib/plan/planWiring'
import {
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
} from '@/lib/projectV2/electrical'

/** Removes a circuit through the same dependency handling as the store action. */
export function deleteCircuitFromProject(project: ProjectV2, id: string): boolean {
  const panels = getEditableProjectElectricalPanels(project)
  for (const root of panels) {
    const hit = findCircuitById(root, id)
    if (!hit) continue
    const owner = findPanelContainingCircuit(root, id)
    if (!owner) return false
    const frameRemoval = collectCircuitFrameRemovalIds(hit.circuit)
    const parentInfo = findParentCircuitInfo(id, panels)
    if (parentInfo) {
      migrateCircuitContentToParent(hit.circuit, parentInfo.parentCircuit)
      if ('type' in hit.parent && hit.parent.subPanelId && parentInfo.parentProtection) {
        parentInfo.parentProtection.subPanelId = hit.parent.subPanelId
        hit.parent.subPanelId = undefined
      }
    }
    const rows = 'type' in hit.parent ? hit.parent.circuits : owner.circuits
    const index = rows?.findIndex((circuit) => circuit.id === id) ?? -1
    if (!rows || index < 0) return false
    rows.splice(index, 1)
    pruneEendraadFrames(project, {
      removedMemberIds: frameRemoval.memberIds,
      removedCircuitIds: frameRemoval.circuitIds,
    })
    healPlanWiring(project)
    pruneStaleElectricalEndpointRecords(project)
    return true
  }
  return false
}

/**
 * Applies a circuit patch with its follow-ups: code changes relabel endpoints and the owning
 * protection, branch changes resync labels and plan wiring, automatic naming refreshes. Returns
 * the circuit id when something changed, otherwise null. Shared by the store action and project
 * commands.
 */
export function updateCircuitInProject(
  project: ProjectV2,
  id: string,
  updates: Partial<Circuit>
): string | null {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const result = findCircuitById(panel, id)
    if (result) {
      // Store getters return Immer-frozen snapshots. Shallow-clone nested rows so
      // in-place naming (e.g. duplicate → automatic A1/A2 labels) can mutate them.
      let appliedUpdates = updates
      if (Array.isArray(appliedUpdates.endpoints)) {
        appliedUpdates = {
          ...appliedUpdates,
          endpoints: appliedUpdates.endpoints.map((ep) => ({
            ...ep,
            placements: (ep.placements ?? []).map((p) => ({ ...p })),
          })),
        }
      }
      if (Array.isArray(appliedUpdates.branches)) {
        appliedUpdates = {
          ...appliedUpdates,
          branches: appliedUpdates.branches.map((b) => ({
            ...b,
            endpointIds: [...(b.endpointIds ?? [])],
            ...(b.branchDevices
              ? {
                  branchDevices: b.branchDevices.map((device) => ({
                    ...device,
                    placements: (device.placements ?? []).map((placement) => ({
                      ...placement,
                    })),
                  })),
                }
              : {}),
          })),
        }
      }

      // Fast no-op: if this update doesn't actually change anything, skip.
      let hasAnyChange = false
      for (const [k, v] of Object.entries(appliedUpdates)) {
        const key = k as keyof Circuit
        if (key === 'code') {
          const next = typeof v === 'string' ? v : ''
          const curr = typeof result.circuit.code === 'string' ? result.circuit.code : ''
          if (next !== curr) hasAnyChange = true
          continue
        }
        const circuitValue = result.circuit[key as keyof Circuit]
        if (!Object.is(circuitValue, v)) {
          hasAnyChange = true
          break
        }
      }
      if (!hasAnyChange) return null

      const oldCode = (result.circuit.code || '').trim()
      const newCode = typeof appliedUpdates.code === 'string' ? appliedUpdates.code.trim() : null

      if (newCode !== null && newCode !== oldCode) {
        migrateEndpointLabelsAfterCircuitCodeChange(result.circuit, oldCode, newCode)
        Object.assign(result.circuit, { ...appliedUpdates, code: newCode })
        if (result.parent && 'type' in result.parent && 'label' in result.parent) {
          result.parent.label = newCode
        }
      } else {
        Object.assign(result.circuit, appliedUpdates)
      }
      syncManualChronologyForInstallDateUpdate(project, { id, type: 'circuit' }, appliedUpdates)

      const branchTopologyChanged =
        Object.prototype.hasOwnProperty.call(appliedUpdates, 'branches') ||
        Object.prototype.hasOwnProperty.call(appliedUpdates, 'endpoints') ||
        Object.prototype.hasOwnProperty.call(appliedUpdates, 'trunkDevices') ||
        (newCode !== null && newCode !== oldCode)
      if (branchTopologyChanged) {
        syncSequentialEndpointBranchLabelsToCircuit(result.circuit)
        healPlanWiring(project)
      }

      // Nesting, endpoints, or branch topology changes: refresh automatic ééndraad naming
      // (main-bus letters only — branch numbers A1, A2, … are synced above).
      const needsAutoNamingRefresh =
        !!getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming &&
        (Object.prototype.hasOwnProperty.call(appliedUpdates, 'subCircuitIds') ||
          Object.prototype.hasOwnProperty.call(appliedUpdates, 'branches') ||
          Object.prototype.hasOwnProperty.call(appliedUpdates, 'endpoints'))
      if (needsAutoNamingRefresh) {
        for (const rootPanel of getEditableProjectElectricalPanels(project)) {
          const ownerPanel = findPanelContainingCircuit(rootPanel, id)
          if (ownerPanel) {
            maybeApplyAutomaticEendraadNamingForPanel(project, ownerPanel.id)
            break
          }
        }
      }

      return result.circuit.id
    }
  }
  return null
}

/**
 * Adds a circuit under a protection (or the panel's PANEL anchor circuit). Refuses orphan
 * circuits. Returns false when nothing was added.
 */
export function addCircuitToProject(
  project: ProjectV2,
  panelId: string,
  circuit: Circuit,
  protectionId?: string
): boolean {
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) return false
  const protection = protectionId
    ? panel.protections.find((candidate) => candidate.id === protectionId)
    : undefined
  if (protectionId && !protection) {
    logger.error('Refusing to create an orphan circuit: protection was not found', {
      panelId,
      protectionId,
      circuitId: circuit.id,
      circuitCode: circuit.code,
    })
    return false
  }
  if (!protectionId && circuit.code !== 'PANEL') {
    logger.error('Refusing to create an orphan circuit without a protection', {
      panelId,
      circuitId: circuit.id,
      circuitCode: circuit.code,
    })
    return false
  }
  if (!circuit.endpoints) circuit.endpoints = []
  if (protection) {
    if (!protection.circuits) protection.circuits = []
    protection.circuits.push(circuit)
  } else {
    // PANEL is the one supported direct circuit: it anchors a panel symbol on plan.
    panel.circuits.push(circuit)
  }
  maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
  return true
}

/** Inserts a trunk device by trunk position. False when the circuit is missing. */
export function addTrunkDeviceToProject(
  project: ProjectV2,
  circuitId: string,
  device: TrunkDevice
): boolean {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const result = findCircuitById(panel, circuitId)
    if (!result) continue
    if (!result.circuit.trunkDevices) result.circuit.trunkDevices = []
    ensureRcboSensitivityOnTrunkDevice(device)
    // The properties panel must not initialize a newly selected converter as a second edit.
    if (device.type === 'conversion') device.conversionProps ??= {}
    const insertIdx = result.circuit.trunkDevices.findIndex(
      (candidate) => candidate.trunkPosition > device.trunkPosition
    )
    if (insertIdx >= 0) result.circuit.trunkDevices.splice(insertIdx, 0, device)
    else result.circuit.trunkDevices.push(device)
    syncSequentialEndpointBranchLabelsToCircuit(result.circuit, panel)
    syncPanelAndSituationPlanDeviceVisibility(project)
    return true
  }
  return false
}
