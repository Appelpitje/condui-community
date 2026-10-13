import {
  canDuplicateEendraadSelection,
  runEendraadDuplicate,
} from '@/lib/eendraad/duplicateSelection'
import { canDuplicatePlanSelection, runPlanDuplicate } from '@/lib/plan/planDuplicateSelection'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import {
  createSyncSupplyInverterMultiplierDeps,
  syncSupplyDeviceMultiplierCount,
} from '@/lib/eendraad/syncSupplyInverterMultiplier'
import {
  createSyncEndpointMultiplierDeps,
  syncEndpointMultiplierCount,
} from '@/lib/eendraad/syncEndpointMultiplierCount'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * Duplicates the current selection. On the situation plan (or with placements selected)
 * the plan duplicate wins; otherwise the one-wire duplicate runs.
 */
export function duplicateSelection(panelIndex: number | null): boolean {
  const selection = useUIStore.getState().selection
  const store = useProjectStore.getState()
  const ui = useUIStore.getState()
  const hoveredCanvas =
    panelIndex != null ? ui.viewportLayout.panels[panelIndex]?.canvas : undefined
  const planGetters = {
    getEndpointById: store.getEndpointById,
    getPlacementById: store.getPlacementById,
    getPlacementsByFloor: store.getPlacementsByFloor,
    findCircuitForEndpoint: store.findCircuitForEndpoint,
    getPanelById: store.getPanelById,
    getPanelByName: store.getPanelByName,
    getAllEndpoints: store.getAllEndpoints,
    getCurrentProject: () => store.currentProject,
  }
  const preferPlanDuplicate = hoveredCanvas === 'plan' || selection.type === 'placement'
  if (preferPlanDuplicate && canDuplicatePlanSelection(selection, planGetters, ui.activeFloorId)) {
    const planDupResult = runPlanDuplicate(selection, ui.activeFloorId)
    if (planDupResult) {
      ui.setSelection(planDupResult)
      return true
    }
  }

  const getters = {
    getEndpointById: store.getEndpointById,
    getCircuitById: store.getCircuitById,
    findCircuitForEndpoint: store.findCircuitForEndpoint,
    getTrunkDeviceById: store.getTrunkDeviceById,
    getProtectionById: store.getProtectionById,
    getCurrentProject: () => store.currentProject,
    getSupplyTrunkDeviceIndex: (id: string) =>
      (store.currentProject
        ? getProjectElectricalInstallation(store.currentProject)
        : undefined
      )?.mainSupply?.supplyTrunkDevices?.findIndex((d: { id: string }) => d.id === id) ?? -1,
    getGroundTrunkDeviceIndex: (id: string) =>
      store.currentProject
        ? (findGroundTrunkDeviceOwner(
            getProjectElectricalPanels(store.currentProject),
            getProjectElectricalInstallation(store.currentProject),
            id
          )?.index ?? -1)
        : -1,
  }
  if (!canDuplicateEendraadSelection(selection, getters)) return false
  const dupResult = runEendraadDuplicate(
    selection,
    getters,
    {
      addEndpoint: store.addEndpoint,
      syncEndpointMultiplierCount: (endpointId: string, count: number) =>
        syncEndpointMultiplierCount(createSyncEndpointMultiplierDeps(), endpointId, count),
      addCircuit: store.addCircuit,
      addTrunkDevice: store.addTrunkDevice,
      updateTrunkDevice: store.updateTrunkDevice,
      addSupplyTrunkDevice: store.addSupplyTrunkDevice,
      syncSupplyDeviceMultiplierCount: (deviceId: string, count: number) =>
        syncSupplyDeviceMultiplierCount(createSyncSupplyInverterMultiplierDeps(), deviceId, count),
      addGroundTrunkDevice: store.addGroundTrunkDevice,
      insertProtectionAfter: store.insertProtectionAfter,
      updateCircuit: store.updateCircuit,
      setSelection: useUIStore.getState().setSelection,
    },
    (protectionId) => store.duplicateProtectionLeft(protectionId),
    (fn, opts) => store.withSingleUndoEntry(fn, opts)
  )
  if (!dupResult) return false
  useUIStore.getState().setSelection(dupResult.selection)
  return true
}
