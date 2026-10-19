import { useDialogStore } from '@/stores/dialogStore'

export const APP_MODAL_BACKDROP_ATTR = 'data-app-modal-backdrop'

export function isAppDialogOpen(): boolean {
  return useDialogStore.getState().dialog != null
}

export function isInsideAppModal(target: EventTarget | null): boolean {
  const element = target as Element | null
  if (!element || element.nodeType !== 1) return false
  return (
    element.closest(`[${APP_MODAL_BACKDROP_ATTR}]`) != null ||
    element.closest('[data-testid="app-dialog-panel"]') != null ||
    element.closest('[data-canvas-context-menu="true"]') != null
  )
}
