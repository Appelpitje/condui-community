import type { PanelGridModuleRef } from '@/types/schema'
import { getProjectElectrical } from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import { getPanelOnlyLayoutRevision } from '@/lib/layout/panelOnlyLayoutRevision'
import { getModuleDisplayInfo, type ModuleDisplayInfo } from './getModuleDisplayInfo'
import { panelGridModuleRefKey } from './panelGridModuleRef'

/**
 * One electrical revision's display metadata, independent of the canvas camera.
 * Store edits and undo replace the immutable electrical discipline, so even an
 * electrical change elsewhere invalidates inherited phases and terminal pins.
 * Verified cabinet-only coordinates retain the same display revision.
 * Only the current revision is retained; a campus must not accumulate a second
 * full display cache for every edit in its undo history.
 */
export function createModuleDisplayInfoCache() {
  let electrical: ReturnType<typeof getProjectElectrical>
  let language: string | undefined
  const modules = new Map<string, ModuleDisplayInfo>()

  return (
    ref: PanelGridModuleRef,
    project: ProjectV2 | null,
    nextLanguage: string
  ): ModuleDisplayInfo => {
    if (!project) return getModuleDisplayInfo(ref, project)
    const nextElectrical = getProjectElectrical(getPanelOnlyLayoutRevision(project))
    if (nextElectrical !== electrical || nextLanguage !== language) {
      modules.clear()
      electrical = nextElectrical
      language = nextLanguage
    }

    const key = panelGridModuleRefKey(ref)
    let info = modules.get(key)
    if (!info) {
      info = getModuleDisplayInfo(ref, project)
      modules.set(key, info)
    }
    return info
  }
}

// Retain display metadata when changing canvas unmounts the hierarchy. Sharing
// this single-revision cache retains no Konva scene and also bounds memory when
// different canvases/projects use it: the next electrical revision evicts it.
export const getCachedModuleDisplayInfo = createModuleDisplayInfoCache()
