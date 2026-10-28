import { useRef, useState } from 'react'
import type { Wall, Point2, Door, Window } from '@/types/schema'
import { type WallOpeningGeometry } from '@/handlers/plan/wallDrawing'
import { type DimensionDragMode } from '@/lib/plan/dimensionDragGesture'
import type { OpeningOnSegment } from '@/lib/plan/constraints'

export function usePlanGeometryGestureState() {
  const [previewWalls, applyPreviewWalls] = useState<Map<string, Wall> | null>(null)
  const [previewDoors, applyPreviewDoors] = useState<Map<string, Door> | null>(null)
  const [previewWindows, applyPreviewWindows] = useState<Map<string, Window> | null>(null)
  const wallDimensionDragRef = useRef<{
    wall: Wall
    doors: Door[]
    windows: Window[]
    segmentIndex: number
    minimumSegmentLength: number
    parallelDragDirection: -1 | 1 | null
  } | null>(null)
  // Selection-drag preview (whole walls moved together) stored outside the store.
  const wallSelectionPreviewRef = useRef<Map<string, Point2[]>>(new Map())
  const stairSelectionPreviewRef = useRef<Map<string, Point2[]>>(new Map())
  const [selectionPreview, applySelectionPreview] = useState(() => ({
    walls: new Map<string, Point2[]>(),
    stairs: new Map<string, Point2[]>(),
  }))
  const pointDragTargetsRef = useRef<Array<{ wallId: string; pointIndex: number }>>([])
  const vertexDragInitialOpeningsRef = useRef<{
    wallId: string
    pointIndex: number
    bySegment: Map<number, OpeningOnSegment[]>
  } | null>(null)
  const doorHoverOpenSideRef = useRef<'left' | 'right'>('right')
  const doorHoverWallIdRef = useRef<string | null>(null)
  const vertexDragAnchorRef = useRef<{ wallId: string; pointIndex: number } | null>(null)
  const vertexDragInitialPointsRef = useRef<Map<string, Point2[]> | null>(null)
  const wallSelectionDragRef = useRef<{
    start: Point2 | null
    initialPointsByWall: Map<string, Point2[]> | null
    indicesByWall: Map<string, Set<number>> | null
    initialPointsByStair: Map<string, Point2[]> | null
    indicesByStair: Map<string, Set<number>> | null
    mode: 'free' | 'horizontal' | 'vertical'
    singlePointTarget: { wallId: string; pointIndex: number } | null
    singlePointCurrentPos: Point2 | null
    /** True only when every affected wall has all its points selected (rigid move). */
    isWholeShapeMove: boolean
  }>({
    start: null,
    initialPointsByWall: null,
    indicesByWall: null,
    initialPointsByStair: null,
    indicesByStair: null,
    mode: 'free',
    singlePointTarget: null,
    singlePointCurrentPos: null,
    isWholeShapeMove: false,
  })
  const stairSelectionDragRef = useRef<{
    stairId: string | null
    pointIndex: number | null
    start: Point2 | null
    initialPoints: Point2[] | null
    mode: 'free' | 'horizontal' | 'vertical'
  }>({
    stairId: null,
    pointIndex: null,
    start: null,
    initialPoints: null,
    mode: 'free',
  })
  const stairPointDragRef = useRef<{
    stairId: string
    pointIndex: number
    initialPoints: Point2[]
    selectedIndices: number[]
  } | null>(null)

  const doorDragRef = useRef<{
    kind: 'door' | 'window'
    entityId: string
    wallId: string
    geom: WallOpeningGeometry
    width: number
    /** Which end of the opening is being dragged so the handle stays under the cursor */
    handleEnd: 'start' | 'end'
    /** Distance from opening center to the visual handle (halfWidth + handleOffset) so we use actual handle position */
    handleOffsetFromCenter: number
  } | null>(null)
  const openingDimensionDragRef = useRef<{
    kind: 'door' | 'window'
    entityId: string
    wall: Wall
    geom: WallOpeningGeometry
    start: Point2
    outwardNormal: Point2
    mode: DimensionDragMode | null
    baseWidth: number
    basePosition: number
    lastResult: { width: number; position: number } | null
  } | null>(null)

  return {
    previewWalls,
    applyPreviewWalls,
    previewDoors,
    applyPreviewDoors,
    previewWindows,
    applyPreviewWindows,
    wallDimensionDragRef,
    wallSelectionPreviewRef,
    stairSelectionPreviewRef,
    selectionPreview,
    applySelectionPreview,
    pointDragTargetsRef,
    vertexDragInitialOpeningsRef,
    doorHoverOpenSideRef,
    doorHoverWallIdRef,
    vertexDragAnchorRef,
    vertexDragInitialPointsRef,
    wallSelectionDragRef,
    stairSelectionDragRef,
    stairPointDragRef,
    doorDragRef,
    openingDimensionDragRef,
  }
}
