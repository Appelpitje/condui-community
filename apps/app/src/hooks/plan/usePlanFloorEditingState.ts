import { useState } from 'react'
import type { Floor, Point2 } from '@/types/schema'
import type { Selection } from '@/types/ui'
import { parseStairPointIds, parseWallPointIds } from '@/lib/plan/planCanvasPointSelection'
import type { OpeningSelectionArmedTool } from './usePlanCanvasToolState'

interface Source {
  isFloorPlanMode: boolean
  activeFloor: Floor | null | undefined
  activeFloorId: string | null
  activeTool: string
  selection: Selection
  shouldHandleWallHover: boolean
  openingSelectionArmedTool: OpeningSelectionArmedTool
}

function mapsEqual(a: Map<string, number[]>, b: Map<string, number[]>) {
  return a.size === b.size && [...a].every(([key, values]) => {
    const other = b.get(key)
    return other?.length === values.length && values.every((value, index) => value === other[index])
  })
}

/** Local editing selections and hover previews follow their original source keys.
 * Native drag sessions and project/UI-store commands remain in the event owner. */
export function usePlanFloorEditingState(source: Source) {
  const { isFloorPlanMode, activeFloor, activeFloorId, activeTool, selection,
    shouldHandleWallHover, openingSelectionArmedTool } = source
  // Wall hover for always-visible WallRenderer; reported by FloorPlanMode when in edit mode
  const [hoveredWallId, applyHoveredWallId] = useState<string | null>(null)
  const [hoveredDoorId, applyHoveredDoorId] = useState<string | null>(null)
  const [hoveredWindowId, applyHoveredWindowId] = useState<string | null>(null)
  const [hoveredStairId, applyHoveredStairId] = useState<string | null>(null)
  const [selectedStairPointIndices, applySelectedStairPointIndices] = useState<
    Map<string, number[]>
  >(new Map())
  // Selected wall point(s) for floor plan editing (wallId -> point indices)
  const [selectedPointIndices, applySelectedPointIndices] = useState<Map<string, number[]>>(
    new Map()
  )
  const [selectedSegmentIndices, applySelectedSegmentIndices] = useState<Map<string, number[]>>(
    new Map()
  )
  const [mixedSelectedDoorIds, applyMixedSelectedDoorIds] = useState<string[]>([])
  const [mixedSelectedWindowIds, applyMixedSelectedWindowIds] = useState<string[]>([])
  // Red preview for clip tool: segment that would be removed
  const [clipPreviewPoints, applyClipPreviewPoints] = useState<Point2[] | null>(null)
  // Ghost door/window preview when hovering with insert door/window tool (only when placement valid)
  const [openingPreview, applyOpeningPreview] = useState<{
    wallId: string
    position: number
    width: number
    kind: 'door' | 'window'
    valid: boolean
    doorSwing?: 'left' | 'right'
    doorDirection?: 'in' | 'out'
  } | null>(null)
  // Insert-point tool: preview the point that would be inserted (hidden when over door/window)
  const [insertPointPreview, applyInsertPointPreview] = useState<Point2 | null>(null)
  const [vertexMoveProjectedSnapGuides, applyVertexMoveProjectedSnapGuides] = useState<
    Array<{ from: Point2; to: Point2; hideDistanceLabel?: boolean }>
  >([])
  const [modeSource, setModeSource] = useState<boolean | null>(null)
  if (modeSource !== isFloorPlanMode) {
    setModeSource(isFloorPlanMode)
    if (!isFloorPlanMode) {
      applyHoveredWallId(null)
      applyHoveredDoorId(null)
      applyHoveredWindowId(null)
      applyHoveredStairId(null)
      applySelectedPointIndices(new Map())
      applySelectedSegmentIndices(new Map())
      applyClipPreviewPoints(null)
    }
  }
  const [mixedSource, setMixedSource] = useState({ isFloorPlanMode, type: selection.type, activeFloorId })
  if (mixedSource.isFloorPlanMode !== isFloorPlanMode || mixedSource.type !== selection.type ||
      mixedSource.activeFloorId !== activeFloorId) {
    setMixedSource({ isFloorPlanMode, type: selection.type, activeFloorId })
    const keepsSelection = ['wall', 'wallPoint', 'stair', 'stairPoint', 'door', 'window'].some(type => type === selection.type)
    if (!isFloorPlanMode || !keepsSelection) {
      applyMixedSelectedDoorIds([])
      applyMixedSelectedWindowIds([])
    }
  }
  const [typeSource, setTypeSource] = useState(selection.type)
  if (typeSource !== selection.type) {
    setTypeSource(selection.type)
    if (selection.type !== 'graphicElement') applyVertexMoveProjectedSnapGuides([])
    if (selection.type !== 'stairPoint' && selection.type !== 'wallPoint') applySelectedStairPointIndices(new Map())
  }
  const pointKey = { isFloorPlanMode, activeFloor, selection,
    selectedPointIndices, selectedStairPointIndices, selectedSegmentIndices }
  const [pointSource, setPointSource] = useState<typeof pointKey | null>(null)
  if (!pointSource || pointSource.isFloorPlanMode !== isFloorPlanMode ||
      pointSource.activeFloor !== activeFloor || pointSource.selection !== selection ||
      pointSource.selectedPointIndices !== selectedPointIndices ||
      pointSource.selectedStairPointIndices !== selectedStairPointIndices ||
      pointSource.selectedSegmentIndices !== selectedSegmentIndices) {
    setPointSource(pointKey)
    if (!isFloorPlanMode || !activeFloor?.floorPlan ||
        (selection.type !== 'wall' && selection.type !== 'wallPoint') || selection.ids.length === 0) {
      if (selectedPointIndices.size) applySelectedPointIndices(new Map())
      if (selectedSegmentIndices.size) applySelectedSegmentIndices(new Map())
    } else if (selection.type === 'wallPoint') {
      const walls = parseWallPointIds(selection.ids)
      const stairs = parseStairPointIds(selection.ids)
      if (!mapsEqual(walls, selectedPointIndices)) applySelectedPointIndices(walls)
      if (!mapsEqual(stairs, selectedStairPointIndices)) applySelectedStairPointIndices(stairs)
      if (selectedSegmentIndices.size) applySelectedSegmentIndices(new Map())
    } else {
      if (selectedStairPointIndices.size) applySelectedStairPointIndices(new Map())
      if (!selectedPointIndices.size) {
        const desired = new Map<string, number[]>()
        for (const id of selection.ids) {
          const wall = activeFloor.floorPlan.walls.find(wall => wall.id === id)
          if (wall) desired.set(id, wall.points.map((_, index) => index))
        }
        if (!mapsEqual(desired, selectedPointIndices)) applySelectedPointIndices(desired)
      }
    }
  }
  const [hoverSource, setHoverSource] = useState(shouldHandleWallHover)
  if (hoverSource !== shouldHandleWallHover) {
    setHoverSource(shouldHandleWallHover)
    if (!shouldHandleWallHover) {
      applyHoveredWallId(null)
      applyClipPreviewPoints(null)
      applyOpeningPreview(null)
      applyInsertPointPreview(null)
    }
  }
  const [openingSource, setOpeningSource] = useState({ activeTool, openingSelectionArmedTool })
  if (openingSource.activeTool !== activeTool || openingSource.openingSelectionArmedTool !== openingSelectionArmedTool) {
    setOpeningSource({ activeTool, openingSelectionArmedTool })
    if (activeTool !== 'insertDoor' && activeTool !== 'insertWindow') applyOpeningPreview(null)
  }
  return {
    hoveredWallId, applyHoveredWallId, hoveredDoorId, applyHoveredDoorId,
    hoveredWindowId, applyHoveredWindowId, hoveredStairId, applyHoveredStairId,
    selectedPointIndices, applySelectedPointIndices, selectedStairPointIndices, applySelectedStairPointIndices,
    selectedSegmentIndices, applySelectedSegmentIndices, mixedSelectedDoorIds, applyMixedSelectedDoorIds,
    mixedSelectedWindowIds, applyMixedSelectedWindowIds, clipPreviewPoints, applyClipPreviewPoints,
    openingPreview, applyOpeningPreview, insertPointPreview, applyInsertPointPreview,
    vertexMoveProjectedSnapGuides, applyVertexMoveProjectedSnapGuides,
  }
}
