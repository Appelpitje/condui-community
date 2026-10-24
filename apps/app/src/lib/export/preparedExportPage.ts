import type { ExportScene } from './types'
import type { EendraadSlicingResult } from './slicing/eendraadSlicing'

// Numeric-only ownership instrumentation, eliminated from ordinary builds.
const diagnostics = import.meta.env.VITE_E2E === '1' ? {
  activeSources: 0, activeScenes: 0, peakSources: 0, peakScenes: 0,
  sourcesPrepared: 0, scenesAcquired: 0,
} : null

export function getExportPageOwnershipForE2e() {
  return diagnostics ? { ...diagnostics } : null
}

export function resetExportPageOwnershipForE2e(): void {
  if (!diagnostics) return
  if (diagnostics.activeSources || diagnostics.activeScenes)
    throw new Error('Cannot reset ownership counters during an export')
  Object.assign(diagnostics, {
    activeSources: 0, activeScenes: 0, peakSources: 0, peakScenes: 0,
    sourcesPrepared: 0, scenesAcquired: 0,
  })
}

export interface PreparedExportPage {
  sceneCount: number
  acquireScene: (index: number) => ExportScene
  releaseScene: () => void
  dispose: () => void
}

/** Own one page's source and at most one lazily created render scene. */
export function createPreparedExportPage(
  sceneCount: number,
  createScene: (index: number) => ExportScene,
  disposeSource: () => void,
): PreparedExportPage {
  if (diagnostics) {
    diagnostics.sourcesPrepared++
    diagnostics.peakSources = Math.max(diagnostics.peakSources, ++diagnostics.activeSources)
  }
  let active: ExportScene | undefined
  let disposed = false
  const releaseScene = () => {
    const scene = active
    active = undefined
    if (scene && diagnostics) diagnostics.activeScenes--
    scene?.rootNode.destroy()
  }
  return {
    sceneCount,
    acquireScene(index) {
      if (disposed) throw new Error('Export page has been disposed')
      if (active) throw new Error('Release the current export scene before acquiring another')
      if (!Number.isInteger(index) || index < 0 || index >= sceneCount)
        throw new RangeError('Export scene index is out of range')
      active = createScene(index)
      if (diagnostics) {
        diagnostics.scenesAcquired++
        diagnostics.peakScenes = Math.max(diagnostics.peakScenes, ++diagnostics.activeScenes)
      }
      return active
    },
    releaseScene,
    dispose() {
      if (disposed) return
      disposed = true
      try {
        releaseScene()
      } finally {
        try {
          disposeSource()
        } finally {
          if (diagnostics) diagnostics.activeSources--
        }
      }
    },
  }
}

/** Prepare a board once; clone only its current slice, preserving page geometry. */
export function createSlicedExportPage(
  fullScene: ExportScene,
  diagramId: string,
  { slices, globalScale, mainBusY }: EendraadSlicingResult,
): PreparedExportPage {
  return createPreparedExportPage(slices.length, (index) => {
    const slice = slices[index]!
    const overlapPx = slice.overlapPx ?? 0
    const contentRect = {
      x: slice.x, y: slice.y, width: slice.width, height: slice.height,
      space: 'scene' as const,
    }
    return {
      ...fullScene,
      rootNode: fullScene.rootNode.clone({ deep: true }),
      id: `eendraad-${diagramId}-slice-${index}`,
      bounds: {
        x: slice.x - overlapPx,
        y: slice.y,
        width: slice.width + 2 * overlapPx,
        height: slice.height,
        space: 'scene',
      },
      contentClipRect: overlapPx > 0 ? contentRect : undefined,
      metadata: { circuitIds: slice.circuitIds.join(',') },
      eendraadSlice: { globalScale, mainBusY, schematicTopMm: slice.schematicTopMm },
    }
  }, () => fullScene.rootNode.destroy())
}

export function createSingleSceneExportPage(scene: ExportScene): PreparedExportPage {
  return createPreparedExportPage(1, () => scene, () => scene.rootNode.destroy())
}
