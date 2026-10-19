/**
 * Canvas registry store
 * Allows canvases to register themselves so they can be accessed for export
 */

import { create } from 'zustand'
import type Konva from 'konva'

interface CanvasRegistry {
  eendraad: {
    getStage: () => Konva.Stage | null
    fitToView?: () => void
  } | null
  panel: {
    getStage: (panelId: string) => Konva.Stage | null
    fitToView?: (panelId: string) => void
  } | null
  sitplan: {
    getStage: (floorId: string) => Konva.Stage | null
    fitToView?: (floorId: string) => void
    importBackground?: () => void
    calibrateScale?: () => void
  } | null
}

interface CanvasRegistryState {
  registry: CanvasRegistry
  registerEendraad: (getStage: () => Konva.Stage | null, fitToView?: () => void) => () => void
  registerPanel: (
    getStage: (panelId: string) => Konva.Stage | null,
    fitToView?: (panelId: string) => void
  ) => () => void
  registerSitplan: (
    getStage: (floorId: string) => Konva.Stage | null,
    fitToView?: (floorId: string) => void,
    actions?: { importBackground: () => void; calibrateScale: () => void },
    viewportUI?: object
  ) => () => void
  getSitplanForViewport: (viewportUI: object) => CanvasRegistry['sitplan']
  unregisterEendraad: () => void
  unregisterPanel: () => void
  unregisterSitplan: () => void
}

/** Registrations are owned by individual renderers. Removing one duplicate must not
 * clear another view (or leave export pointing at a destroyed Konva stage). */
type Registration<K extends keyof CanvasRegistry> = {
  entry: NonNullable<CanvasRegistry[K]>
  viewportUI?: object
}
const registrations: { [K in keyof CanvasRegistry]: Array<Registration<K>> } = {
  eendraad: [],
  panel: [],
  sitplan: [],
}

export const useCanvasRegistryStore = create<CanvasRegistryState>((set) => {
  function publish<K extends keyof CanvasRegistry>(kind: K) {
    set((state) => ({
      registry: { ...state.registry, [kind]: registrations[kind].at(-1)?.entry ?? null },
    }))
  }
  function register<K extends keyof CanvasRegistry>(
    kind: K,
    entry: NonNullable<CanvasRegistry[K]>,
    viewportUI?: object
  ) {
    const registration = { entry, viewportUI }
    registrations[kind].push(registration)
    publish(kind)
    return () => {
      const index = registrations[kind].indexOf(registration)
      if (index < 0) return
      registrations[kind].splice(index, 1)
      publish(kind)
    }
  }
  function clear(kind: keyof CanvasRegistry) {
    registrations[kind].length = 0
    publish(kind)
  }
  return {
    registry: { eendraad: null, panel: null, sitplan: null },
    registerEendraad: (getStage, fitToView) => register('eendraad', { getStage, fitToView }),
    registerPanel: (getStage, fitToView) => register('panel', { getStage, fitToView }),
    registerSitplan: (getStage, fitToView, actions, viewportUI) =>
      register('sitplan', { getStage, fitToView, ...actions }, viewportUI),
    getSitplanForViewport: (viewportUI) =>
      registrations.sitplan.findLast((item) => item.viewportUI === viewportUI)?.entry ?? null,
    unregisterEendraad: () => clear('eendraad'),
    unregisterPanel: () => clear('panel'),
    unregisterSitplan: () => clear('sitplan'),
  }
})
