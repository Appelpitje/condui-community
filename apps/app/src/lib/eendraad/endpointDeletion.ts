import type { ProjectV2 } from '@/types/projectV2'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import {
  cleanupPanelGridSlotsForDevice,
  collectDomoticaEndpointIdsForDeletion,
  deletePanelFromProject,
  findCircuitById,
  findCircuitOwner,
  findEndpointById,
  getAllCircuits,
  maybeApplyAutomaticEendraadNamingForPanel,
  normalizeDomoticaCircuit,
  pruneStaleElectricalEndpointRecords,
  removeEndpointIdsFromCircuit,
} from '@/lib/eendraad/projectElectricalDomain'
import { logger } from '@/lib/logger'
import { reconnectDeletedBranchInputs } from '@/lib/wires/reconnectDeletedBranchInputs'
import {
  isMainPanelDistributionEndpoint,
  resolvePanelForDistributionEndpoint,
} from '@/lib/plan/panelDistributionEndpoint'
import { healPlanWiring } from '@/lib/plan/planWiring'
import {
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'

/**
 * Deletes endpoints with everything that depends on them: domotica children, the sub-panel
 * behind a distribution symbol, panel grid slots, frames, plan wiring and stale records. The
 * main board's distribution symbol is never deleted. Returns false when nothing was deleted.
 * Shared by the store action and project commands.
 */
export function deleteEndpointsFromProject(project: ProjectV2, ids: readonly string[]): boolean {
  const panels = getProjectElectricalPanels(project)
  const filtered: string[] = ids.filter((id) => {
    for (const panel of panels) {
      const result = findEndpointById(panel, id)
      if (result && isMainPanelDistributionEndpoint(project, result.endpoint)) {
        logger.warn('[projectStore] deleteEndpoints skipped main panel distribution symbol', {
          endpointId: id,
        })
        return false
      }
    }
    return true
  })
  if (filtered.length === 0) return false
  const prunedMemberIds = new Set<string>(filtered)
  const panelIdsToDelete = new Set<string>()
  for (const endpointId of filtered) {
    for (const panel of getProjectElectricalPanels(project)) {
      const result = findEndpointById(panel, endpointId)
      if (!result) continue
      const removedIds = collectDomoticaEndpointIdsForDeletion(result.circuit, [endpointId])
      for (const removed of result.circuit.endpoints) {
        if (!removedIds.has(removed.id) || removed.symbol !== 'panel_distribution') continue
        const linkedPanel = resolvePanelForDistributionEndpoint(project, removed)
        if (linkedPanel && !linkedPanel.isMain) panelIdsToDelete.add(linkedPanel.id)
      }
    }
  }
  for (const panelId of panelIdsToDelete) {
    deletePanelFromProject(project, panelId)
  }
  const idsSet = new Set(filtered)
  const modifiedCircuitIds = new Set<string>()
  const mutablePanels = getEditableProjectElectricalPanels(project)
  for (const panel of mutablePanels) {
    const circuits = getAllCircuits(panel)
    for (const circuit of circuits) {
      const roots = circuit.endpoints
        .filter((endpoint) => idsSet.has(endpoint.id))
        .map((endpoint) => endpoint.id)
      const idsToDelete = collectDomoticaEndpointIdsForDeletion(circuit, roots)
      for (const endpoint of circuit.endpoints) {
        if (idsToDelete.has(endpoint.id) && endpoint.symbol === 'domotica') {
          for (const childId of idsToDelete) prunedMemberIds.add(childId)
          cleanupPanelGridSlotsForDevice(mutablePanels, {
            kind: 'domotica',
            endpointId: endpoint.id,
            circuitId: circuit.id,
          })
        }
      }

      const before = circuit.endpoints.length
      reconnectDeletedBranchInputs(project, circuit, idsToDelete)
      removeEndpointIdsFromCircuit(circuit, idsToDelete)
      if (circuit.endpoints.length !== before) {
        normalizeDomoticaCircuit(circuit)
        modifiedCircuitIds.add(circuit.id)
      }
    }
  }
  for (const circuitId of modifiedCircuitIds) {
    for (const panel of mutablePanels) {
      const found = findCircuitById(panel, circuitId)
      if (found) {
        syncSequentialEndpointBranchLabelsToCircuit(found.circuit)
        break
      }
    }
  }
  if (getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming) {
    const panelsToRename = new Set<string>()
    for (const circuitId of modifiedCircuitIds) {
      const owner = findCircuitOwner(mutablePanels, circuitId)
      if (owner) panelsToRename.add(owner.panel.id)
    }
    for (const panelId of panelsToRename) {
      maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
    }
  }
  pruneEendraadFrames(project, { removedMemberIds: prunedMemberIds })
  healPlanWiring(project)
  pruneStaleElectricalEndpointRecords(project)
  return true
}
