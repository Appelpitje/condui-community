import { updateCircuitTrunkPropertiesInProject } from '@/lib/properties/electricalPropertyMutations'
import { moveSupplyTrunkDeviceInProject } from '@/lib/panel/panelRewireMutations'
import { deleteSupplyTrunkDeviceInProject } from '@/lib/eendraad/deviceDeletion'
import { deleteTrunkDeviceInProject } from '@/lib/eendraad/deviceDeletion'
import { deleteCircuitFromProject } from '@/lib/eendraad/circuitMutations'
import { appendUndoSnapshotInStore, captureProjectForHistory, projectHistory } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'

import { addCircuitToProject, addTrunkDeviceToProject, updateCircuitInProject } from '@/lib/eendraad/circuitMutations'


import { findCircuitById, findPanelContainingCircuit, getAllCircuits, rewriteRelocatedCircuitTrunkDeviceGridRef } from '@/lib/eendraad/projectElectricalDomain'
import { logTrunkDnDCommit, summarizeDropTarget, trunkDnDCommitLogEnabled } from '@/lib/eendraad/trunkDeviceDnDLog'


import { mutateTrunkDeviceRelocation } from '@/lib/layout/eendraadPreviewSimulation'
import { logger } from '@/lib/logger'




import { addCircuitToProtectionInProject, addSupplyTrunkDeviceInProject, updateSupplyTrunkDeviceInProject } from '@/lib/projectMutations/storeActions'
import { getEditableProjectElectricalPanels, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { reconcileDirectConverterDcDevices, reconcileSupplyAssemblyBranchProtections } from '@/lib/supplyAssembly/editorIntegration'
import { getSymbolById } from '@/lib/symbols'
import type { Panel } from '@/types/schema'

/** Renumber circuits whose numbered trunk switches were added, removed or moved. */
function syncCircuitPointLabels(panels: Panel[], circuitIds: Array<string | undefined>): void {
  for (const circuitId of new Set(circuitIds)) {
    if (!circuitId) continue
    for (const panel of panels) {
      const result = findCircuitById(panel, circuitId)
      if (!result) continue
      syncSequentialEndpointBranchLabelsToCircuit(result.circuit, panel)
      break
    }
  }
}

export const createCircuitTrunkSlice: ProjectSliceCreator = (set, get) => ({
  // Circuit actions
  addCircuit: (panelId, circuit, protectionId) =>
    set((state) => {
      if (
        state.currentProject &&
        addCircuitToProject(state.currentProject, panelId, circuit, protectionId)
      ) {
        state.isDirty = true
      }
    }),

  addCircuitToProtection: (panelId, protectionId, circuit) =>
    set((state) => {
      if (!state.currentProject) return
      const result = addCircuitToProtectionInProject(
        state.currentProject,
        panelId,
        protectionId,
        circuit
      )
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  updateCircuit: (id, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const updatedCircuitId = updateCircuitInProject(state.currentProject, id, updates)
      if (!updatedCircuitId) return
      state.lastWorkedCircuitId = updatedCircuitId
      state.isDirty = true
    }),

  deleteCircuit: (id) =>
    set((state) => {
      const label = state.currentProject && getEditableProjectElectricalPanels(state.currentProject)
        .map((panel) => findCircuitById(panel, id)?.circuit.code?.trim()).find(Boolean)
      if (state.currentProject && deleteCircuitFromProject(state.currentProject, id)) {
        state.isDirty = true
        recordSessionAction(`delete circuit "${label || id}"`)
      }
    }),

  // Trunk device actions
  addTrunkDevice: (circuitId, device) =>
    set((state) => {
      if (
        state.currentProject &&
        addTrunkDeviceToProject(state.currentProject, circuitId, device)
      ) {
        state.isDirty = true
      }
    }),

  updateTrunkDevice:(circuitId,deviceId,updates)=>set(state=>{
    if(state.currentProject && updateCircuitTrunkPropertiesInProject(state.currentProject,circuitId,deviceId,updates))state.isDirty=true
  }),

  deleteTrunkDevice: (circuitId, deviceId) =>
    set((state) => {
      if (state.currentProject && deleteTrunkDeviceInProject(state.currentProject, circuitId, deviceId)) state.isDirty = true
    }),

  moveTrunkDeviceInCircuit: (circuitId, deviceId, direction, parentCircuitId) => {
    set((state) => {
      logger.info('[moveTrunkDeviceInCircuit]', {
        circuitId,
        deviceId,
        direction,
        parentCircuitId,
      })
      if (!state.currentProject) {
        logger.warn('[moveTrunkDeviceInCircuit] No current project')
        return
      }

      // If parentCircuitId is provided, this is a single nested circuit case
      // We need to move devices between parent and nested circuits
      if (parentCircuitId) {
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const nestedResult = findCircuitById(panel, circuitId)
          const parentResult = findCircuitById(panel, parentCircuitId)

          if (!nestedResult || !parentResult) continue

          const nestedCircuit = nestedResult.circuit
          const parentCircuit = parentResult.circuit

          // Get all devices from both circuits
          const nestedDevices = nestedCircuit.trunkDevices || []
          const parentDevices = parentCircuit.trunkDevices || []

          // Combine and sort by trunkPosition
          const allDevices = [...parentDevices, ...nestedDevices]
          const sorted = [...allDevices].sort(
            (a, b) => (a.trunkPosition || 0) - (b.trunkPosition || 0)
          )
          const index = sorted.findIndex((d) => d.id === deviceId)

          if (index === -1) {
            logger.warn('[moveTrunkDeviceInCircuit] Device not found in combined list', {
              deviceId,
              circuitId,
              parentCircuitId,
            })
            return
          }

          logger.info('[moveTrunkDeviceInCircuit] Found device in combined list', {
            index,
            total: sorted.length,
            isInParent: parentDevices.some((d) => d.id === deviceId),
            isInNested: nestedDevices.some((d) => d.id === deviceId),
          })

          if (
            direction === 'up' &&
            (index > 0 || (index === 0 && parentDevices.length === 0 && nestedDevices.length > 0))
          ) {
            // Special case: moving from nested to empty parent (index 0, parent empty)
            if (index === 0 && parentDevices.length === 0 && nestedDevices.length > 0) {
              // Move first nested device to parent
              const device = nestedDevices.find((d) => d.id === deviceId)!
              const idx = nestedDevices.indexOf(device)
              nestedDevices.splice(idx, 1)
              if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
              parentCircuit.trunkDevices.push(device)
              // Set trunkPosition to 0 for the first device in parent
              device.trunkPosition = 0
              logger.info('[moveTrunkDeviceInCircuit] Moved from nested to empty parent', {
                deviceId,
              })
              state.isDirty = true
              return
            }

            // Normal case: swap with previous device
            const prevDevice = sorted[index - 1]
            const currentDevice = sorted[index]
            if (!prevDevice || !currentDevice) return

            // Swap positions
            const tempPos = currentDevice.trunkPosition || 0
            currentDevice.trunkPosition = prevDevice.trunkPosition || 0
            prevDevice.trunkPosition = tempPos

            // If device moved from nested to parent or vice versa, update which circuit it belongs to
            const wasInParent = parentDevices.some((d) => d.id === deviceId)
            const prevWasInParent = parentDevices.some((d) => d.id === prevDevice.id)

            if (wasInParent && !prevWasInParent) {
              // Moving from parent to nested
              const device = parentDevices.find((d) => d.id === deviceId)!
              const idx = parentDevices.indexOf(device)
              parentDevices.splice(idx, 1)
              if (!nestedCircuit.trunkDevices) nestedCircuit.trunkDevices = []
              nestedCircuit.trunkDevices.push(device)
            } else if (!wasInParent && prevWasInParent) {
              // Moving from nested to parent
              const device = nestedDevices.find((d) => d.id === deviceId)!
              const idx = nestedDevices.indexOf(device)
              nestedDevices.splice(idx, 1)
              if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
              parentCircuit.trunkDevices.push(device)
            }

            logger.info('[moveTrunkDeviceInCircuit] Moved up in combined list', {
              newIndex: index - 1,
            })
            state.isDirty = true
            return
          } else if (direction === 'down' && index < sorted.length - 1) {
            const nextDevice = sorted[index + 1]
            const currentDevice = sorted[index]
            if (!nextDevice || !currentDevice) return

            // Swap positions
            const tempPos = currentDevice.trunkPosition || 0
            currentDevice.trunkPosition = nextDevice.trunkPosition || 0
            nextDevice.trunkPosition = tempPos

            // If device moved from nested to parent or vice versa, update which circuit it belongs to
            const wasInParent = parentDevices.some((d) => d.id === deviceId)
            const nextWasInParent = parentDevices.some((d) => d.id === nextDevice.id)

            if (wasInParent && !nextWasInParent) {
              // Moving from parent to nested
              const device = parentDevices.find((d) => d.id === deviceId)!
              const idx = parentDevices.indexOf(device)
              parentDevices.splice(idx, 1)
              if (!nestedCircuit.trunkDevices) nestedCircuit.trunkDevices = []
              nestedCircuit.trunkDevices.push(device)
            } else if (!wasInParent && nextWasInParent) {
              // Moving from nested to parent
              const device = nestedDevices.find((d) => d.id === deviceId)!
              const idx = nestedDevices.indexOf(device)
              nestedDevices.splice(idx, 1)
              if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
              parentCircuit.trunkDevices.push(device)
            }

            logger.info('[moveTrunkDeviceInCircuit] Moved down in combined list', {
              newIndex: index + 1,
            })
            state.isDirty = true
            return
          } else {
            logger.info('[moveTrunkDeviceInCircuit] Cannot move in combined list', {
              direction,
              index,
              length: sorted.length,
            })
          }
        }
        return
      }

      // Normal case: just move within a single circuit
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const result = findCircuitById(panel, circuitId)
        if (result && result.circuit.trunkDevices) {
          const devices = result.circuit.trunkDevices
          // Sort by trunkPosition to get current order
          const sorted = [...devices].sort(
            (a, b) => (a.trunkPosition || 0) - (b.trunkPosition || 0)
          )
          const index = sorted.findIndex((d) => d.id === deviceId)
          if (index === -1) {
            logger.warn('[moveTrunkDeviceInCircuit] Device not found', { deviceId, circuitId })
            return
          }
          logger.info('[moveTrunkDeviceInCircuit] Found device', { index, total: sorted.length })

          if (direction === 'up' && index > 0) {
            // Move up (earlier position = lower trunkPosition)
            const prevDevice = sorted[index - 1]
            const currentDevice = sorted[index]
            if (!prevDevice || !currentDevice) return
            const tempPos = currentDevice.trunkPosition || 0
            currentDevice.trunkPosition = prevDevice.trunkPosition || 0
            prevDevice.trunkPosition = tempPos
            logger.info('[moveTrunkDeviceInCircuit] Moved up', {
              newIndex: index - 1,
              positions: sorted.map((d) => ({ id: d.id, pos: d.trunkPosition })),
            })
            state.isDirty = true
            return
          } else if (direction === 'down' && index < sorted.length - 1) {
            // Move down (later position = higher trunkPosition)
            const nextDevice = sorted[index + 1]
            const currentDevice = sorted[index]
            if (!nextDevice || !currentDevice) return
            const tempPos = currentDevice.trunkPosition || 0
            currentDevice.trunkPosition = nextDevice.trunkPosition || 0
            nextDevice.trunkPosition = tempPos
            logger.info('[moveTrunkDeviceInCircuit] Moved down', {
              newIndex: index + 1,
              positions: sorted.map((d) => ({ id: d.id, pos: d.trunkPosition })),
            })
            state.isDirty = true
            return
          } else {
            logger.info('[moveTrunkDeviceInCircuit] Cannot move', {
              direction,
              index,
              length: sorted.length,
            })
          }
        }
      }
    })
    set((state) => {
      if (!state.currentProject) return
      syncCircuitPointLabels(getEditableProjectElectricalPanels(state.currentProject), [
        circuitId,
        parentCircuitId,
      ])
    })
  },

  relocateCircuitTrunkDevice: (deviceId, dropTarget): boolean => {
    const projectBefore = get().currentProject
    if (!projectBefore) return false
    const snapshotBefore = captureProjectForHistory(projectBefore)
    let ok: boolean = false
    let sourceCircuitIdForLog: string | undefined
    projectHistory.suppressNextDebouncedRun()
    try {
      set((state) => {
        if (!state.currentProject) return
        let sourceCircuitId: string | undefined
        let symbolKey: string | undefined
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          for (const c of getAllCircuits(panel)) {
            const d = c.trunkDevices?.find((x) => x.id === deviceId)
            if (d) {
              sourceCircuitId = c.id
              symbolKey = d.symbol
              break
            }
          }
          if (sourceCircuitId) break
        }
        if (!sourceCircuitId || !symbolKey) return
        sourceCircuitIdForLog = sourceCircuitId
        const symbol = getSymbolById(symbolKey)
        if (!symbol) return
        ok = mutateTrunkDeviceRelocation(
          state.currentProject,
          { id: deviceId, sourceCircuitId },
          dropTarget,
          symbol
        )
        if (ok) {
          if (
            (dropTarget.type === 'circuit' || dropTarget.type === 'endpoint') &&
            dropTarget.circuitId
          ) {
            rewriteRelocatedCircuitTrunkDeviceGridRef(
              state.currentProject,
              deviceId,
              sourceCircuitId,
              dropTarget.circuitId,
              dropTarget.type === 'endpoint' ? 'endpoint' : 'trunkDevice'
            )
          } else if (dropTarget.type === 'supplyConverterDcWire') {
            const sourcePanel = getProjectElectricalPanels(state.currentProject)
              .map((panel) => findPanelContainingCircuit(panel, sourceCircuitId))
              .find((panel): panel is Panel => !!panel)
            for (const panelId of new Set([sourcePanel?.id, dropTarget.panelId])) {
              if (!panelId) continue
              reconcileDirectConverterDcDevices(state.currentProject, panelId)
              reconcileSupplyAssemblyBranchProtections(state.currentProject, panelId)
            }
          }
          state.isDirty = true
        }
      })
    } finally {
      projectHistory.clearDebouncedSuppression()
    }
    if (trunkDnDCommitLogEnabled()) {
      logTrunkDnDCommit('relocateCircuitTrunkDevice', {
        deviceId,
        ok,
        sourceCircuitId: sourceCircuitIdForLog,
        targetCircuitId: dropTarget.circuitId,
        dropTarget: summarizeDropTarget(dropTarget),
      })
    }
    if (ok) {
      appendUndoSnapshotInStore(set, snapshotBefore)
      recordSessionAction('relocate circuit trunk device')
    }
    return ok
  },

  // Supply trunk device actions (devices on the main supply wire)
  addSupplyTrunkDevice: (device, insertIndex, target) =>
    set((state) => {
      if (!state.currentProject) return
      const result = addSupplyTrunkDeviceInProject(
        state.currentProject,
        device,
        insertIndex,
        target
      )
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  updateSupplyTrunkDevice: (deviceId, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const result = updateSupplyTrunkDeviceInProject(state.currentProject, deviceId, updates)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  deleteSupplyTrunkDevice: (deviceId) =>
    set((state) => {
      if (state.currentProject && deleteSupplyTrunkDeviceInProject(state.currentProject, deviceId)) state.isDirty = true
    }),

  moveSupplyTrunkDevice: (deviceId, direction) =>
    set((state) => {
      if (state.currentProject && moveSupplyTrunkDeviceInProject(state.currentProject, deviceId, direction)) state.isDirty = true
    }),

})
