import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, ProtectionDevice } from '@/types/schema'
import type { SitplanPlacementTarget } from '@/lib/eendraad/duplicateSitplanHelpers'
import {
  addCircuitToProject,
  addTrunkDeviceToProject,
  updateCircuitInProject,
} from '@/lib/eendraad/circuitMutations'
import type { DropBehaviorCallbacks } from '@/lib/eendraad/dropBehaviors'
import { addEndpointToProject } from '@/lib/eendraad/endpointMutations'
import { findCircuitById } from '@/lib/eendraad/projectElectricalDomain'
import { addProtectionToProject } from '@/lib/eendraad/protectionMutations'
import { emitDomainEvent } from '@/lib/domainEvents'
import {
  addPlacementToProject,
  ensureEarthingSitplanPlacementInProject,
  ensureJunctionPanelPlacementForLabelInProject,
} from '@/lib/plan/placementMutations'
import { walkPanels } from '@/lib/panel/panelTree'
import {
  addCircuitToProtectionInProject,
  addEendraadNoteInProject,
  addGroundTrunkDeviceInProject,
  addPanelInProject,
  addSupplyAssemblyInProject,
  addSupplyTrunkDeviceInProject,
  deleteEndpointInProject,
  deleteProtectionInProject,
  ensureSecondaryPanelEarthingStemInProject,
  moveCircuitOnMainBusInProject,
  moveCircuitToSecondaryBusInProject,
  replaceSupplyAssemblyInProject,
  updateEndpointInProject,
  updateFloorInProject,
  updateInstallationInProject,
  updateProtectionInProject,
  updateSupplyTrunkDeviceInProject,
} from '@/lib/projectMutations/storeActions'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'

// Direct traversal, not the cached lookup index: inside a draft the panel arrays keep their
// identity while their content changes.
function findCircuit(project: ProjectV2, circuitId: string): Circuit | null {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, circuitId)
    if (found) return found.circuit
  }
  return null
}

function findProtection(project: ProjectV2, protectionId: string): ProtectionDevice | null {
  for (const panel of walkPanels(getEditableProjectElectricalPanels(project))) {
    const protection = panel.protections.find((candidate) => candidate.id === protectionId)
    if (protection) return protection
  }
  return null
}

/**
 * Drop-engine callbacks that edit a project draft directly, for project commands. Each one runs
 * the same shared function as the matching store action, so a command drop changes the
 * project exactly like an editor drop. Selection is left to the UI adapter.
 */
export function createDraftDropBehaviorCallbacks(
  project: ProjectV2,
  sitplanTarget: SitplanPlacementTarget,
  overrides: Partial<DropBehaviorCallbacks> = {},
  language?: string
): DropBehaviorCallbacks {
  return {
    getSitplanTarget: () => sitplanTarget,
    getCircuitById: (circuitId) => findCircuit(project, circuitId),
    getProtectionById: (protectionId) => findProtection(project, protectionId),
    getFloorById: (floorId) => {
      const floor = readLegacyCompatibilityFloors(project).find((f) => f.id === floorId)
      return floor
        ? {
            id: floor.id,
            layers: floor.layers,
            hiddenSitplanPlacementIds: floor.hiddenSitplanPlacementIds,
          }
        : null
    },
    updateFloor: (floorId, updates) => {
      updateFloorInProject(project, floorId, updates, sitplanTarget.activePanelId)
    },
    addPanel: (panel, parentPanelId) => {
      addPanelInProject(
        project,
        panel,
        parentPanelId,
        sitplanTarget.activeFloorId ? (sitplanTarget.viewportCenter ?? undefined) : undefined
      )
    },
    addProtection: (panelId, protection) => {
      addProtectionToProject(project, panelId, protection)
    },
    addCircuit: (panelId, circuit, protectionId) => {
      addCircuitToProject(project, panelId, circuit, protectionId)
    },
    addCircuitToProtection: (panelId, protectionId, circuit) => {
      addCircuitToProtectionInProject(project, panelId, protectionId, circuit)
    },
    addEndpoint: (circuitId, endpoint, insertAfterEndpointId, branchOpts) => {
      addEndpointToProject(project, circuitId, endpoint, insertAfterEndpointId, branchOpts)
    },
    updateEndpoint: (endpointId, updates) => {
      updateEndpointInProject(project, endpointId, updates)
    },
    deleteEndpoint: (endpointId) => {
      deleteEndpointInProject(project, endpointId)
    },
    addPlacement: (endpointId, placement) => {
      addPlacementToProject(project, endpointId, placement)
    },
    addTrunkDevice: (circuitId, device) => {
      addTrunkDeviceToProject(project, circuitId, device)
    },
    addSupplyTrunkDevice: (device, insertIndex, target) => {
      addSupplyTrunkDeviceInProject(project, device, insertIndex, target)
    },
    updateSupplyTrunkDevice: (deviceId, updates) => {
      updateSupplyTrunkDeviceInProject(project, deviceId, updates)
    },
    addGroundTrunkDevice: (device, insertIndex, panelId) => {
      addGroundTrunkDeviceInProject(project, device, insertIndex, panelId)
    },
    ensureSecondaryPanelEarthingStem: (panelId) => {
      ensureSecondaryPanelEarthingStemInProject(project, panelId, language)
    },
    ensureEarthingSitplanPlacement: (floorId, pos) => {
      ensureEarthingSitplanPlacementInProject(project, floorId, pos)
    },
    ensureJunctionPanelPlacementForLabel: (label, floorId) => {
      ensureJunctionPanelPlacementForLabelInProject(project, label, floorId)
    },
    updateCircuit: (circuitId, updates) => {
      updateCircuitInProject(project, circuitId, updates)
    },
    updateProtection: (protectionId, updates) => {
      updateProtectionInProject(project, protectionId, updates)
    },
    deleteProtection: (protectionId) => {
      deleteProtectionInProject(project, protectionId)
    },
    updateInstallation: (updates) => {
      updateInstallationInProject(project, updates)
    },
    addSupplyAssembly: (assembly) => {
      if (addSupplyAssemblyInProject(project, assembly).changed) {
        emitDomainEvent({ type: 'supplyAssemblyCreated', assembly, source: 'project_command' })
      }
    },
    replaceSupplyAssembly: (id, assembly) => {
      if (replaceSupplyAssemblyInProject(project, id, assembly).changed) {
        emitDomainEvent({ type: 'supplyAssemblyReplaced', assembly, source: 'project_command' })
      }
    },
    moveCircuitOnMainBus: (panelId, circuitId, direction) => {
      moveCircuitOnMainBusInProject(project, panelId, circuitId, direction)
    },
    moveCircuitToSecondaryBus: (panelId, parentCircuitId, circuitId, insertIndex) => {
      moveCircuitToSecondaryBusInProject(project, panelId, parentCircuitId, circuitId, insertIndex)
    },
    addEendraadNote: (note) => {
      addEendraadNoteInProject(project, note)
    },
    setSelection: () => {},
    ...overrides,
  }
}
