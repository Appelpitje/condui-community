import type { LayoutPreset, ViewMode, ViewportLayout } from '@/types/ui'
import { getAvailableCanvasTypes } from './availableCanvasTypes'

export const DEFAULT_LAYOUTS: Record<LayoutPreset, () => ViewportLayout> = {
  single: () => ({
    preset: 'single',
    panels: [{ canvas: 'eendraad' }],
    primaryRatio: 1,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  sideBySide: () => ({
    preset: 'sideBySide',
    panels: [{ canvas: 'eendraad' }, { canvas: 'plan' }],
    primaryRatio: 0.5,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  stacked: () => ({
    preset: 'stacked',
    panels: [{ canvas: 'eendraad' }, { canvas: 'plan' }],
    primaryRatio: 0.5,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  topPairBottomWide: () => ({
    preset: 'topPairBottomWide',
    panels: [{ canvas: 'eendraad' }, { canvas: 'plan' }, { canvas: 'panel' }],
    primaryRatio: 0.5,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  topWideBottomPair: () => ({
    preset: 'topWideBottomPair',
    panels: [{ canvas: 'eendraad' }, { canvas: 'plan' }, { canvas: 'panel' }],
    primaryRatio: 0.5,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  grid: () => {
    const canvases = getAvailableCanvasTypes()
    return {
      preset: 'grid',
      panels: [
        { canvas: 'eendraad' },
        { canvas: 'plan' },
        { canvas: 'panel' },
        { canvas: canvases.includes('documents') ? 'documents' : (canvases[3] ?? 'eendraad') },
      ],
      primaryRatio: 0.5,
      secondaryRatio: 0.5,
      focusReturnLayout: null,
    }
  },
}

export function isLayoutPresetAvailable(_preset: LayoutPreset): boolean {
  return true
}

export function cloneLayoutForFocusReturn(layout: ViewportLayout): ViewportLayout {
  const cloned = JSON.parse(JSON.stringify(layout)) as ViewportLayout
  cloned.focusReturnLayout = null
  return cloned
}

/** Derive the old ViewMode from viewport layout for backward compat */
export function deriveViewMode(layout: ViewportLayout): ViewMode {
  // Documents is not a drawing view; the legacy view mode follows the drawing canvases beside it.
  const types = layout.panels.map((p) => p.canvas).filter((canvas) => canvas !== 'documents')
  if (types.length === 1) return types[0] as ViewMode
  if (types.length === 2 && types.includes('eendraad') && types.includes('plan')) return 'both'
  if (types.length === 2 && types.includes('panel') && types.includes('plan')) return 'panelAndPlan'
  if (types.length >= 2) return 'both'
  return 'eendraad'
}
