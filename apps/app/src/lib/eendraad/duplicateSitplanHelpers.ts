import {
  buildAutoSitplanPlacement,
  getViewportCenterPlanSpaceIfApplicable,
} from '@/lib/plan/autoSitplanPlacement'
import { resolveSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import { getSymbolById } from '@/lib/symbols'
import type { Endpoint, Placement } from '@/types/schema'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import type { Point, ViewportLayout } from '@/types/ui'
import { findCircuitForEndpointInProject } from '@/utils/project'
import { generateId } from '@/utils/id'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import { getPlacementWorldBounds } from '@/utils/plan/placementBounds'
import { isModularSocket } from '@/lib/socket/modularSocket'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

/** Gap between the source block and its duplicate on the sitplan. */
export const DUPLICATE_SITPLAN_GAP = 24

/** @deprecated Use block-aware offset from {@link clonePlacementsForDuplicate}. */
export const DUPLICATE_SITPLAN_OFFSET = { x: 48, y: 0 } as const

/** Default plan symbol base size when floor scale is unavailable. */
const DEFAULT_PLAN_SYMBOL_BASE_PX = 48

type DuplicateSitplanProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

export type ClonePlacementsOptions = {
  symbolType?: string
  socketCount?: number
  baseSymbolSizePx?: number
  /** Auto-oriented plan symbols must not carry an automatic angle to their new position. */
  autoOrient?: boolean
}

export function clonePlacementsOptionsForEndpoint(source: Endpoint): ClonePlacementsOptions {
  return {
    symbolType: source.symbol,
    socketCount: source.type === 'socket' ? (source.socketProps?.socketCount ?? 1) : 1,
    autoOrient: source.type === 'socket' || source.symbol === 'panel_distribution',
  }
}

function unionPlacementGroupBounds(
  placements: Placement[],
  options?: ClonePlacementsOptions
): { left: number; right: number; top: number; bottom: number } | null {
  if (placements.length === 0) return null

  const base = options?.baseSymbolSizePx ?? DEFAULT_PLAN_SYMBOL_BASE_PX
  const socketCount = options?.socketCount ?? 1
  const symbolType = options?.symbolType

  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity

  for (const p of placements) {
    const b = getPlacementWorldBounds(
      p.pos,
      p.rotationDeg ?? 0,
      p.scale ?? 1,
      socketCount,
      symbolType,
      base
    )
    left = Math.min(left, b.left)
    right = Math.max(right, b.right)
    top = Math.min(top, b.top)
    bottom = Math.max(bottom, b.bottom)
  }

  return { left, right, top, bottom }
}

/** Shift the whole placement block right so the duplicate clears the source AABB. */
export function computeDuplicateBlockOffset(
  placements: Placement[],
  options?: ClonePlacementsOptions
): { x: number; y: number } {
  const bounds = unionPlacementGroupBounds(placements, options)
  if (!bounds) {
    return { x: DEFAULT_PLAN_SYMBOL_BASE_PX + DUPLICATE_SITPLAN_GAP, y: 0 }
  }

  const blockWidth = bounds.right - bounds.left
  return { x: blockWidth + DUPLICATE_SITPLAN_GAP, y: 0 }
}

export function clonePlacementsForDuplicate(
  placements: Placement[],
  options?: ClonePlacementsOptions
): Placement[] {
  const offset = computeDuplicateBlockOffset(placements, options)
  return placements.map((p) => ({
    ...JSON.parse(JSON.stringify(p)),
    id: generateId(),
    ...(options?.autoOrient && p.rotationMode !== 'explicit' ? { rotationDeg: 0 } : {}),
    pos: {
      x: p.pos.x + offset.x,
      y: p.pos.y + offset.y,
    },
  }))
}

/**
 * Sitplan placements for a duplicated endpoint.
 * Multiplier symbols (lights, impulse, …): copy all placements with a nudge.
 * Other sitplan symbols: copy the source placement (single) with a nudge when present;
 * otherwise {@link ensureSitplanPlacementsForEndpoints} adds one on the resolved target floor.
 */
export function sitplanPlacementsForDuplicateClone(source: Endpoint): Placement[] {
  if (isModularSocket(source) || !source.placements?.length) return []
  const options = clonePlacementsOptionsForEndpoint(source)
  const toCopy = endpointSupportsMultiplier(source)
    ? source.placements
    : source.placements.slice(0, 1)
  return clonePlacementsForDuplicate(toCopy, options)
}

function isValidFloorId(project: DuplicateSitplanProject, floorId: string): boolean {
  return selectProjectBuildingFloors(project).some((f) => f.id === floorId)
}

/** UI / persisted floor, else a floor where a circuit mate already has a placement. */
function resolveSitplanFloorForEndpoints(
  project: DuplicateSitplanProject,
  uiActiveFloorId: string | null,
  endpointIds: string[],
  getEndpointById: (id: string) => Endpoint | undefined
): string | null {
  const fromUi = resolveSitplanTargetFloorId(project, uiActiveFloorId)
  if (fromUi) return fromUi

  const seenCircuitIds = new Set<string>()
  for (const endpointId of endpointIds) {
    const circuitInfo = findCircuitForEndpointInProject(project, endpointId)
    if (!circuitInfo || seenCircuitIds.has(circuitInfo.circuit.id)) continue
    seenCircuitIds.add(circuitInfo.circuit.id)
    for (const ep of circuitInfo.circuit.endpoints) {
      const floorId = ep.placements?.[0]?.floorId
      if (floorId && isValidFloorId(project, floorId)) return floorId
    }
  }

  for (const endpointId of endpointIds) {
    const floorId = getEndpointById(endpointId)?.placements?.[0]?.floorId
    if (floorId && isValidFloorId(project, floorId)) return floorId
  }

  return null
}

export type SitplanPlacementUiContext = {
  activeFloorId: string | null
  viewportLayout: ViewportLayout
  planCanvasViewportPx: { width: number; height: number } | null
  planView: { zoom: number; pan: { x: number; y: number } }
}

/** Where automatic placements go: the active floor, and the plan viewport centre on it. */
export type SitplanPlacementTarget = {
  activeFloorId: string | null
  /** Plan-space centre of the visible plan canvas, when it shows the active floor. */
  viewportCenter?: Point | null
  /** Panel that shows newly visible placements first (the editor's active panel). */
  activePanelId?: string | null
}

/**
 * Ensure every listed endpoint that belongs on the sitplan has at least one placement.
 * Skips endpoints that already have placements (including copies from circuit duplicate).
 */
export function ensureSitplanPlacementsForEndpoints(
  project: DuplicateSitplanProject,
  endpointIds: string[],
  getEndpointById: (id: string) => Endpoint | undefined,
  addPlacement: (endpointId: string, placement: Placement) => void,
  ui: SitplanPlacementUiContext
): void {
  ensureSitplanPlacementsAt(project, endpointIds, getEndpointById, addPlacement, {
    activeFloorId: ui.activeFloorId,
    viewportCenter: ui.activeFloorId
      ? getViewportCenterPlanSpaceIfApplicable(
          ui.viewportLayout,
          ui.planCanvasViewportPx,
          ui.activeFloorId,
          ui.activeFloorId,
          ui.planView
        )
      : null,
  })
}

/** {@link ensureSitplanPlacementsForEndpoints} without UI state, for project commands. */
export function ensureSitplanPlacementsAt(
  project: DuplicateSitplanProject,
  endpointIds: string[],
  getEndpointById: (id: string) => Endpoint | undefined,
  addPlacement: (endpointId: string, placement: Placement) => void,
  target: SitplanPlacementTarget
): void {
  const floorId = resolveSitplanFloorForEndpoints(
    project,
    target.activeFloorId,
    endpointIds,
    getEndpointById
  )
  if (!floorId) return
  const floorEntity = selectProjectBuildingFloors(project).find((f) => f.id === floorId)
  if (!floorEntity) return
  if ('layers' in floorEntity) {
    ensureElectricalLayerOnFloor(floorEntity)
  }

  const preferredPlanPos =
    target.viewportCenter && floorId === target.activeFloorId ? target.viewportCenter : undefined

  for (const endpointId of endpointIds) {
    const ep = getEndpointById(endpointId)
    if (!ep || (ep.placements?.length ?? 0) > 0) continue
    if (!ep.symbol || isModularSocket(ep)) continue
    const symMeta = getSymbolById(ep.symbol)
    if (symMeta?.scope === 'eendraad' || ep.symbol === 'domotica') continue
    const circuitInfo = findCircuitForEndpointInProject(project, endpointId)
    if (!circuitInfo) continue
    const placement = buildAutoSitplanPlacement(project, {
      circuitId: circuitInfo.circuit.id,
      floorId,
      placementId: generateId(),
      ...(preferredPlanPos ? { preferredPlanPos } : {}),
    })
    if (placement) addPlacement(endpointId, placement)
  }
}
