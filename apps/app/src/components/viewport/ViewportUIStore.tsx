/* eslint react-refresh/only-export-components: off -- Slot provider and hooks share one private context. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useViewportWindowApi } from './ViewportWindowStore'
import { useViewport } from './ViewportContext'
import { useUIStore, type UIState } from '@/stores/uiStore'
import type { CanvasType } from '@/types/ui'

const Context = createContext<StoreApi<UIState> | null>(null)
let activeViewportStore: StoreApi<UIState> | null = null
const panelStores = new WeakMap<Document, Map<number, StoreApi<UIState>>>()

export function getViewportPanelUI(ownerDocument: Document, panelIndex: number) {
  return panelStores.get(ownerDocument)?.get(panelIndex)
}

function activateStore(store: StoreApi<UIState>) {
  if (activeViewportStore === store) return
  activeViewportStore = store
  useUIStore.setState({
    ...localValues(store.getState()),
    // Activating a slot must not republish its previous fit requests.
    fitToViewTrigger: useUIStore.getState().fitToViewTrigger,
  })
}

export function activateViewportPanel(ownerDocument: Document, panelIndex: number) {
  const store = getViewportPanelUI(ownerDocument, panelIndex)
  if (store) activateStore(store)
}

// Project, selection, tools and undo remain shared. Only the viewing state belongs to a slot.
const localKeys = [
  'eendraadView',
  'planView',
  'panelView',
  'structureView',
  'canvasGestureZoom',
  'activeFloorId',
  'activePanelId',
  'panelCanvasMode',
  'planCanvasViewportPx',
  'fitToViewTrigger',
] as const

function localValues(state: UIState) {
  return Object.fromEntries(localKeys.map((key) => [key, state[key]])) as Pick<
    UIState,
    (typeof localKeys)[number]
  >
}

function makeViewportStore(windowUI: StoreApi<UIState>) {
  const store = createStore<UIState>(() => ({ ...windowUI.getState() }))
  const localActions: Partial<UIState> = {}
  const setLocal = (patch: Partial<UIState>) => {
    store.setState(patch)
    if (activeViewportStore === store) useUIStore.setState(patch)
  }
  for (const [action, key] of [
    ['setEendraadView', 'eendraadView'],
    ['setPlanView', 'planView'],
    ['setPanelView', 'panelView'],
    ['setStructureView', 'structureView'],
  ] as const) {
    localActions[action] = (patch) => setLocal({ [key]: { ...store.getState()[key], ...patch } })
  }
  localActions.setActiveFloor = (activeFloorId) => setLocal({ activeFloorId })
  localActions.requestFitToView = (canvases) =>
    store.setState((state) => ({
      fitToViewTrigger: canvases.reduce(
        (triggers, canvas) => {
          triggers[canvas] = (triggers[canvas] ?? 0) + 1
          return triggers
        },
        { ...state.fitToViewTrigger }
      ),
    }))
  localActions.setActivePanelId = (activePanelId) => setLocal({ activePanelId })
  localActions.setPanelCanvasMode = (panelCanvasMode) =>
    setLocal({
      panelCanvasMode,
      ...(panelCanvasMode.kind === 'panel' ? { activePanelId: panelCanvasMode.panelId } : {}),
    })
  localActions.setPlanCanvasViewportPx = (planCanvasViewportPx) =>
    setLocal({ planCanvasViewportPx })
  localActions.setCanvasGestureZoom = (canvas, zoom) => {
    if (store.getState().canvasGestureZoom[canvas] === zoom) return
    setLocal({ canvasGestureZoom: { ...store.getState().canvasGestureZoom, [canvas]: zoom } })
  }
  store.setState(localActions)
  return { store, localActions }
}

export function ViewportUIProvider({ children }: { children: ReactNode }) {
  const windowUI = useViewportWindowApi()
  const viewport = useViewport()
  const ownerDocument = viewport?.getOwnerWindow().document ?? document
  const panelIndex = viewport?.panelIndex ?? 0
  const [{ store, localActions }] = useState(() => makeViewportStore(windowUI))
  useEffect(() => {
    let panels = panelStores.get(ownerDocument)
    if (!panels) {
      panels = new Map()
      panelStores.set(ownerDocument, panels)
    }
    panels.set(panelIndex, store)
    return () => {
      if (panels.get(panelIndex) === store) panels.delete(panelIndex)
    }
  }, [ownerDocument, panelIndex, store])
  useEffect(() => {
    let previousFit = windowUI.getState().fitToViewTrigger
    const sync = (shared: UIState) => {
      const fitToViewTrigger = { ...store.getState().fitToViewTrigger }
      // Window-wide opening/fit requests reach every slot; cameras remain local.
      if (!shared.isExporting) {
        for (const canvas of Object.keys(previousFit) as CanvasType[]) {
          if (shared.fitToViewTrigger[canvas] !== previousFit[canvas]) fitToViewTrigger[canvas]++
        }
      }
      previousFit = shared.fitToViewTrigger
      store.setState({
        ...shared,
        ...(shared.isExporting || activeViewportStore !== store
          ? localValues(store.getState())
          : {}),
        fitToViewTrigger,
        ...localActions,
      })
    }
    sync(windowUI.getState())
    const unsubscribe = windowUI.subscribe(sync)
    return () => {
      unsubscribe()
      if (activeViewportStore === store) activeViewportStore = null
    }
  }, [store, localActions, windowUI])
  const activate = () => {
    activateStore(store)
  }
  return (
    <Context.Provider value={store}>
      <div
        className="relative h-full w-full"
        onPointerDownCapture={activate}
        onPointerEnter={activate}
        onFocusCapture={activate}
        onWheelCapture={activate}
      >
        {children}
      </div>
    </Context.Provider>
  )
}

export function useViewportUIStore<T>(selector: (state: UIState) => T): T {
  return useStore(useContext(Context) ?? useUIStore, selector)
}

/** Imperative reads inside a canvas must read that slot, even during background rendering. */
export function useViewportUIApi(): StoreApi<UIState> {
  return useContext(Context) ?? useUIStore
}

export function useIsActiveViewport() {
  const store = useContext(Context)
  return useCallback(() => !store || activeViewportStore === store, [store])
}
