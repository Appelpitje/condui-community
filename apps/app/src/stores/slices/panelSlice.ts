import { ejectToSupplyPanelInProject, returnFromSupplyPanelInProject, setSupplyPanelVisibleInProject } from '@/lib/panel/panelSupplyTransitions'
import { updatePanelPropertiesInProject } from '@/lib/properties/electricalPropertyMutations'
import { rewireCircuitModulesInProject } from '@/lib/panel/panelRewireMutations'
import { moveTerminalStripToPanelInProject } from '@/lib/panel/panelTerminalStripMove'
import { updatePanelGridInProject, updatePanelGridSlotsInProject, updateSupplyPanelSlotsInProject, unhideModuleFromPanelInProject } from '@/lib/panel/panelGridMutations'
import { setPanelModuleVisibilityInProject } from '@/lib/properties/propertyActions'
import {
  appendUndoSnapshotInStore,
  captureProjectForHistory,
  projectHistory,
  sanitizeOverlayMap,
} from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { resetAllManualEendraadLabelOverrides } from '@/lib/eendraad/automaticMainBusNaming'
import {
  applyAutomaticEendraadNamingAllPanelsInProject,
  deletePanelFromProject,
  isModuleRefValid,
  maybeApplyAutomaticEendraadNamingForPanel,
  panelGridModuleRefKey,
} from '@/lib/eendraad/projectElectricalDomain'
import {
  updateJunctionPanelTerminal as updateJunctionPanelTerminalInProject,
  updateSharedJunctionPanelGrid,
} from '@/lib/junctionPanel/grid'
import { logger } from '@/lib/logger'
import {
  healSupplyTrunkMisplacedOnMainGridForPanel,
} from '@/lib/panel/healSupplyTrunkGrid'
import {
  applyPanelBusFeedBoundaryInProject,
  setPanelFeedOrganizationInProject,
} from '@/lib/panel/panelFeedOrganization'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { movePanelToCircuitInProject, promotePanelToRootSupply } from '@/lib/panel/panelSupplyMove'
import { findPanelById } from '@/lib/panel/panelTree'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { addPanelInProject, updateInstallationInProject } from '@/lib/projectMutations/storeActions'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import {
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { attachRootPanelToExistingSupplyAssembly } from '@/lib/supplyAssembly/panelHandoff'
import { useUIStore } from '@/stores/uiStore'
import { isLastMainPanel } from '@/utils/eendraad'

export const createPanelSlice: ProjectSliceCreator = (set, get) => ({
  // Panel actions
  updateInstallation: (updates) =>
    set((state) => {
      if (!state.currentProject) return
      const result = updateInstallationInProject(state.currentProject, updates)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  applyAutomaticEendraadNamingAllPanels: () =>
    set((state) => {
      if (!state.currentProject) return
      applyAutomaticEendraadNamingAllPanelsInProject(state.currentProject)
      state.isDirty = true
    }),

  resetAllEendraadLabelOverrides: () =>
    set((state) => {
      if (!state.currentProject) return
      if (resetAllManualEendraadLabelOverrides(state.currentProject)) {
        state.isDirty = true
      }
    }),

  addPanel: (panel, parentPanelId) => {
    // Prefer the centre of the visible plan for the panel symbol; placement still separates it.
    const ui = useUIStore.getState()
    const preferredPlanPos = ui.activeFloorId
      ? (getViewportCenterPlanSpaceIfApplicable(
          ui.viewportLayout,
          ui.planCanvasViewportPx,
          ui.activeFloorId,
          ui.activeFloorId,
          ui.planView
        ) ?? undefined)
      : undefined
    set((state) => {
      if (!state.currentProject) return
      const result = addPanelInProject(state.currentProject, panel, parentPanelId, preferredPlanPos)
      if (result.changed) state.isDirty = true
    })
  },

  setPlanFloorOverlayVisibleByBaseFloorId: (map) =>
    set((state) => {
      const floors = state.currentProject ? readLegacyCompatibilityFloors(state.currentProject) : []
      state.planFloorOverlayVisibleByBaseFloorId = sanitizeOverlayMap(map, floors)
    }),

  updatePanel: (id, updates) => set((state) => {
    if(state.currentProject && updatePanelPropertiesInProject(state.currentProject,id,updates)) state.isDirty=true
  }),

  setPanelFeedOrganization: (panelId, organization) => {
    let changed = false
    set((state) => {
      if (!state.currentProject) return
      changed = setPanelFeedOrganizationInProject(state.currentProject, panelId, organization)
      if (changed) state.isDirty = true
    })
    return changed
  },

  setPanelBusFeedBoundary: (panelId, kind, mainBusInsertIndex) => {
    let changed = false
    set((state) => {
      if (!state.currentProject) return
      changed = applyPanelBusFeedBoundaryInProject(
        state.currentProject,
        panelId,
        kind,
        mainBusInsertIndex
      )
      if (changed) state.isDirty = true
    })
    return changed
  },

  movePanelSupply: (panelId, target) =>
    set((state) => {
      const project = state.currentProject
      if (!project) return
      const panels = getProjectElectricalPanels(project)
      const installation = getProjectElectricalInstallation(project)
      if (!installation) return

      const panel = findPanelById(panels, panelId)
      if (!panel) return

      if (target.type === 'circuit') {
        if (movePanelToCircuitInProject(project, panelId, target.circuitId).ok) state.isDirty = true
        return
      }
      const mutablePanels = getEditableProjectElectricalPanels(project)
      const mutableInstallation = getEditableProjectElectricalInstallation(project)
      if (!mutableInstallation) return
      const result = promotePanelToRootSupply(mutablePanels, mutableInstallation, panelId)
      if (result) {
        attachRootPanelToExistingSupplyAssembly(project, panelId)
        state.isDirty = true
      }
    }),

  updatePanelGrid: (panelId, updates) =>
    set((state) => {
      if (state.currentProject && updatePanelGridInProject(state.currentProject, panelId, updates)) state.isDirty = true
    }),

  updateJunctionPanelGrid: (deviceId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateSharedJunctionPanelGrid(state.currentProject, deviceId, updates)
      ) {
        state.isDirty = true
      }
    }),

  updateJunctionPanelTerminal: (ownerDeviceId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateJunctionPanelTerminalInProject(state.currentProject, ownerDeviceId, updates)
      ) {
        state.isDirty = true
      }
    }),

  updatePanelGridSlots: (panelId, slots, _options) =>
    set((state) => {
      if (state.currentProject && updatePanelGridSlotsInProject(state.currentProject, panelId, slots)) {
        state.isDirty = true
      }
    }),

  moveTerminalStripToPanel: (deviceId, panelId, slot, enclosureId) => {
    let moved = false
    set((state) => {
      if (state.currentProject) moved = moveTerminalStripToPanelInProject(state.currentProject, deviceId, panelId, slot, enclosureId)
      if (moved) state.isDirty = true
    })
    return moved
  },

  ejectToSupplyPanel: (panelId, moduleRef) =>
    set((state) => {
      if (state.currentProject && ejectToSupplyPanelInProject(state.currentProject, panelId, moduleRef)) state.isDirty = true
    }),

  returnFromSupplyPanel: (panelId, moduleRef) =>
    set((state) => {
      if (state.currentProject && returnFromSupplyPanelInProject(state.currentProject, panelId, moduleRef)) state.isDirty = true
    }),

  hideModuleFromPanel: (panelId, moduleRefKey) =>
    set((state) => {
      if (!state.currentProject) return
      if (setPanelModuleVisibilityInProject(state.currentProject, panelId, moduleRefKey, false)) {
        state.isDirty = true
      }
    }),

  unhideModuleFromPanel: (panelId, moduleRefKey) =>
    set((state) => {
      if (state.currentProject && unhideModuleFromPanelInProject(state.currentProject, panelId, moduleRefKey)) {
        state.isDirty = true
      }
    }),

  updateSupplyPanelSlots: (panelId, slots) =>
    set((state) => {
      if (state.currentProject && updateSupplyPanelSlotsInProject(state.currentProject, panelId, slots)) {
        state.isDirty = true
      }
    }),

  setSupplyPanelVisible: (panelId, visible) =>
    set((state) => {
      if (state.currentProject && setSupplyPanelVisibleInProject(state.currentProject, panelId, visible)) state.isDirty = true
    }),

  applyPanelAutoArrange: (panelId, mainSlots, supplySlots) => {
    const projectBefore = get().currentProject
    if (!projectBefore) return
    const snapshotBefore = captureProjectForHistory(projectBefore)
    let applied = false
    projectHistory.suppressNextDebouncedRun()
    try {
      set((state) => {
        if (!state.currentProject) return
        const panel = findPanelById(getProjectElectricalPanels(state.currentProject), panelId)
        if (!panel) return
        if (!panel.gridView) {
          panel.gridView = {
            rows: DEFAULT_PANEL_GRID_ROWS,
            columns: DEFAULT_PANEL_GRID_COLUMNS,
            feedFromTop: false,
            slots: [],
          }
        }
        const validMainSlots = mainSlots.filter((s) => {
          try {
            return isModuleRefValid(s.module, state.currentProject!)
          } catch {
            return false
          }
        })
        const validSupplySlots = supplySlots.filter((s) => {
          try {
            return isModuleRefValid(s.module, state.currentProject!)
          } catch {
            return false
          }
        })
        const mainKeys = new Set(validMainSlots.map((s) => panelGridModuleRefKey(s.module)))
        let finalSupply = validSupplySlots
        if (validMainSlots.length > 0 && validSupplySlots.length > 0) {
          finalSupply = validSupplySlots.filter(
            (s) => !mainKeys.has(panelGridModuleRefKey(s.module))
          )
        }
        panel.gridView.slots = validMainSlots
        panel.gridView.supplyPanelSlots = finalSupply.length > 0 ? finalSupply : undefined
        panel.gridView.supplyPanelVisible = finalSupply.length > 0
        if (panel.isMain) {
          healSupplyTrunkMisplacedOnMainGridForPanel(panel, state.currentProject!)
        }
        state.isDirty = true
        applied = true
        maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
      })
    } finally {
      projectHistory.clearDebouncedSuppression()
    }
    if (applied) {
      appendUndoSnapshotInStore(set, snapshotBefore)
      recordSessionAction('panel auto-arrange')
    }
  },

  rewireModules: (originCircuitId, targetCircuitId) =>
    set((state) => {
      if (state.currentProject && rewireCircuitModulesInProject(state.currentProject, originCircuitId, targetCircuitId)) state.isDirty = true
    }),

  deletePanel: (id) =>
    set((state) => {
      if (state.currentProject) {
        const targetPanel = findPanelById(
          getEditableProjectElectricalPanels(state.currentProject),
          id
        )
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        if (targetPanel?.isMain && isLastMainPanel(panels, id)) {
          logger.warn('[projectStore] deletePanel blocked for last main panel', {
            panelId: id,
            panelName: targetPanel.name,
          })
          return
        }
        if (deletePanelFromProject(state.currentProject, id)) {
          state.isDirty = true
        }
      }
    }),
})
