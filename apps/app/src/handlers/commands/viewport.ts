import { ZOOM_MIN, ZOOM_MAX } from '@/constants/canvasConstants'
import { getPlanZoomMinimum } from '@/lib/plan/planZoom'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import {
  getViewportPanelAtClientPoint,
  getViewportPanelZones,
} from '@/components/layout/viewportGeometry'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import type { CanvasType, ViewportLayout } from '@/types/ui'

const ZOOM_STEP = 1.25

/** Viewport panel at a client point, from layout geometry (works under overlays too). */
export function findViewportPanelIndexAtPoint(x: number, y: number): number | null {
  const layout = useUIStore.getState().viewportLayout
  const contentEl = document.querySelector('[data-viewport-content]') as HTMLElement | null
  const contentRect = contentEl?.getBoundingClientRect()
  if (!contentRect) return null

  return (
    getViewportPanelAtClientPoint(
      layout,
      {
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
      },
      x,
      y
    )?.panelIndex ?? null
  )
}

export function findViewportPanelIndexFromTarget(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null
  const panelEl = target.closest('[data-viewport-panel]')
  if (!panelEl) return null
  const value = panelEl.getAttribute('data-viewport-panel')
  if (!value) return null
  const panelIndex = Number.parseInt(value, 10)
  return Number.isNaN(panelIndex) ? null : panelIndex
}

/** Moves the panels to their focus-toggle positions immediately, before React re-renders. */
function applyFastViewportLayoutPreview(layout: ViewportLayout, panelIndex: number | null) {
  const contentEl = document.querySelector('[data-viewport-content]') as HTMLElement | null
  if (!contentEl) return

  const previewLayout: ViewportLayout | null = layout.focusReturnLayout
    ? layout.focusReturnLayout
    : layout.panels.length > 1 && panelIndex != null && layout.panels[panelIndex]
      ? {
          preset: 'single',
          panels: [{ canvas: layout.panels[panelIndex].canvas }],
          primaryRatio: 1,
          secondaryRatio: 0.5,
          focusReturnLayout: null,
        }
      : null

  if (!previewLayout) return

  const previewZones = getViewportPanelZones(previewLayout)
  const panels = Array.from(
    contentEl.querySelectorAll<HTMLElement>('[data-viewport-panel][data-viewport-canvas]')
  )

  for (const panelEl of panels) {
    const canvas = panelEl.getAttribute('data-viewport-canvas') as CanvasType | null
    const zone = canvas ? previewZones.find((candidate) => candidate.type === canvas) : null

    panelEl.style.transition = 'none'
    panelEl.style.willChange = 'left, top, width, height'

    if (!zone) {
      panelEl.style.visibility = 'hidden'
      panelEl.style.pointerEvents = 'none'
      continue
    }

    const r = zone.rect
    panelEl.style.visibility = ''
    panelEl.style.pointerEvents = ''
    panelEl.style.left = `${r.left * 100}%`
    panelEl.style.top = `${r.top * 100}%`
    panelEl.style.width = `${r.width * 100}%`
    panelEl.style.height = `${r.height * 100}%`
    panelEl.setAttribute('data-viewport-fast-preview', '1')
  }

  window.setTimeout(() => {
    for (const panelEl of panels) {
      panelEl.style.transition = ''
      panelEl.style.willChange = ''
      panelEl.removeAttribute('data-viewport-fast-preview')
    }
  }, 250)
}

let pendingFocusToggleFrame: number | null = null

export function cancelPendingViewportFocusToggle(): void {
  if (pendingFocusToggleFrame == null) return
  window.cancelAnimationFrame(pendingFocusToggleFrame)
  pendingFocusToggleFrame = null
}

/** Maximizes the given panel, or restores the previous multi-panel layout. */
export function toggleViewportPanelFocus(panelIndex: number | null): void {
  const layout = useUIStore.getState().viewportLayout
  const index = layout.panels.length > 1 ? panelIndex : null
  applyFastViewportLayoutPreview(layout, index)
  cancelPendingViewportFocusToggle()
  pendingFocusToggleFrame = window.requestAnimationFrame(() => {
    pendingFocusToggleFrame = null
    window.setTimeout(() => {
      useUIStore.getState().toggleViewportPanelFocus(index)
    }, 0)
  })
}

/** Zooms every visible canvas in or out by one step. */
export function zoomVisibleCanvases(direction: 'in' | 'out'): void {
  const canvases = useUIStore.getState().viewportLayout.panels.map((panel) => panel.canvas)
  const step = (zoom: number, min: number) =>
    direction === 'in' ? Math.min(ZOOM_MAX, zoom * ZOOM_STEP) : Math.max(min, zoom / ZOOM_STEP)

  for (const canvas of canvases) {
    if (canvas === 'eendraad') {
      useUIStore.setState((state) => ({
        eendraadView: { ...state.eendraadView, zoom: step(state.eendraadView.zoom, ZOOM_MIN) },
      }))
    }
    if (canvas === 'plan') {
      let planMinZoom = ZOOM_MIN
      if (direction === 'out') {
        const activeFloorId = useUIStore.getState().activeFloorId
        const activeFloor = activeFloorId
          ? useProjectStore.getState().getFloorById(activeFloorId)
          : null
        const committedPxPerMeter = activeFloor?.planScaleNeedsCalibration
          ? null
          : resolvePlanPxPerMeter(activeFloor?.scale)
        planMinZoom = getPlanZoomMinimum(committedPxPerMeter)
      }
      useUIStore.setState((state) => ({
        planView: { ...state.planView, zoom: step(state.planView.zoom, planMinZoom) },
      }))
    }
    if (canvas === 'panel') {
      useUIStore.setState((state) => ({
        panelView: { ...state.panelView, zoom: step(state.panelView.zoom, ZOOM_MIN) },
      }))
    }
  }
}
