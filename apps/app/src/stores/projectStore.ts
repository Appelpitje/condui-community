import { create, type StateCreator } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createBuildingFloorSlice } from './slices/buildingFloorSlice'
import { createCircuitTrunkSlice } from './slices/circuitTrunkSlice'
import { createPanelSlice } from './slices/panelSlice'
import { createPlanPlacementSlice } from './slices/planPlacementSlice'
import { createProjectLifecycleSlice } from './slices/projectLifecycleSlice'
import { createProtectionSlice } from './slices/protectionSlice'
import { createResetSlice } from './slices/resetSlice'
import { createSelectorAnnotationSlice } from './slices/selectorAnnotationSlice'
import { createSupplyAssemblySlice } from './slices/supplyAssemblySlice'
import { logger } from '@/lib/logger'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { followWireAnchorDomains, wireAnchorDomainsNeedFollowing } from '@/lib/wires/followWireAnchorDomains'
import {
  bindProjectStoreApi,
  initialState,
  projectHistory,
  type ProjectState,
} from './slices/projectStoreInternals'

export type { ProjectState } from './slices/projectStoreInternals'
export { isModuleRefValid } from '@/lib/eendraad/projectElectricalDomain'

const IS_DEV = import.meta.env.DEV

const createProjectState: StateCreator<
  ProjectState,
  [['zustand/immer', never]],
  [],
  ProjectState
> = (set, get, api) =>
  ({
    ...initialState,
    ...createProjectLifecycleSlice(set, get, api),
    ...createPanelSlice(set, get, api),
    ...createProtectionSlice(set, get, api),
    ...createCircuitTrunkSlice(set, get, api),
    ...createPlanPlacementSlice(set, get, api),
    ...createBuildingFloorSlice(set, get, api),
    ...createSelectorAnnotationSlice(set, get, api),
    ...createSupplyAssemblySlice(set, get, api),
    ...createResetSlice(set, get, api),
  }) as ProjectState

export const useProjectStore = create<ProjectState>()(immer(createProjectState))
bindProjectStoreApi(useProjectStore)


useProjectStore.subscribe((state: ProjectState, prevState: ProjectState) => {
  const currentProject = state.currentProject
  const previousProject = prevState?.currentProject
  if (projectHistory.consumeSkipNextSubscriberRun()) {
    return
  }
  if (!projectHistory.isRecordingEnabled() || !previousProject || !currentProject) return
  if (projectHistory.consumeSuppressNextDebouncedRun()) {
    return
  }
  if (state.currentProject === previousProject) return

  // Debounce snapshot creation to coalesce rapid updates (e.g. typing).
  projectHistory.schedulePending(previousProject)
})

// Adding or removing an inverter or rectifier flips the domain in the anchors of the cables after
// it. Their specs, lengths, plan traces and junction connections move along in the same undo step.
useProjectStore.subscribe((state: ProjectState, prevState: ProjectState) => {
  const currentProject = state.currentProject
  const previousProject = prevState?.currentProject
  if (!currentProject || !previousProject || currentProject === previousProject) return
  if (getProjectElectricalPanels(currentProject) === getProjectElectricalPanels(previousProject)) return
  if (!wireAnchorDomainsNeedFollowing(currentProject)) return
  projectHistory.runWithoutRecording(() => {
    useProjectStore.setState((draft) => {
      if (draft.currentProject) followWireAnchorDomains(draft.currentProject)
    })
  })
})

useProjectStore.subscribe((state: ProjectState, prevState: ProjectState) => {
  const currentProject = state.currentProject
  if (!currentProject) return
  if (!state.isDirty || prevState?.isDirty) return

  // Do not re-enable history mid-batch (e.g. withSingleUndoEntry / addEndpointWithPlacement).
  // Otherwise the first mutation can flip isDirty while history is suppressed, and later
  // mutations in the same batch get debounced as separate undo steps — undo may restore an
  // endpoint without its sitplan placement (orphan).
  projectHistory.runWithoutRecording(() => {
    useProjectStore.getState().touchProjectUpdatedAt()
  })
  if (IS_DEV) {

    logger.debug('[projectSync] marked shared project dirty', {
      projectId: currentProject.project.id,
      updatedAt: useProjectStore.getState().currentProject?.project.updatedAt ?? null,
    })
  }
})
