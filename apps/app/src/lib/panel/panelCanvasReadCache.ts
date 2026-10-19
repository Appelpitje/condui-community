import { isDraft } from 'immer'
import type { Panel } from '@/types/schema'
import {
  getProjectElectrical,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getPanelCanvasOverflowModuleKeys } from '@/lib/export/labelStripReadiness'
import {
  isImmutablePanelReadInput as isImmutableInput,
  withPanelReadContext,
} from './panelReadContext'
import {
  buildFullPanelScene,
  type BuildPanelSceneParams,
  type BuiltPanelScene,
  type GetPanelGridModulesFn,
  type PanelScenePanelOption,
} from './panelScene'

/** Reuse derived geometry across canvas mounts, retaining only the last revision. */
export function createPanelSceneReadCache() {
  let electrical: ReturnType<typeof getProjectElectrical>
  let locale: string | undefined
  let options: PanelScenePanelOption[] = []
  let modules: GetPanelGridModulesFn | undefined
  let descendants = false
  let feedFromTop = false
  let supplyLabel = ''
  let initialized = false
  let scene: BuiltPanelScene | null = null

  return (params: BuildPanelSceneParams): BuiltPanelScene | null => {
    const nextElectrical = getProjectElectrical(params.project)
    if (
      !nextElectrical ||
      isDraft(nextElectrical) ||
      isDraft(params.project) ||
      !isImmutableInput(nextElectrical) ||
      !params.panelOptions.every((option) => isImmutableInput(option.panel))
    ) {
      return withPanelReadContext(params.project, () => buildFullPanelScene(params))
    }
    const nextLocale = params.project.project?.locale
    const sameOptions =
      options.length === params.panelOptions.length &&
      options.every((option, index) => {
        const next = params.panelOptions[index]!
        return option.id === next.id && option.panel === next.panel && option.isRoot === next.isRoot
      })
    if (
      initialized &&
      electrical === nextElectrical &&
      locale === nextLocale &&
      sameOptions &&
      modules === params.getPanelGridModules &&
      descendants === params.includeDescendants &&
      feedFromTop === params.hierarchyFeedFromTop &&
      supplyLabel === params.sharedSupplyLabel
    )
      return scene

    const nextScene = withPanelReadContext(params.project, () => buildFullPanelScene(params))
    electrical = nextElectrical
    locale = nextLocale
    // Copy descriptors so an owner mutating its option wrapper cannot disguise
    // a changed root flag or order. Panel entities themselves are immutable.
    options = params.panelOptions.map((option) => ({ ...option }))
    modules = params.getPanelGridModules
    descendants = params.includeDescendants
    feedFromTop = params.hierarchyFeedFromTop
    supplyLabel = params.sharedSupplyLabel
    scene = nextScene
    initialized = true
    return scene
  }
}

/** Overflow uses full placement, so do the campus-wide scan once per revision. */
export function createPanelOverflowReadCache() {
  let electrical: ReturnType<typeof getProjectElectrical>
  let modules: GetPanelGridModulesFn | undefined
  const counts = new Map<string, { panel: Panel; count: number }>()

  return (
    project: ProjectWithOptionalV2Electrical,
    panel: Panel,
    getModules: GetPanelGridModulesFn
  ): number => {
    const nextElectrical = getProjectElectrical(project)
    const cacheable =
      nextElectrical &&
      !isDraft(nextElectrical) &&
      !isDraft(project) &&
      !isDraft(panel) &&
      isImmutableInput(nextElectrical) &&
      isImmutableInput(panel)
    if (cacheable && (electrical !== nextElectrical || modules !== getModules)) {
      counts.clear()
      electrical = nextElectrical
      modules = getModules
    }
    const cached = cacheable ? counts.get(panel.id) : undefined
    if (cached?.panel === panel) return cached.count
    const count = withPanelReadContext(project, () => {
      const visibleModules = getModules(panel.id).filter(
        (module) => !(module.ref.kind === 'trunkDevice' && module.ref.scope === 'ground')
      )
      return getPanelCanvasOverflowModuleKeys(panel, project, visibleModules).size
    })
    if (cacheable) counts.set(panel.id, { panel, count })
    return count
  }
}

export const getCachedFullPanelScene = createPanelSceneReadCache()
export const getCachedPanelOverflowCount = createPanelOverflowReadCache()
