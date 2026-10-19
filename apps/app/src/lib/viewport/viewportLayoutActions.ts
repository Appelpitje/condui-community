import type { UIState } from '@/stores/uiStore'
import type { CanvasType, LayoutPreset, ViewMode, ViewportLayout } from '@/types/ui'
import { DEFAULT_LAYOUTS, cloneLayoutForFocusReturn, deriveViewMode } from './viewportLayouts'
import { getAvailableCanvasTypes } from './availableCanvasTypes'
import { getResponsiveEditorMode } from '@/hooks/useResponsiveEditorMode'
import { VIEWPORT_RATIO_MIN, VIEWPORT_RATIO_MAX } from '@/constants/layoutConstants'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'

const CANVAS_TYPES: CanvasType[] = getAvailableCanvasTypes()
type LayoutActions = Pick<
  UIState,
  | 'setViewportLayout'
  | 'setLayoutGrid'
  | 'setLayoutPreset'
  | 'setPanelCanvas'
  | 'setLayoutPrimaryRatio'
  | 'setLayoutSecondaryRatio'
  | 'focusPanel'
  | 'unfocusPanel'
  | 'toggleViewportPanelFocus'
>

/** Shared transitions, applied to the layout store of the receiving window. */
export function createViewportLayoutActions(
  get: () => UIState,
  set: (recipe: (state: UIState) => void) => void,
  getDefaultSplit: () => LayoutPreset = () =>
    getResponsiveEditorMode().mode === 'compactPortrait' ? 'stacked' : 'sideBySide'
): LayoutActions {
  return {
    setViewportLayout: (layout) =>
      set((state) => {
        state.viewportLayout = layout
        state.viewMode = deriveViewMode(layout)
      }),

    setLayoutGrid: (rows, columns) =>
      set((state) => {
        if (![rows, columns].every((n) => Number.isInteger(n) && n >= 1 && n <= 4)) return
        const old = state.viewportLayout.focusReturnLayout ?? state.viewportLayout
        state.viewportLayout = {
          preset: 'grid',
          rows,
          columns,
          panels: Array.from(
            { length: rows * columns },
            (_, i) => old.panels[i] ?? { canvas: CANVAS_TYPES[i % CANVAS_TYPES.length]! }
          ),
          primaryRatio: 0.5,
          secondaryRatio: 0.5,
          focusReturnLayout: null,
        }
        state.viewMode = deriveViewMode(state.viewportLayout)
      }),

    setLayoutPreset: (preset, options) =>
      set((state) => {
        const previousPreset = state.viewportLayout.preset
        const oldLayout = state.viewportLayout
        const oldCanvasSet = new Set(oldLayout.panels.map((p) => p.canvas))
        const oldCanvases = oldLayout.panels.map((p) => p.canvas)
        const sourcePanelIndex = options?.sourcePanelIndex
        const newLayout = DEFAULT_LAYOUTS[preset]()
        const savedReturnLayout = oldLayout.focusReturnLayout
        const canRestoreReturnLayout =
          oldLayout.preset === 'single' &&
          preset !== 'single' &&
          savedReturnLayout != null &&
          savedReturnLayout.panels.length === newLayout.panels.length

        if (canRestoreReturnLayout) {
          for (let i = 0; i < newLayout.panels.length; i++) {
            newLayout.panels[i]!.canvas = savedReturnLayout.panels[i]!.canvas
          }
          newLayout.primaryRatio = savedReturnLayout.primaryRatio
          newLayout.secondaryRatio = savedReturnLayout.secondaryRatio
        } else if (preset === 'single' && oldLayout.panels.length > 1) {
          newLayout.focusReturnLayout = cloneLayoutForFocusReturn(oldLayout)
          const focusIndex =
            sourcePanelIndex != null &&
            sourcePanelIndex >= 0 &&
            sourcePanelIndex < oldCanvases.length
              ? sourcePanelIndex
              : 0
          newLayout.panels[0]!.canvas = oldCanvases[focusIndex]!
          newLayout.focusedPanelIndex = focusIndex
        } else {
          for (let i = 0; i < newLayout.panels.length && i < oldCanvases.length; i++) {
            newLayout.panels[i]!.canvas = oldCanvases[i]!
          }
          if (
            preset === 'single' &&
            sourcePanelIndex != null &&
            sourcePanelIndex >= 0 &&
            sourcePanelIndex < oldCanvases.length
          ) {
            newLayout.panels[0]!.canvas = oldCanvases[sourcePanelIndex]!
          }
          if (preset === 'single') {
            newLayout.focusReturnLayout = oldLayout.focusReturnLayout
          }
        }
        // Fit-to-view any canvases that weren't previously visible
        const newlyVisible: CanvasType[] = []
        for (const p of newLayout.panels) {
          if (!oldCanvasSet.has(p.canvas)) {
            newlyVisible.push(p.canvas)
          }
        }
        state.viewportLayout = newLayout
        state.viewMode = deriveViewMode(newLayout)
        for (const c of newlyVisible) {
          state.fitToViewTrigger[c] = (state.fitToViewTrigger[c] ?? 0) + 1
        }
        if (previousPreset !== preset) {
          trackGoogleAnalyticsEvent('layout_preset_change', {
            from_preset: previousPreset,
            to_preset: preset,
            panel_count: newLayout.panels.length,
          })
        }
      }),

    setPanelCanvas: (panelIndex, canvas) =>
      set((state) => {
        const panels = state.viewportLayout.panels
        const target = panels[panelIndex]
        if (!target) return
        const previousCanvas = target.canvas
        const canvasesToFit: CanvasType[] = [canvas]
        target.canvas = canvas
        state.viewMode = deriveViewMode(state.viewportLayout)
        for (const c of canvasesToFit) {
          state.fitToViewTrigger[c] = (state.fitToViewTrigger[c] ?? 0) + 1
        }
        if (previousCanvas !== canvas) {
          trackGoogleAnalyticsEvent('canvas_switch', {
            panel_index: panelIndex,
            from_canvas: previousCanvas,
            to_canvas: canvas,
            swapped_duplicate: false,
          })
        }
      }),

    setLayoutPrimaryRatio: (ratio) =>
      set((state) => {
        state.viewportLayout.primaryRatio = Math.max(
          VIEWPORT_RATIO_MIN,
          Math.min(VIEWPORT_RATIO_MAX, ratio)
        )
      }),

    setLayoutSecondaryRatio: (ratio) =>
      set((state) => {
        state.viewportLayout.secondaryRatio = Math.max(
          VIEWPORT_RATIO_MIN,
          Math.min(VIEWPORT_RATIO_MAX, ratio)
        )
      }),

    focusPanel: (panelIndex) =>
      set((state) => {
        const layout = state.viewportLayout
        if (layout.panels.length <= 1) return
        const panel = layout.panels[panelIndex]
        if (!panel) return
        const canvas = panel.canvas
        const returnLayout = JSON.parse(JSON.stringify(layout)) as ViewportLayout
        returnLayout.focusReturnLayout = null
        state.viewportLayout = {
          preset: 'single',
          panels: [{ canvas }],
          primaryRatio: 1,
          secondaryRatio: 0.5,
          focusReturnLayout: returnLayout,
          focusedPanelIndex: panelIndex,
        }
        state.viewMode = canvas as ViewMode
        trackGoogleAnalyticsEvent('canvas_focus', {
          panel_index: panelIndex,
          canvas,
        })
      }),

    unfocusPanel: () =>
      set((state) => {
        const returnLayout = state.viewportLayout.focusReturnLayout
        if (!returnLayout) return
        const focusedCanvas = state.viewportLayout.panels[0]?.canvas
        state.viewportLayout = returnLayout
        state.viewMode = deriveViewMode(returnLayout)
        trackGoogleAnalyticsEvent('canvas_unfocus', {
          canvas: focusedCanvas,
          panel_count: returnLayout.panels.length,
        })
      }),

    toggleViewportPanelFocus: (panelIndex) => {
      const layout = get().viewportLayout
      if (layout.focusReturnLayout) {
        get().unfocusPanel()
        return
      }
      if (layout.panels.length > 1) {
        if (panelIndex != null) {
          get().focusPanel(panelIndex)
        }
        return
      }
      get().setLayoutPreset(getDefaultSplit())
    },
  }
}
