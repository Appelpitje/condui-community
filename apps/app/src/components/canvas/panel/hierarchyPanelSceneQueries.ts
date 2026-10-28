import type { Project } from './hierarchyPanelCanvasModel'

import {
  ROW_GAP,
  ROW_STRIDE,
  getTerminalStripTopOffset,
  getPanelMainHorizontalRoutingLanes,
  type ModulePlacement,
} from '@/lib/panel/panelGridLayout'

import type { PanelHierarchyRoute } from './RelationWires'
import type { PanelWirePathRegion, WirePathSegment } from './panelWireRouter'

import {
  getPanelSceneSurfaceGrid,
  type BuiltPanelScene,
  type PanelSceneSurface,
} from '@/lib/panel/panelScene'

import { getVoltagePolesConfig, getProtectionCreationProps } from '@/lib/protectionDefaults'
import { protectionTypeFromSymbolId, ROTATING_SWITCH_SYMBOL_ID } from '@/lib/protectionKind'
import type { PanelGridModuleRef, Panel } from '@/types/schema'

import type { Selection as CanvasSelection } from '@/types/ui'

import type { SymbolMetadata } from '@/lib/symbols'

import { polesFromConfig } from '@/constants/poleConfig'

import { isModularSocketLibraryId, MODULAR_SOCKET_SINGLE_MODULE_WIDTH } from '@/lib/socket/modularSocket'
import { PANEL_SCENE_FRAME_MARGIN as PANEL_FRAME_MARGIN } from '@/lib/panel/panelScene'

export function moduleRefMatchesSelection(ref: PanelGridModuleRef, selection: CanvasSelection): boolean {
  if (!selection.type || selection.ids.length === 0) return false
  if (selection.type === 'protection')
    return ref.kind === 'protection' && selection.ids.includes(ref.id)
  if (selection.type === 'trunkDevice') {
    return ref.kind === 'trunkDevice' && selection.ids.includes(ref.id)
  }
  if (selection.type === 'endpoint') {
    return ref.kind === 'domotica' && selection.ids.includes(ref.endpointId)
  }
  return false
}

export function placementMatchesSelection(
  placement: Pick<ModulePlacement, 'ref' | 'terminalStripMemberRefs'>,
  selection: CanvasSelection
): boolean {
  return (
    moduleRefMatchesSelection(placement.ref, selection) ||
    (placement.terminalStripMemberRefs?.some((ref) => moduleRefMatchesSelection(ref, selection)) ??
      false)
  )
}

export function getModuleSelectionBounds(
  placements: Array<{
    x: number
    y: number
    width: number
    height: number
    ref: PanelGridModuleRef
    terminalStripMemberRefs?: PanelGridModuleRef[]
  }>,
  selection: CanvasSelection,
  padding = 0
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  for (const placement of placements) {
    if (!placementMatchesSelection(placement, selection)) continue
    minX = Math.min(minX, placement.x)
    minY = Math.min(minY, placement.y)
    maxX = Math.max(maxX, placement.x + placement.width)
    maxY = Math.max(maxY, placement.y + placement.height)
    found = true
  }

  if (
    !found ||
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

export function getLibraryDropWidthCols(symbol: SymbolMetadata, project: Project | null): number {
  if (isModularSocketLibraryId(symbol.id)) return MODULAR_SOCKET_SINGLE_MODULE_WIDTH
  if (symbol.id === 'energy_meter')
    return Math.max(1, polesFromConfig(getVoltagePolesConfig(project)))
  if (symbol.id === ROTATING_SWITCH_SYMBOL_ID) return 1
  const protectionType = protectionTypeFromSymbolId(symbol.id)
  const defaults = getProtectionCreationProps(project, protectionType)
  const poles =
    defaults.poles ??
    (defaults.polesConfig ? polesFromConfig(defaults.polesConfig) : undefined) ??
    1
  return Math.max(1, poles)
}

export function hierarchyRouteForHierarchySurface(
  surface: PanelSceneSurface,
  sharedSurface: PanelSceneSurface | undefined,
  side: 'left' | 'right',
  panelInset: number
): PanelHierarchyRoute {
  const panelTopY = surface.y + surface.mainPanelY
  const panelBottomY = panelTopY + surface.panelFrameHeight
  const sharedCorridorY = (() => {
    if (!sharedSurface) return panelBottomY + 8
    const sharedTopY = sharedSurface.y
    const sharedBottomY = sharedSurface.y + sharedSurface.height
    return sharedBottomY <= panelTopY
      ? (sharedBottomY + panelTopY) / 2
      : (panelBottomY + sharedTopY) / 2
  })()
  return {
    side,
    corridorY: sharedCorridorY,
    panelLeftX: surface.x,
    panelRightX: surface.x + surface.width,
    panelTopY,
    panelBottomY,
    feedFromTop: surface.feedFromTop,
    panelInset,
  }
}

export function buildPanelWirePathRegions(surfaces: PanelSceneSurface[]): PanelWirePathRegion[] {
  const regions: PanelWirePathRegion[] = []
  const addRegion = (
    id: string,
    surface: PanelSceneSurface,
    contentTop: number,
    rows: number,
    routingPanel?: Panel
  ) => {
    const rowCount = Math.max(1, rows)
    regions.push({
      id,
      surfaceId: surface.id,
      left: surface.x + PANEL_FRAME_MARGIN / 2,
      right: surface.x + surface.width - PANEL_FRAME_MARGIN / 2,
      horizontalYs: routingPanel
        ? getPanelMainHorizontalRoutingLanes(routingPanel, contentTop, rowCount)
        : Array.from({ length: rowCount + 1 }, (_, gapIndex) => {
            const rowGapCenterY = contentTop - ROW_GAP / 2 + gapIndex * ROW_STRIDE
            if (gapIndex === 0) return rowGapCenterY - ROW_GAP / 2
            if (gapIndex === rowCount) return rowGapCenterY + ROW_GAP / 2
            return rowGapCenterY
          }),
    })
  }

  for (const surface of surfaces) {
    if (surface.kind === 'shared_supply') {
      addRegion(
        `${surface.id}:shared`,
        surface,
        surface.y + PANEL_FRAME_MARGIN,
        Math.max(1, surface.rows)
      )
      continue
    }
    if (surface.kind === 'auxiliary' || surface.kind === 'junction_panel') {
      const routingPanel =
        surface.panel ??
        (surface.enclosure
          ? ({ gridView: surface.enclosure.gridView } as Panel)
          : surface.junctionPanelGridView
            ? ({ gridView: surface.junctionPanelGridView } as Panel)
            : undefined)
      addRegion(
        `${surface.id}:enclosure`,
        surface,
        surface.y + PANEL_FRAME_MARGIN + getTerminalStripTopOffset(routingPanel),
        surface.rows,
        routingPanel
      )
      continue
    }
    const mainContentTop =
      surface.y +
      surface.mainPanelY +
      PANEL_FRAME_MARGIN +
      getTerminalStripTopOffset(getPanelSceneSurfaceGrid(surface))
    const mainRegion = {
      id: `${surface.id}:main`,
      surfaceId: surface.id,
      left: surface.x + PANEL_FRAME_MARGIN / 2,
      right: surface.x + surface.width - PANEL_FRAME_MARGIN / 2,
      horizontalYs: getPanelMainHorizontalRoutingLanes(surface.panel, mainContentTop, surface.rows),
    }
    regions.push(mainRegion)
    if (surface.supplyPanelVisible) {
      addRegion(
        `${surface.id}:supply`,
        surface,
        surface.y + surface.supplyPanelY + PANEL_FRAME_MARGIN,
        surface.supplyRows
      )
    }
  }
  return regions
}

export function buildPanelWirePathLinks(connectors: BuiltPanelScene['connectors']): WirePathSegment[] {
  return connectors.flatMap((connector) => {
    const segments: WirePathSegment[] = []
    for (let index = 0; index <= connector.points.length - 4; index += 2) {
      segments.push({
        from: { x: connector.points[index]!, y: connector.points[index + 1]! },
        to: { x: connector.points[index + 2]!, y: connector.points[index + 3]! },
        fromPortal: index === 0,
        toPortal: index === connector.points.length - 4,
        fromSurfaceId: index === 0 ? connector.sourceSurfaceId ?? connector.hierarchySourceSurfaceId : undefined,
        toSurfaceId: index === connector.points.length - 4 ? connector.targetSurfaceId ?? connector.hierarchyTargetSurfaceId : undefined,
      })
    }
    return segments
  })
}

export const HIERARCHY_PANEL_FRAME_HIT_MARGIN = 18

export const HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT = 40
