/* eslint react-refresh/only-export-components: off -- Window layout provider and hooks share one context. */
import { createContext, useContext, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { produce } from 'immer'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { createViewportLayoutActions } from '@/lib/viewport/viewportLayoutActions'
import { DEFAULT_LAYOUTS, deriveViewMode } from '@/lib/viewport/viewportLayouts'
import type { CanvasType } from '@/types/ui'

const Context = createContext<StoreApi<UIState> | null>(null)

/** Layout is session-local to a window; project/tools/selection continue to use the editor owner. */
export function createViewportWindowStore(canvas: CanvasType, seed?: UIState) {
  const viewportLayout = { ...DEFAULT_LAYOUTS.single(), panels: [{ canvas }] }
  const store = createStore<UIState>(() => ({
    ...useUIStore.getState(),
    ...(seed
      ? {
          eendraadView: seed.eendraadView,
          planView: seed.planView,
          panelView: seed.panelView,
          structureView: seed.structureView,
          activeFloorId: seed.activeFloorId,
          activePanelId: seed.activePanelId,
          panelCanvasMode: seed.panelCanvasMode,
        }
      : {}),
    viewportLayout,
    viewMode: deriveViewMode(viewportLayout),
    panels: {
      ...useUIStore.getState().panels,
      library: { ...useUIStore.getState().panels.library, visible: false },
      properties: { ...useUIStore.getState().panels.properties, visible: false },
    },
    leftDockPanel: 'library',
    leftDockCollapsed: true,
    quickPlacerWindowOpen: false,
    leftDockPreviewPanel: null,
  }))
  const actions = {
    ...createViewportLayoutActions(
      store.getState,
      (recipe) => store.setState(produce(recipe)),
      () => 'sideBySide'
    ),
    setLeftDockPanel: (leftDockPanel: UIState['leftDockPanel']) =>
      store.setState({
        leftDockPanel,
        leftDockPreviewPanel: null,
        ...(leftDockPanel === 'quickPlacer' ? { quickPlacerWindowOpen: false } : {}),
      }),
    setLeftDockCollapsed: (leftDockCollapsed: boolean) => store.setState({ leftDockCollapsed }),
    setQuickPlacerWindowOpen: (quickPlacerWindowOpen: boolean) =>
      store.setState({ quickPlacerWindowOpen }),
    setLeftDockPreviewPanel: (leftDockPreviewPanel: UIState['leftDockPreviewPanel']) =>
      store.setState({ leftDockPreviewPanel }),
    togglePanel: (panel: keyof UIState['panels']) =>
      store.setState(
        produce((state: UIState) => {
          if (panel === 'library') state.leftDockCollapsed = !state.leftDockCollapsed
          else state.panels[panel].visible = !state.panels[panel].visible
        })
      ),
    toggleMainDockPanelsCollapse: () =>
      store.setState(
        produce((state: UIState) => {
          const collapsed = !state.leftDockCollapsed || state.panels.properties.visible
          state.leftDockCollapsed = collapsed
          state.panels.properties.visible = !collapsed
        })
      ),
    requestFitToView: (canvases: CanvasType[]) =>
      store.setState((state) => ({
        fitToViewTrigger: canvases.reduce(
          (triggers, type) => {
            triggers[type] = (triggers[type] ?? 0) + 1
            return triggers
          },
          { ...state.fitToViewTrigger }
        ),
      })),
  }
  store.setState(actions)
  const connect = () =>
    useUIStore.subscribe((shared) => {
      const {
        viewportLayout,
        viewMode,
        fitToViewTrigger,
        panels,
        leftDockPanel,
        leftDockCollapsed,
        quickPlacerWindowOpen,
        leftDockPreviewPanel,
      } = store.getState()
      store.setState({
        ...shared,
        viewportLayout,
        viewMode,
        fitToViewTrigger,
        panels,
        leftDockPanel,
        leftDockCollapsed,
        quickPlacerWindowOpen,
        leftDockPreviewPanel,
        ...actions,
      })
    })
  return { store, connect }
}

export function ViewportWindowProvider({
  store,
  children,
}: {
  store: StoreApi<UIState>
  children: ReactNode
}) {
  return <Context.Provider value={store}>{children}</Context.Provider>
}

export function useViewportWindowApi() {
  return useContext(Context) ?? useUIStore
}
export function useViewportWindowStore<T>(selector: (state: UIState) => T): T {
  return useStore(useViewportWindowApi(), selector)
}
