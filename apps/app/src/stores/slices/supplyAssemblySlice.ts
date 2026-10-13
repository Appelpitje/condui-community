import type { ProjectSliceCreator } from './projectStoreTypes'
import { trackSupplyAssemblyMutation } from '@/lib/analytics/supplyAssemblyAnalytics'
import { MIN_AUXILIARY_COLUMNS, createAuxiliarySupplyEnclosure as createAuxiliarySupplyEnclosureInProject, deleteAuxiliarySupplyEnclosure as deleteAuxiliarySupplyEnclosureInProject, moveSupplyDeviceToAuxiliaryEnclosure as moveSupplyDeviceToAuxiliaryEnclosureInProject, moveSupplyDeviceToGridEnclosure as moveSupplyDeviceToGridEnclosureInProject, moveSupplyDeviceToPanelEnclosure as moveSupplyDeviceToPanelEnclosureInProject } from '@/lib/panel/auxiliarySupplyEnclosures'
import { reconcileInvalidPanelFeedOrganizationsInProject } from '@/lib/panel/panelFeedOrganization'
import { dismissEmptySharedSupplyFrame } from '@/lib/panel/sharedSupplyFrame'
import { addSupplyAssemblyInProject, replaceSupplyAssemblyInProject } from '@/lib/projectMutations/storeActions'
import { editProjectAuxiliaryElectricalEnclosures, editProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { disconnectSupplyInverterGridInputInProject } from '@/lib/supplyAssembly/disconnectInverterGridInput'
import type { ProjectV2 } from '@/types/projectV2'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'
import { generateId } from '@/utils'
import { current } from 'immer'

function markProjectChanged(state: { currentProject: ProjectV2 | null; isDirty: boolean }): void {
  if (!state.currentProject) return
  state.currentProject.project.updatedAt = new Date().toISOString()
  state.isDirty = true
}

export const createSupplyAssemblySlice: ProjectSliceCreator = (set, get) => ({
  dismissEmptySharedSupplyFrame: () => {
    get().withSingleUndoEntry(() => {
      let dismissed = false
      set((state) => {
        if (!state.currentProject) return
        dismissed = dismissEmptySharedSupplyFrame(state.currentProject)
        if (dismissed) markProjectChanged(state)
      })
      return dismissed
    }, { sessionLabel: 'delete empty supply frame' })
  },
  addSupplyAssembly: (assembly) => {
    let created = false
    set((state) => {
      if (!state.currentProject) return
      if (!addSupplyAssemblyInProject(state.currentProject, assembly).changed) return
      markProjectChanged(state)
      created = true
    })
    if (created) {
      trackSupplyAssemblyMutation('create', assembly, {
        source: 'project_store',
        storageMode: get().currentProjectStorageMode,
      })
    }
  },

  replaceSupplyAssembly: (id, assembly) => {
    let replaced = false
    set((state) => {
      if (!state.currentProject) return
      if (!replaceSupplyAssemblyInProject(state.currentProject, id, assembly).changed) return
      markProjectChanged(state)
      replaced = true
    })
    if (replaced) {
      trackSupplyAssemblyMutation('replace', assembly, {
        source: 'project_store',
        storageMode: get().currentProjectStorageMode,
      })
    }
  },

  deleteSupplyAssembly: (id) => {
    let deletedAssemblyForAnalytics: OffGridSupplyAssembly | null = null
    set((state) => {
      if (!state.currentProject) return
      const assemblies = editProjectSupplyAssemblies(state.currentProject)
      const index = assemblies.findIndex((assembly) => assembly.id === id)
      if (index < 0) return
      const deleted = assemblies[index]
      if (!deleted) return
      deletedAssemblyForAnalytics = current(deleted)
      assemblies.splice(index, 1)
      reconcileInvalidPanelFeedOrganizationsInProject(state.currentProject)
      markProjectChanged(state)
    })
    if (deletedAssemblyForAnalytics) {
      trackSupplyAssemblyMutation('delete', deletedAssemblyForAnalytics, {
        source: 'project_store',
        storageMode: get().currentProjectStorageMode,
      })
    }
  },

  addSupplyAssemblyNode: (assemblyId, node, oneWirePosition) =>
    set((state) => {
      if (!state.currentProject) return
      const assembly = editProjectSupplyAssemblies(state.currentProject).find(
        ({ id }) => id === assemblyId
      )
      if (!assembly || assembly.nodes.some(({ id }) => id === node.id)) return
      assembly.nodes.push(node)
      if (oneWirePosition) {
        assembly.oneWireGeometry ??= { nodePositions: {} }
        assembly.oneWireGeometry.nodePositions[node.id] = oneWirePosition
      }
      markProjectChanged(state)
    }),

  moveSupplyAssemblyNode: (assemblyId, nodeId, position) =>
    set((state) => {
      if (!state.currentProject) return
      const assembly = editProjectSupplyAssemblies(state.currentProject).find(
        ({ id }) => id === assemblyId
      )
      if (!assembly?.nodes.some(({ id }) => id === nodeId)) return
      assembly.oneWireGeometry ??= { nodePositions: {} }
      assembly.oneWireGeometry.nodePositions[nodeId] = position
      markProjectChanged(state)
    }),

  deleteSupplyAssemblyNode: (assemblyId, nodeId) =>
    set((state) => {
      if (!state.currentProject) return
      const assembly = editProjectSupplyAssemblies(state.currentProject).find(
        ({ id }) => id === assemblyId
      )
      if (!assembly) return
      const nodeIndex = assembly.nodes.findIndex(({ id }) => id === nodeId)
      if (nodeIndex < 0) return
      assembly.nodes.splice(nodeIndex, 1)
      assembly.connections = assembly.connections.filter(
        ({ endpoints }) => !endpoints.some((endpoint) => endpoint.nodeId === nodeId)
      )
      assembly.inverterGroups.forEach((group) => {
        group.unitNodeIds = group.unitNodeIds.filter((id) => id !== nodeId)
      })
      assembly.loadHandoffs = assembly.loadHandoffs.filter(
        ({ handoffNodeId }) => handoffNodeId !== nodeId
      )
      if (assembly.oneWireGeometry) {
        delete assembly.oneWireGeometry.nodePositions[nodeId]
        const remainingConnectionIds = new Set(assembly.connections.map(({ id }) => id))
        for (const connectionId of Object.keys(
          assembly.oneWireGeometry.connectionWaypoints ?? {}
        )) {
          if (!remainingConnectionIds.has(connectionId)) {
            delete assembly.oneWireGeometry.connectionWaypoints?.[connectionId]
          }
        }
      }
      reconcileInvalidPanelFeedOrganizationsInProject(state.currentProject)
      markProjectChanged(state)
    }),

  addSupplyAssemblyConnection: (assemblyId, connection) =>
    set((state) => {
      if (!state.currentProject) return
      const assembly = editProjectSupplyAssemblies(state.currentProject).find(
        ({ id }) => id === assemblyId
      )
      if (!assembly || assembly.connections.some(({ id }) => id === connection.id)) return
      const endpointsExist = connection.endpoints.every((endpoint) => {
        const node = assembly.nodes.find(({ id }) => id === endpoint.nodeId)
        return node?.ports.some(({ id }) => id === endpoint.portId)
      })
      if (!endpointsExist) return
      assembly.connections.push(connection)
      markProjectChanged(state)
    }),

  updateSupplyAssemblyConnection: (assemblyId, connectionId, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const assembly = editProjectSupplyAssemblies(state.currentProject).find(
        ({ id }) => id === assemblyId
      )
      const connection = assembly?.connections.find(({ id }) => id === connectionId)
      if (!connection) return
      if (
        updates.id !== undefined &&
        updates.id !== connectionId &&
        assembly?.connections.some(({ id }) => id === updates.id)
      ) {
        return
      }
      Object.assign(connection, updates)
      markProjectChanged(state)
    }),

  deleteSupplyAssemblyConnection: (assemblyId, connectionId) =>
    set((state) => {
      if (!state.currentProject) return
      const assembly = editProjectSupplyAssemblies(state.currentProject).find(
        ({ id }) => id === assemblyId
      )
      if (!assembly) return
      const connectionIndex = assembly.connections.findIndex(({ id }) => id === connectionId)
      if (connectionIndex < 0) return
      assembly.connections.splice(connectionIndex, 1)
      if (assembly.oneWireGeometry?.connectionWaypoints) {
        delete assembly.oneWireGeometry.connectionWaypoints[connectionId]
      }
      reconcileInvalidPanelFeedOrganizationsInProject(state.currentProject)
      markProjectChanged(state)
    }),

  disconnectSupplyInverterGridInput: (assemblyId, panelId) => {
    let changed = false
    set((state) => {
      if (!state.currentProject) return
      changed = disconnectSupplyInverterGridInputInProject(
        state.currentProject,
        assemblyId,
        panelId
      )
      if (changed) markProjectChanged(state)
    })
    return changed
  },

  addAuxiliaryElectricalEnclosure: (enclosure) =>
    set((state) => {
      if (!state.currentProject) return
      const enclosures = editProjectAuxiliaryElectricalEnclosures(state.currentProject)
      if (enclosures.some(({ id }) => id === enclosure.id)) return
      enclosures.push(enclosure)
      markProjectChanged(state)
    }),

  updateAuxiliaryElectricalEnclosure: (id, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const enclosures = editProjectAuxiliaryElectricalEnclosures(state.currentProject)
      const enclosure = enclosures.find((candidate) => candidate.id === id)
      if (!enclosure) return
      if (
        updates.id !== undefined &&
        updates.id !== id &&
        enclosures.some((candidate) => candidate.id === updates.id)
      ) {
        return
      }
      const normalizedUpdates = updates.gridView
        ? {
            ...updates,
            gridView: {
              ...updates.gridView,
              rows: Math.max(1, updates.gridView.rows),
              columns: Math.max(MIN_AUXILIARY_COLUMNS, updates.gridView.columns),
            },
          }
        : updates
      Object.assign(enclosure, normalizedUpdates)
      markProjectChanged(state)
    }),

  deleteAuxiliaryElectricalEnclosure: (idOrIds) => {
    const ids = [...new Set(Array.isArray(idOrIds) ? idOrIds : [idOrIds])]
    get().withSingleUndoEntry(
      () => {
        let deleted = false
        set((state) => {
          if (!state.currentProject) return
          for (const id of ids) {
            deleted = deleteAuxiliarySupplyEnclosureInProject(state.currentProject, id) || deleted
          }
          if (!deleted) return
          markProjectChanged(state)
        })
        return deleted
      },
      { sessionLabel: 'delete auxiliary supply enclosure' }
    )
  },

  createAuxiliarySupplyEnclosure: (deviceIds, ownerPanelId, position) => {
    let enclosureId: string | null = null
    get().withSingleUndoEntry(
      () => {
        set((state) => {
          if (!state.currentProject) return
          const id = generateId()
          const enclosure = createAuxiliarySupplyEnclosureInProject(state.currentProject, {
            id,
            deviceIds,
            ownerPanelId,
            position,
          })
          if (!enclosure) return
          enclosureId = enclosure.id
          markProjectChanged(state)
        })
        return enclosureId != null
      },
      { sessionLabel: 'create auxiliary supply enclosure' }
    )
    return enclosureId
  },

  moveSupplyDeviceToAuxiliaryEnclosure: (deviceId, enclosureId, row, col) => {
    let moved = false
    get().withSingleUndoEntry(
      () => {
        set((state) => {
          if (!state.currentProject) return
          moved = moveSupplyDeviceToAuxiliaryEnclosureInProject(
            state.currentProject,
            deviceId,
            enclosureId,
            row,
            col
          )
          if (moved) markProjectChanged(state)
        })
        return moved
      },
      { sessionLabel: 'move supply device to auxiliary enclosure' }
    )
    return moved
  },

  moveSupplyDeviceToPanelEnclosure: (deviceId, panelId, row, col) => {
    let moved = false
    get().withSingleUndoEntry(
      () => {
        set((state) => {
          if (!state.currentProject) return
          moved = moveSupplyDeviceToPanelEnclosureInProject(
            state.currentProject,
            deviceId,
            panelId,
            row,
            col
          )
          if (moved) markProjectChanged(state)
        })
        return moved
      },
      { sessionLabel: 'move supply device to panel enclosure' }
    )
    return moved
  },

  moveSupplyDeviceToGridEnclosure: (deviceId, panelId, row, col) => {
    let moved = false
    get().withSingleUndoEntry(
      () => {
        set((state) => {
          if (!state.currentProject) return
          moved = moveSupplyDeviceToGridEnclosureInProject(
            state.currentProject,
            deviceId,
            panelId,
            row,
            col
          )
          if (moved) markProjectChanged(state)
        })
        return moved
      },
      { sessionLabel: 'move supply device to grid enclosure' }
    )
    return moved
  },
})
