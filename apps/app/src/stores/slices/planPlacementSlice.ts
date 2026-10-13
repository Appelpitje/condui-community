import { updateGroundTrunkPropertiesInProject } from '@/lib/properties/electricalPropertyMutations'
import { deleteGroundTrunkDeviceInProject } from '@/lib/eendraad/deviceDeletion'
import { appendUndoSnapshotInStore, captureProjectForHistory, getProjectStoreApi, projectHistory } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'

import { deleteEndpointsFromProject } from '@/lib/eendraad/endpointDeletion'
import { syncDerivedEndpointFlags } from '@/lib/eendraad/endpointInsertAfter'
import { assignEndpointsToCircuitInProject, addEndpointToProject, addEndpointWithPlacementToProject } from '@/lib/eendraad/endpointMutations'


import { findCircuitById, findEndpointById, getAllCircuits, getAllEndpoints, normalizeDomoticaCircuit } from '@/lib/eendraad/projectElectricalDomain'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { inheritEendraadLayoutForVisualEndpointChange } from '@/lib/layout/eendraadDerivedLayout'
import { logger } from '@/lib/logger'
import { setAuxiliaryEnclosureShownOnPlan } from '@/lib/plan/auxiliaryEnclosurePlanPlacement'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { addPlacementToProject, deletePlacementsFromProject, ensureJunctionPanelPlacementForLabelInProject, movePlanPlacementsToFloorInProject, updateEarthingPlacementInProject, updateJunctionPanelPlacementInProject, updatePlacementInProject } from '@/lib/plan/placementMutations'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { addEarthingPlacementInProject, addGroundTrunkDeviceInProject, deleteEndpointInProject, ensureSecondaryPanelEarthingStemInProject, updateEndpointInProject } from '@/lib/projectMutations/storeActions'
import { getEditableProjectElectricalInstallation, getEditableProjectElectricalPanels, getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { removeSupplyDevicePlacements } from '@/lib/supplyAssembly/inverterMultipliers'
import type { Endpoint } from '@/types/schema'

export const createPlanPlacementSlice: ProjectSliceCreator = (set, get) => ({
  // Ground trunk device actions (devices on the ground wire)
  addGroundTrunkDevice: (device, insertIndex, panelId) =>
    set((state) => {
      if (!state.currentProject) return
      const result = addGroundTrunkDeviceInProject(
        state.currentProject,
        device,
        insertIndex,
        panelId
      )
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  updateGroundTrunkDevice:(deviceId,updates)=>set(state=>{
    if(state.currentProject && updateGroundTrunkPropertiesInProject(state.currentProject,deviceId,updates))state.isDirty=true
  }),

  deleteGroundTrunkDevice: (deviceId) =>
    set((state) => {
      if (state.currentProject && deleteGroundTrunkDeviceInProject(state.currentProject, deviceId)) state.isDirty = true
    }),

  ensureSecondaryPanelEarthingStem: (panelId) =>
    set((state) => {
      if (!state.currentProject) return
      const result = ensureSecondaryPanelEarthingStemInProject(state.currentProject, panelId)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  ensureJunctionPanelPlacementForLabel: (label, floorId) =>
    set((state) => {
      if (
        state.currentProject &&
        ensureJunctionPanelPlacementForLabelInProject(state.currentProject, label, floorId)
      ) {
        state.isDirty = true
      }
    }),

  addJunctionPanelPlacement: (placement) =>
    set((state) => {
      if (state.currentProject) {
        const installation = getProjectElectricalInstallation(state.currentProject)
        if (!installation) return
        if (!installation.junctionPanelPlacements) {
          installation.junctionPanelPlacements = []
        }
        installation.junctionPanelPlacements.push(placement)
        state.isDirty = true
      }
    }),

  updateJunctionPanelPlacement: (id, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateJunctionPanelPlacementInProject(state.currentProject, id, updates)
      ) {
        state.isDirty = true
      }
    }),

  removeJunctionPanelPlacement: (id) =>
    set((state) => {
      if (state.currentProject) {
        const installation = getProjectElectricalInstallation(state.currentProject)
        if (!installation?.junctionPanelPlacements) return
        installation.junctionPanelPlacements = installation.junctionPanelPlacements.filter(
          (jp) => jp.id !== id
        )
        state.isDirty = true
      }
    }),

  addEarthingPlacement: (placement) =>
    set((state) => {
      if (!state.currentProject) return
      const result = addEarthingPlacementInProject(state.currentProject, placement)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  setAuxiliaryEnclosureShownOnPlan: (enclosureId, shown) =>
    set((state) => {
      if (!state.currentProject) return
      if (setAuxiliaryEnclosureShownOnPlan(state.currentProject, enclosureId, shown)) {
        state.isDirty = true
      }
    }),

  updateEarthingPlacement: (id, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateEarthingPlacementInProject(state.currentProject, id, updates)
      ) {
        state.isDirty = true
      }
    }),

  removeEarthingPlacement: (id) =>
    set((state) => {
      const inst = state.currentProject
        ? getProjectElectricalInstallation(state.currentProject)
        : undefined
      if (!inst?.earthingPlacements) return
      inst.earthingPlacements = inst.earthingPlacements.filter((p) => p.id !== id)
      state.isDirty = true
    }),

  getJunctionPanelPlacementByLabel: (label) => {
    const project = getProjectStoreApi().getState().currentProject
    return getProjectElectricalInstallation(project ?? {})?.junctionPanelPlacements?.find(
      (jp) => jp.label === label
    )
  },

  // Endpoint actions
  addEndpoint: (circuitId, endpoint, insertAfterEndpointId, branchOpts) =>
    set((state) => {
      if (!state.currentProject) return
      const circuitIdAdded = addEndpointToProject(
        state.currentProject,
        circuitId,
        endpoint,
        insertAfterEndpointId,
        branchOpts
      )
      if (!circuitIdAdded) return
      state.lastWorkedCircuitId = circuitIdAdded
      state.isDirty = true
    }),

  addEndpointWithPlacement: (circuitId, endpoint, placement, insertAfterEndpointId, branchOpts) => {
    const projectBefore = get().currentProject
    if (!projectBefore) return
    const snapshotBefore = captureProjectForHistory(projectBefore)
    // Prevent split history entries (endpoint first, placement second).
    projectHistory.clearPending()
    projectHistory.runWithoutRecording(() => {
      set((state) => {
        if (!state.currentProject) return
        const placementId = addEndpointWithPlacementToProject(
          state.currentProject,
          circuitId,
          endpoint,
          placement,
          insertAfterEndpointId,
          branchOpts
        )
        if (!placementId) return
        state.lastWorkedCircuitId = circuitId
        state.isDirty = true
      })
    })
    appendUndoSnapshotInStore(set, snapshotBefore)
    recordSessionAction('add endpoint with placement')
  },

  moveEndpointToCircuit: (endpointId, targetCircuitId) =>
    set((state) => {
      if (!state.currentProject) return
      const result = assignEndpointsToCircuitInProject(
        state.currentProject,
        [endpointId],
        targetCircuitId
      )
      if (!result) return
      state.lastWorkedCircuitId = result.targetCircuitId
      state.isDirty = true
    }),

  updateEndpoint: (id, updates: Partial<Endpoint> & { circuitId?: string }) => {
    const previousProject = get().currentProject
    const isLayoutNeutralSocketOverlayUpdate =
      Object.keys(updates).every((key) => key === 'socketProps') &&
      updates.socketProps != null &&
      !Object.prototype.hasOwnProperty.call(updates.socketProps, 'socketCount')
    set((state) => {
      if (!state.currentProject) return
      const result = updateEndpointInProject(state.currentProject, id, updates)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    })
    const nextProject = get().currentProject
    if (
      isLayoutNeutralSocketOverlayUpdate &&
      previousProject &&
      nextProject &&
      previousProject !== nextProject
    ) {
      inheritEendraadLayoutForVisualEndpointChange(previousProject, nextProject)
    }
  },

  deleteEndpoint: (id) =>
    set((state) => {
      if (!state.currentProject) return
      const result = deleteEndpointInProject(state.currentProject, id)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  moveEndpointInBranch: (endpointId, direction) =>
    set((state) => {
      logger.info('[moveEndpointInBranch]', { endpointId, direction })
      if (!state.currentProject) {
        logger.warn('[moveEndpointInBranch] No current project')
        return
      }
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const result = findEndpointById(panel, endpointId)
        if (result && result.circuit.branches) {
          const branch = result.circuit.branches.find((b) => b.endpointIds.includes(endpointId))
          if (branch) {
            const index = branch.endpointIds.indexOf(endpointId)
            logger.info('[moveEndpointInBranch] Found branch', {
              branchId: branch.id,
              index,
              total: branch.endpointIds.length,
            })
            if (direction === 'left' && index > 0) {
              // Move left (earlier in array)
              const temp = branch.endpointIds[index]!
              branch.endpointIds[index] = branch.endpointIds[index - 1]!
              branch.endpointIds[index - 1] = temp
              logger.info('[moveEndpointInBranch] Moved left', {
                newIndex: index - 1,
                newOrder: branch.endpointIds,
              })
              syncDerivedEndpointFlags(result.circuit)
              healPlanWiring(state.currentProject)
              state.isDirty = true
              return
            } else if (direction === 'right' && index < branch.endpointIds.length - 1) {
              // Move right (later in array)
              const temp = branch.endpointIds[index]!
              branch.endpointIds[index] = branch.endpointIds[index + 1]!
              branch.endpointIds[index + 1] = temp
              logger.info('[moveEndpointInBranch] Moved right', {
                newIndex: index + 1,
                newOrder: branch.endpointIds,
              })
              syncDerivedEndpointFlags(result.circuit)
              healPlanWiring(state.currentProject)
              state.isDirty = true
              return
            } else {
              logger.info('[moveEndpointInBranch] Cannot move', {
                direction,
                index,
                length: branch.endpointIds.length,
              })
            }
          } else {
            logger.warn('[moveEndpointInBranch] Endpoint not found in any branch')
          }
        }
      }
    }),

  moveDomoticaChildOutput: (endpointId, direction) =>
    set((state) => {
      if (!state.currentProject) return
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const result = findEndpointById(panel, endpointId)
        if (!result) continue
        const { endpoint: child, circuit } = result
        const ref = child.domoticaChildProps
        if (!ref) return
        const parent = circuit.endpoints.find((e) => e.id === ref.parentEndpointId)
        if (!parent?.domoticaProps) return
        const ids: string[] = [...(parent.domoticaProps.endpointChildEndpointIds ?? [])]
        const index = ids.indexOf(endpointId)
        if (index === -1) return
        if (direction === 'up' && index > 0) {
          const prevId = ids[index - 1]
          if (!prevId) return
          ids[index] = prevId
          ids[index - 1] = endpointId
        } else if (direction === 'down' && index < ids.length - 1) {
          const nextId = ids[index + 1]
          if (!nextId) return
          ids[index] = nextId
          ids[index + 1] = endpointId
        } else return
        const nextProps = {
          ...parent.domoticaProps,
          endpointChildEndpointIds: ids,
        }
        parent.domoticaProps = nextProps
        normalizeDomoticaCircuit(circuit)
        state.isDirty = true
        return
      }
    }),

  normalizeDomoticaForCircuit: (circuitId) =>
    set((state) => {
      if (!state.currentProject) return
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const result = findCircuitById(panel, circuitId)
        if (result) {
          normalizeDomoticaCircuit(result.circuit)
          state.isDirty = true
          return
        }
      }
    }),

  deleteEndpoints: (ids) =>
    set((state) => {
      if (state.currentProject && deleteEndpointsFromProject(state.currentProject, ids)) {
        state.isDirty = true
      }
    }),

  // Placement actions
  addPlacement: (endpointId, placement) =>
    set((state) => {
      if (!state.currentProject) return
      const circuitId = addPlacementToProject(state.currentProject, endpointId, placement)
      if (!circuitId) return
      state.lastWorkedCircuitId = circuitId
      state.isDirty = true
    }),

  updatePlacement: (id, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const updated = updatePlacementInProject(state.currentProject, id, updates)
      if (!updated) return
      if (updated.circuitId) state.lastWorkedCircuitId = updated.circuitId
      state.isDirty = true
    }),

  updatePlacementsBatch: (updates) =>
    set((state) => {
      if (!state.currentProject || updates.length === 0) return
      let applied = false
      for (const { id, updates: patch } of updates) {
        const updated = updatePlacementInProject(state.currentProject, id, patch)
        if (!updated) continue
        if (updated.circuitId) state.lastWorkedCircuitId = updated.circuitId
        applied = true
      }
      if (applied) state.isDirty = true
    }),

  movePlanPlacementsToFloor: (moves, floorId) => {
    let applied = false
    set((state) => {
      if (!state.currentProject) return
      applied = movePlanPlacementsToFloorInProject(state.currentProject, moves, floorId)
      if (applied) state.isDirty = true
    })
    return applied
  },

  deletePlacement: (id) =>
    set((state) => {
      const inst = state.currentProject
        ? getEditableProjectElectricalInstallation(state.currentProject)
        : undefined
      if (inst?.earthingPlacements?.some((p) => p.id === id)) {
        inst.earthingPlacements = inst.earthingPlacements.filter((p) => p.id !== id)
        state.isDirty = true
        return
      }
      if (state.currentProject) {
        for (const device of getAllSupplyTrunkDevices(state.currentProject)) {
          const index = device.placements?.findIndex((placement) => placement.id === id) ?? -1
          if (index === -1) continue
          if (!removeSupplyDevicePlacements(device, new Set([id]))) {
            device.placements!.splice(index, 1)
          }
          state.isDirty = true
          return
        }
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const endpoints = getAllEndpoints(panel)
          for (const endpoint of endpoints) {
            const index = endpoint.placements.findIndex((p) => p.id === id)
            if (index !== -1) {
              if (isMainPanelDistributionEndpoint(state.currentProject, endpoint)) {
                logger.warn(
                  '[projectStore] deletePlacement blocked for main panel distribution symbol',
                  {
                    placementId: id,
                  }
                )
                return
              }
              endpoint.placements.splice(index, 1)
              healPlanWiring(state.currentProject)
              state.isDirty = true
              return
            }
          }
          for (const circuit of getAllCircuits(panel)) {
            for (const device of circuit.trunkDevices ?? []) {
              const index = device.placements?.findIndex((placement) => placement.id === id) ?? -1
              if (index === -1) continue
              device.placements!.splice(index, 1)
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  deletePlacements: (ids) =>
    set((state) => {
      if (state.currentProject && deletePlacementsFromProject(state.currentProject, ids)) {
        state.isDirty = true
      }
    }),

  deletePlacementsByEndpoint: (endpointId) =>
    set((state) => {
      if (state.currentProject) {
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const result = findEndpointById(panel, endpointId)
          if (result) {
            if (isMainPanelDistributionEndpoint(state.currentProject, result.endpoint)) {
              logger.warn(
                '[projectStore] deletePlacementsByEndpoint blocked for main panel distribution symbol',
                { endpointId }
              )
              return
            }
            result.endpoint.placements = []
            healPlanWiring(state.currentProject)
            state.isDirty = true
            return
          }
        }
      }
    }),
})
