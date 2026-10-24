/**
 * Derive a visible panel scene from a full BuiltPanelScene (filter + compact relayout).
 */
import type { Panel } from '@/types/schema'
import { panelGridModuleRefKey } from '@/lib/panel/panelGridLayout'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  type BuiltPanelScene,
  type PanelSceneSurface,
  type PanelSceneConnector,
  routePanelSceneConnector,
  getPanelSceneSurfaceLayoutWidth,
} from '@/lib/panel/panelScene'
import { findPanelById } from '@/lib/panel/panelTree'

export type PanelLinkPolicy = {
  includeSharedSupply: boolean
  includeAncestors: boolean
  includeDescendants: boolean
}

export type PanelSceneFilter =
  | { mode: 'full' }
  | { mode: 'focus'; panelId: string; linkPolicy: PanelLinkPolicy }
  | { mode: 'explicit'; panelIds: ReadonlySet<string>; linkPolicy: PanelLinkPolicy }

/** Subtree / multi-panel subset views (e.g. explicit mode). */
export const PANEL_FOCUS_LINK_POLICY_DEFAULT: PanelLinkPolicy = {
  includeSharedSupply: true,
  includeAncestors: false,
  includeDescendants: true,
}

/** Single-panel canvas mode: only the selected board (+ shared supply strip for mains). */
export const PANEL_FOCUS_SINGLE_PANEL_LINK_POLICY: PanelLinkPolicy = {
  includeSharedSupply: true,
  includeAncestors: false,
  includeDescendants: false,
}

function findParentPanelId(
  panels: Panel[],
  childId: string,
  parentId: string | null = null
): string | null {
  for (const p of panels) {
    if (p.id === childId) return parentId
    const found = findParentPanelId(p.subPanels ?? [], childId, p.id)
    if (found !== undefined && found !== null) return found
  }
  return null
}

/** Walk up from childId to root; returns ordered list from immediate parent to root. */
function collectAncestorIds(panels: Panel[], childId: string): string[] {
  const out: string[] = []
  let cur: string | null = childId
  for (;;) {
    const parent = findParentPanelId(panels, cur!)
    if (parent == null) break
    out.push(parent)
    cur = parent
  }
  return out
}

function collectDescendantIds(panel: Panel | null | undefined): Set<string> {
  const out = new Set<string>()
  const walk = (p: Panel) => {
    out.add(p.id)
    for (const c of p.subPanels ?? []) walk(c)
  }
  if (panel) walk(panel)
  return out
}

function cloneSurface(surface: PanelSceneSurface): PanelSceneSurface {
  return {
    ...surface,
    placements: surface.placements.map((p) => ({ ...p })),
  }
}

function surfaceSortDepth(panels: Panel[], a: PanelSceneSurface, b: PanelSceneSurface): number {
  const depth = (id: string): number => {
    let d = 0
    let cur: string | null = id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const parent = findParentPanelId(panels, cur)
      if (parent == null) break
      d++
      cur = parent
    }
    return d
  }
  const pa = a.kind === 'panel' && a.panel ? depth(a.panel.id) : -1
  const pb = b.kind === 'panel' && b.panel ? depth(b.panel.id) : -1
  if (pa !== pb) return pa - pb
  return a.id.localeCompare(b.id)
}

/**
 * Vertical stack relayout + connectors for filtered surfaces (origin top-left).
 */
function relayoutStackedScene(
  surfaces: PanelSceneSurface[],
  hierarchyFeedFromTop: boolean,
  rootPanels: Panel[]
): { surfaces: PanelSceneSurface[]; connectors: PanelSceneConnector[] } {
  const shared = surfaces.filter((s) => s.kind === 'shared_supply')
  const auxiliary = surfaces.filter((s) => s.kind === 'auxiliary')
  const panelSurfaces = surfaces.filter((s) => s.kind === 'panel')
  panelSurfaces.sort((a, b) => surfaceSortDepth(rootPanels, a, b))

  const ordered = [...shared, ...auxiliary, ...panelSurfaces]
  const stackGap = 56
  let cursorY = 0
  const placed: PanelSceneSurface[] = []
  for (const s of ordered) {
    const next = cloneSurface(s)
    next.x = 0
    next.y = cursorY
    placed.push(next)
    cursorY += next.height + stackGap
  }
  if (placed.length > 0) {
    cursorY -= stackGap
  }

  const connectors: PanelSceneConnector[] = []
  for (let i = 0; i < placed.length - 1; i++) {
    const a = placed[i]!
    const b = placed[i + 1]!
    const busY = a.y + a.height + stackGap / 2
    connectors.push({
      points: routePanelSceneConnector(
        a.x + a.width / 2,
        a.y + a.height,
        b.x + b.width / 2,
        b.y,
        busY
      ),
    })
  }

  if (!hierarchyFeedFromTop) {
    const maxBottom = Math.max(...placed.map((surface) => surface.y + surface.height))
    for (const surface of placed) {
      surface.y = maxBottom - surface.y - surface.height
    }
    for (const connector of connectors) {
      connector.points = connector.points.map((value, index) =>
        index % 2 === 1 ? maxBottom - value : value
      )
    }
  }

  return { surfaces: placed, connectors }
}

function resolveVisiblePanelIds(
  rootPanels: Panel[],
  filter: Extract<PanelSceneFilter, { mode: 'focus' | 'explicit' }>
): Set<string> {
  const ids = new Set<string>()
  if (filter.mode === 'focus') {
    ids.add(filter.panelId)
    const panel = findPanelById(rootPanels, filter.panelId)
    if (filter.linkPolicy.includeDescendants && panel) {
      for (const d of collectDescendantIds(panel)) ids.add(d)
    }
    if (filter.linkPolicy.includeAncestors) {
      for (const a of collectAncestorIds(rootPanels, filter.panelId)) ids.add(a)
    }
  } else {
    for (const id of filter.panelIds) ids.add(id)
    if (filter.linkPolicy.includeDescendants) {
      for (const id of [...ids]) {
        const panel = findPanelById(rootPanels, id)
        if (panel) for (const d of collectDescendantIds(panel)) ids.add(d)
      }
    }
    if (filter.linkPolicy.includeAncestors) {
      const addAncestors = new Set<string>()
      for (const id of ids) {
        for (const a of collectAncestorIds(rootPanels, id)) addAncestors.add(a)
      }
      for (const a of addAncestors) ids.add(a)
    }
  }
  return ids
}

function visibleHasMainPanel(rootPanels: Panel[], visibleIds: Set<string>): boolean {
  for (const id of visibleIds) {
    const p = findPanelById(rootPanels, id)
    if (p?.isMain) return true
  }
  return false
}

export function applyPanelSceneFilter(
  full: BuiltPanelScene,
  filter: PanelSceneFilter,
  project: ProjectWithOptionalV2Electrical,
  hierarchyFeedFromTop: boolean
): BuiltPanelScene {
  if (filter.mode === 'full') return full

  const rootPanels = getProjectElectricalPanels(project)
  const visiblePanelIds = resolveVisiblePanelIds(rootPanels, filter)
  const includeShared =
    filter.linkPolicy.includeSharedSupply && visibleHasMainPanel(rootPanels, visiblePanelIds)

  const picked: PanelSceneSurface[] = []
  for (const surface of full.surfaces) {
    if (surface.kind === 'shared_supply') {
      if (includeShared) picked.push(cloneSurface(surface))
      continue
    }
    if (
      surface.kind === 'auxiliary' &&
      (!surface.enclosure?.ownerPanelId || visiblePanelIds.has(surface.enclosure.ownerPanelId))
    ) {
      picked.push(cloneSurface(surface))
      continue
    }
    if (surface.kind === 'panel' && surface.panel && visiblePanelIds.has(surface.panel.id)) {
      picked.push(cloneSurface(surface))
    }
  }

  if (picked.length === 0) {
    return {
      ...full,
      surfaces: [],
      connectors: [],
      moduleRefs: new Set(),
      width: 0,
      height: 0,
    }
  }

  const { surfaces, connectors } = relayoutStackedScene(picked, hierarchyFeedFromTop, rootPanels)
  const maxRight = Math.max(0, ...surfaces.map((surface) => surface.x + getPanelSceneSurfaceLayoutWidth(surface)))
  const maxBottom = Math.max(0, ...surfaces.map((surface) => surface.y + surface.height))

  return {
    width: maxRight,
    height: maxBottom,
    surfaces,
    connectors,
    moduleRefs: new Set(
      surfaces.flatMap((s) => s.placements.map((p) => panelGridModuleRefKey(p.ref)))
    ),
    sharedSupplyTrunkRefKeys: full.sharedSupplyTrunkRefKeys,
  }
}
