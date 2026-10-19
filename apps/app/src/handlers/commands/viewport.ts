import { ZOOM_MIN, ZOOM_MAX } from '@/constants/canvasConstants'
import { getPanelCanvasZoomMinimum } from '@/lib/panel/panelCanvasZoom'
import { getPlanZoomMinimum } from '@/lib/plan/planZoom'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import {
  getViewportPanelAtClientPoint,
  getViewportPanelZones,
} from '@/components/layout/viewportGeometry'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import type { CommandContext } from '@/lib/commands/ui/types'
import type { ViewportLayout } from '@/types/ui'

const ZOOM_STEP = 1.25

/** Viewport panel at a client point, from layout geometry (works under overlays too). */
export function findViewportPanelIndexAtPoint(
  x: number,
  y: number,
  ownerDocument: Document = document,
  layout = useUIStore.getState().viewportLayout
): number | null {
  const hit = ownerDocument.elementFromPoint?.(x, y)?.closest('[data-viewport-panel]')
  if (hit) return Number(hit.getAttribute('data-viewport-panel'))
  const contentEl = ownerDocument.querySelector('[data-viewport-content]') as HTMLElement | null
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
  const element = target as Element | null
  if (!element || element.nodeType !== 1) return null
  const panelEl = element.closest('[data-viewport-panel]')
  if (!panelEl) return null
  const value = panelEl.getAttribute('data-viewport-panel')
  if (!value) return null
  const panelIndex = Number.parseInt(value, 10)
  return Number.isNaN(panelIndex) ? null : panelIndex
}

/** Moves the panels to their focus-toggle positions immediately, before React re-renders. */
function applyFastViewportLayoutPreview(
  layout: ViewportLayout,
  panelIndex: number | null,
  ownerWindow: Window
) {
  const contentEl = ownerWindow.document.querySelector(
    '[data-viewport-content]'
  ) as HTMLElement | null
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
    contentEl.querySelectorAll<HTMLElement>(':scope > [data-viewport-slot]')
  )

  for (const panelEl of panels) {
    const renderedIndex = Number(panelEl.getAttribute('data-viewport-slot'))
    const sourceIndex = layout.focusedPanelIndex ?? renderedIndex
    const zone = layout.focusReturnLayout
      ? previewZones.find((candidate) => candidate.panelIndex === sourceIndex)
      : renderedIndex === panelIndex
        ? previewZones[0]
        : null

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

  ownerWindow.setTimeout(() => {
    for (const panelEl of panels) {
      panelEl.style.transition = ''
      panelEl.style.willChange = ''
      panelEl.removeAttribute('data-viewport-fast-preview')
    }
  }, 250)
}

const pendingFocusToggles = new WeakMap<Window, number>()

export function cancelPendingViewportFocusToggle(ownerWindow: Window = window): void {
  const pending = pendingFocusToggles.get(ownerWindow)
  if (pending != null) ownerWindow.cancelAnimationFrame(pending)
  pendingFocusToggles.delete(ownerWindow)
}

/** Maximizes a panel in the receiving window, or restores that window's layout. */
export function toggleViewportPanelFocus(
  panelIndex: number | null,
  viewport?: CommandContext['viewport']
): void {
  const ui = viewport?.ui ?? useUIStore
  const ownerWindow = viewport?.getOwnerWindow() ?? window
  const layout = ui.getState().viewportLayout
  const index = layout.panels.length > 1 ? panelIndex : null
  applyFastViewportLayoutPreview(layout, index, ownerWindow)
  cancelPendingViewportFocusToggle(ownerWindow)
  pendingFocusToggles.set(
    ownerWindow,
    ownerWindow.requestAnimationFrame(() => {
      pendingFocusToggles.delete(ownerWindow)
      ui.getState().toggleViewportPanelFocus(index)
    })
  )
}

/** Zooms every visible canvas in or out by one step. */
export function zoomVisibleCanvases(
  direction: 'in' | 'out',
  viewport?: CommandContext['viewport']
): void {
  const windowUI = viewport?.ui ?? useUIStore
  if (viewport) {
    windowUI.getState().viewportLayout.panels.forEach((_, index) => {
      const panelUI = viewport.getPanelUI(index)
      if (panelUI)
        zoomCanvasStore(
          direction,
          panelUI,
          windowUI.getState().viewportLayout.panels[index]?.canvas
        )
    })
    return
  }
  zoomCanvasStore(direction, windowUI)
}

function zoomCanvasStore(
  direction: 'in' | 'out',
  ui: typeof useUIStore | NonNullable<CommandContext['viewport']>['ui'],
  canvas?: import('@/types/ui').CanvasType
) {
  const canvases = new Set(
    canvas ? [canvas] : ui.getState().viewportLayout.panels.map((panel) => panel.canvas)
  )
  const step = (zoom: number, min: number) =>
    direction === 'in' ? Math.min(ZOOM_MAX, zoom * ZOOM_STEP) : Math.max(min, zoom / ZOOM_STEP)

  for (const canvas of canvases) {
    const panelMinZoom = getPanelCanvasZoomMinimum(useProjectStore.getState().currentProject)
    if (canvas === 'eendraad') {
      ui.getState().setEendraadView({ zoom: step(ui.getState().eendraadView.zoom, panelMinZoom) })
    }
    if (canvas === 'plan') {
      let planMinZoom = ZOOM_MIN
      if (direction === 'out') {
        const activeFloorId = ui.getState().activeFloorId
        const activeFloor = activeFloorId
          ? useProjectStore.getState().getFloorById(activeFloorId)
          : null
        const committedPxPerMeter = activeFloor?.planScaleNeedsCalibration
          ? null
          : resolvePlanPxPerMeter(activeFloor?.scale)
        planMinZoom = getPlanZoomMinimum(committedPxPerMeter)
      }
      ui.getState().setPlanView({ zoom: step(ui.getState().planView.zoom, planMinZoom) })
    }
    if (canvas === 'panel') {
      ui.getState().setPanelView({ zoom: step(ui.getState().panelView.zoom, panelMinZoom) })
    }
  }
}
