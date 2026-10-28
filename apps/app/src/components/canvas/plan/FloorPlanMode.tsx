import { useFloorPlanProjectionSnaps } from '@/components/canvas/plan/useFloorPlanProjectionSnaps'
import { useFloorPlanOpeningPlacement } from '@/components/canvas/plan/useFloorPlanOpeningPlacement'
import { useFloorPlanPointerCoordinates } from '@/components/canvas/plan/useFloorPlanPointerCoordinates'
import { FloorPlanDrawingPreview, type FloorPlanInputEvent } from './FloorPlanDrawingPreview'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useIsActiveViewport } from '@/components/viewport/ViewportUIStore'
import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react'
import { Group, Rect } from 'react-konva'
import { useViewportUIStore as useUIStore } from '@/components/viewport/ViewportUIStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useSettingsStore } from '@/stores/settingsStore'
import { snapToGrid } from '@/utils/plan/gridSnap'
import {
  handleDrawWall,
  handleDrawWallRect,
  computeOpeningGeometry,
} from '@/handlers/plan/wallDrawing'

import {
  computeOpeningDragPlacement,
  openingWidthCentimeters,
} from '@/lib/plan/openingPlacementDrag'
import { computeOpeningDragPreview, type OpeningDragGesture } from '@/lib/plan/openingDragPreview'
import {
  useFloorPlanDrawDimensions,
  useFloorPlanDrawDimensionTimers,
} from './useFloorPlanDrawDimensions'
import type { ToolMode } from '../../plan/PlanImageTools'
import type { Floor, Point2, Wall, Stair } from '@/types/schema'
import {
  createQuarterCircleWallCurve,
  getCurvedWallToolHoverFeedback,
  getWallPathPoints,
  isCurvedWall,
} from '@/lib/plan/wallCurve'
import type { PlanView } from '@/stores/uiStore'

import { resolvePlanCanvasPxPerMeter } from '@/hooks/plan'
import { useCanvasFontFamily, useSetSelectionStore } from '@/editions/community/communityHooks'
import {
  DRAW_TOOL_DASH_PX,
  DRAW_TOOL_HANDLE_RADIUS_PX,
  DRAW_TOOL_HANDLE_RADIUS_PX_MAX,
  DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
  DRAW_TOOL_POINT_RADIUS_PX,
  DRAW_TOOL_POINT_RADIUS_PX_MAX,
  DRAW_TOOL_POINT_RADIUS_PX_MIN,
  DRAW_TOOL_STROKE_PX,
  DRAW_TOOL_STROKE_PX_MAX,
  DRAW_TOOL_STROKE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'

import {
  PLAN_STAIR_DEFAULT_STEP_DEPTH_CM,
  PLAN_STAIR_SPIRAL_POLE_DIAMETER_CM,
  PLAN_STAIR_DEFAULT_WIDTH_CM,
} from '@/constants/planConstants'
import { buildStairGeometry } from '@/components/canvas/plan/StairRenderer'
import { getStairRenderMetrics } from '@/lib/plan/stairPlanScale'
import { PlanProjectionGuides, type PlanProjectionGuide } from './PlanProjectionGuides'
import { planFloorDrawingConsumesTabRef } from '@/lib/plan/planFloorDrawingKeyboardGate'
import { resolveFloorPlanToolContextMenuAction } from '@/lib/plan/floorPlanToolContextMenu'

import {
  cloneFloorPlanDrawingSnapshot,
  isFloorPlanDrawingInProgress,
  MAX_FLOOR_PLAN_DRAWING_UNDO_ENTRIES,
  planFloorDrawingUndoRef,
  type FloorPlanDrawingUndoSnapshot,
} from '@/lib/plan/planFloorDrawingUndo'
import {
  createPlanGraphicElementDraft,
  getPlanGraphicElementAsset,
} from '@/lib/plan/graphicElements'
import {
  clearFloorPlanDrawDimensionEditor,
  setFloorPlanDrawDimensionEditor,
  type FloorPlanDrawDimensionEditor,
} from './floorPlanDrawDimensionEditorStore'

/** Second pointer-down / click inside this window and distance is treated as double-click. */
const FLOOR_PLAN_DRAW_DOUBLE_CLICK_MS = 400
const FLOOR_PLAN_DRAW_DOUBLE_CLICK_DISTANCE_PX = 8

interface FloorPlanModeProps {
  activeFloorId: string | null
  activeFloor: Floor | null | undefined
  currentProject: ProjectState['currentProject']
  planView: PlanView
  gridSize: number
  /** While redefining floor scale, matches the temporary grid px-per-meter from PlanCanvas. */
  tempPxPerMeter?: number | null
  /** Base floor scale px-per-meter used by wall/opening preview in PlanCanvas. */
  previewPxPerMeter?: number | null
  activeTool: ToolMode
  setActiveTool: (tool: ToolMode) => void
  onExitDrawMode: () => void
  selectedGraphicAssetId: string
  /** Report wall under cursor for hover highlight/trim preview; geometry is rendered by PlanCanvas. */
  onWallHover?: (wallId: string | null, pointer: Point2 | null) => void
  /** Main-layer tools publish guides so they stay above the static plan geometry. */
  onProjectedSnapGuidesChange?: (guides: PlanProjectionGuide[]) => void
  /** Notifies parent when a door/window placement is successfully inserted. */
  onOpeningInserted?: (kind: 'door' | 'window') => void
  /** Overrides the parent ghost opening preview while drag-sizing insertion. */
  onOpeningPreviewOverrideChange?: (
    preview: {
      wallId: string
      position: number
      width: number
      kind: 'door' | 'window'
      valid: boolean
      doorSwing?: 'left' | 'right'
      doorDirection?: 'in' | 'out'
    } | null
  ) => void
}

/**
 * Floor Plan Drawing Mode Component
 * Handles all floor plan drawing functionality (walls, doors, windows)
 */
export function FloorPlanMode({
  activeFloorId,
  activeFloor,
  currentProject,
  planView,
  gridSize,
  tempPxPerMeter = null,
  previewPxPerMeter = null,
  activeTool,
  setActiveTool,
  onExitDrawMode,
  selectedGraphicAssetId,
  onWallHover,
  onProjectedSnapGuidesChange,
  onOpeningInserted,
  onOpeningPreviewOverrideChange,
}: FloorPlanModeProps) {
  const window = useCanvasWindow()
  const isActiveViewport = useIsActiveViewport()
  const viewportSize = useUIStore((s) => s.planCanvasViewportPx)
  // Drawing must own the visible viewport even on large plans far from (0, 0).
  const hitZoom = Math.max(0.0001, planView.zoom)
  const hitPadding = 64
  const hitArea = {
    x: (-planView.pan.x - hitPadding) / hitZoom,
    y: (-planView.pan.y - hitPadding) / hitZoom,
    width: ((viewportSize?.width ?? window.innerWidth) + hitPadding * 2) / hitZoom,
    height: ((viewportSize?.height ?? window.innerHeight) + hitPadding * 2) / hitZoom,
  }
  const selection = useUIStore((s) => s.selection)
  const setSelection = useSetSelectionStore()
  const getWallsByFloor = useProjectStore((s: ProjectState) => s.getWallsByFloor)
  const wallDrawingThicknessCm = useUIStore((s) => s.planWallDrawingThicknessCm)
  const theme = useSettingsStore((s) => s.theme)
  const canvasPxPerMeter = useMemo(
    () =>
      resolvePlanCanvasPxPerMeter(activeFloor ?? null, planView.gridSize, gridSize, tempPxPerMeter),
    [activeFloor, planView.gridSize, gridSize, tempPxPerMeter]
  )
  const fontFamily = useCanvasFontFamily()

  // Floor plan drawing state
  const [wallDrawingState, setWallDrawingState] = useState<{
    currentPoints: Point2[]
    isDrawing: boolean
    startPoint: Point2 | null
    rectStartPoint: Point2 | null
    pendingCurve?: boolean
  }>({
    currentPoints: [],
    isDrawing: false,
    startPoint: null,
    rectStartPoint: null,
    pendingCurve: false,
  })
  const [currentMousePosition, setCurrentMousePosition] = useState<Point2 | null>(null)
  const [stairDrawingPoints, setStairDrawingPoints] = useState<Point2[]>([])
  const [openingPointerState, setOpeningPointerState] = useState<OpeningDragGesture | null>(null)
  const [graphicPointerState, setGraphicPointerState] = useState<{
    start: Point2
    current: Point2
    didDrag: boolean
  } | null>(null)
  const [projectedSnapGuides, setProjectedSnapGuides] = useState<
    Array<{ from: Point2; to: Point2; hideDistanceLabel?: boolean }>
  >([])
  const [activeGeometrySnap, setActiveGeometrySnap] = useState<{
    point: Point2
    kind: 'endpoint' | 'line'
  } | null>(null)
  const previousToolRef = useRef<ToolMode>(activeTool)
  const isFinalizingPenRef = useRef(false)
  const suppressAutoCommitRef = useRef(false)
  const suppressStairAutoCommitRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const isShiftPressedRef = useRef(false)
  const penPointerDownRef = useRef<Point2 | null>(null)
  const penPointerCaptureTargetRef = useRef<HTMLElement | null>(null)
  const penPointerCaptureIdRef = useRef<number | null>(null)
  const penDidDragRef = useRef(false)
  const penCurveGestureRef = useRef(false)
  const penLastPointerDownTimeRef = useRef(0)
  const penLastPointerDownPointRef = useRef<Point2 | null>(null)
  const penDoubleClickDetectedRef = useRef(false)
  const stairLastClickTimeRef = useRef(0)
  const rectPointerDownRef = useRef<Point2 | null>(null)
  const rectDidDragRef = useRef(false)
  const stairPointerDownRef = useRef<Point2 | null>(null)
  const stairDidDragRef = useRef(false)
  const graphicDidDragRef = useRef(false)
  const draftPointDragRef = useRef<{ tool: 'drawWall' | 'drawStair'; index: number } | null>(null)
  const draftPointDidDragRef = useRef(false)
  const suppressDraftPointTapUntilRef = useRef(0)
  /** Mirrors rect pointer down so we can hide the first-corner snap dot while dragging (refs don't re-render). */
  const [rectPointerActive, setRectPointerActive] = useState(false)
  const mousePreviewPositionRef = useRef<Point2 | null>(null)
  const pendingMousePreviewPositionRef = useRef<Point2 | null>(null)
  const mousePreviewRafRef = useRef<number | null>(null)
  /** Stage-space pointer from last move; used to re-snap previews when zoom/pan changes without a move event. */
  const lastStagePointerRef = useRef<{ x: number; y: number } | null>(null)
  const didClearWallHoverRef = useRef(false)
  const doorPlacementOpenSideRef = useRef<'left' | 'right'>('right')
  const stageContainerRef = useRef<HTMLElement | null>(null)
  const drawingUndoStackRef = useRef<FloorPlanDrawingUndoSnapshot[]>([])
  const drawingRedoStackRef = useRef<FloorPlanDrawingUndoSnapshot[]>([])
  const wallDrawingStateRef = useRef(wallDrawingState)
  const stairDrawingPointsRef = useRef(stairDrawingPoints)
  useLayoutEffect(() => {
    wallDrawingStateRef.current = wallDrawingState
    stairDrawingPointsRef.current = stairDrawingPoints
  }, [wallDrawingState, stairDrawingPoints])

  const captureDrawingSnapshot = useCallback((): FloorPlanDrawingUndoSnapshot => {
    return cloneFloorPlanDrawingSnapshot(wallDrawingStateRef.current, stairDrawingPointsRef.current)
  }, [])

  const clearDrawingUndoStacks = useCallback(() => {
    drawingUndoStackRef.current = []
    drawingRedoStackRef.current = []
  }, [])

  const pointsAlmostEqual = useCallback((a: Point2 | null, b: Point2 | null, epsilon = 1e-4) => {
    if (!a && !b) return true
    if (!a || !b) return false
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= epsilon
  }, [])

  const scheduleMousePreviewPosition = useCallback(
    (next: Point2 | null) => {
      pendingMousePreviewPositionRef.current = next
      if (mousePreviewRafRef.current != null) return
      mousePreviewRafRef.current = requestAnimationFrame(() => {
        mousePreviewRafRef.current = null
        const pending = pendingMousePreviewPositionRef.current
        pendingMousePreviewPositionRef.current = null
        if (pointsAlmostEqual(mousePreviewPositionRef.current, pending)) return
        mousePreviewPositionRef.current = pending
        setCurrentMousePosition(pending)
      })
    },
    [pointsAlmostEqual]
  )

  const dimensionSource = {
    isDrawing: wallDrawingState.isDrawing,
    currentPoints: wallDrawingState.currentPoints,
    rectStartPoint: wallDrawingState.rectStartPoint,
    canvasPxPerMeter,
    window,
    scheduleMousePreviewPosition,
  }
  const dimensions = useFloorPlanDrawDimensions(dimensionSource)
  const {
    penDimensionText,
    setPenDimensionText,
    penLockedLengthMeters,
    setPenLockedLengthMeters,
    rectDimensionTextX,
    setRectDimensionTextX,
    rectDimensionTextY,
    setRectDimensionTextY,
    rectLockedXMeters,
    rectLockedYMeters,
    rectActiveAxis,
    setRectActiveAxis,
    clearPenConstraints,
    clearRectConstraints,
  } = dimensions
  const readMousePreviewPosition = useCallback(() => mousePreviewPositionRef.current, [])

  const resetDrawingState = useCallback(() => {
    pendingMousePreviewPositionRef.current = null
    mousePreviewPositionRef.current = null
    setWallDrawingState({
      currentPoints: [],
      isDrawing: false,
      startPoint: null,
      rectStartPoint: null,
      pendingCurve: false,
    })
    setCurrentMousePosition(null)
    setProjectedSnapGuides([])
    setActiveGeometrySnap(null)
    clearPenConstraints()
    clearRectConstraints()
    setRectPointerActive(false)
    setOpeningPointerState(null)
    doorPlacementOpenSideRef.current = 'right'
    setGraphicPointerState(null)
    rectPointerDownRef.current = null
    rectDidDragRef.current = false
    stairPointerDownRef.current = null
    stairDidDragRef.current = false
    graphicDidDragRef.current = false
    draftPointDragRef.current = null
    draftPointDidDragRef.current = false
    suppressDraftPointTapUntilRef.current = 0
    penLastPointerDownTimeRef.current = 0
    penLastPointerDownPointRef.current = null
    penDoubleClickDetectedRef.current = false
    lastStagePointerRef.current = null
    clearDrawingUndoStacks()
  }, [clearDrawingUndoStacks, clearPenConstraints, clearRectConstraints])

  const applyDrawingSnapshot = useCallback(
    (snapshot: FloorPlanDrawingUndoSnapshot) => {
      setWallDrawingState({
        ...snapshot.wallDrawingState,
        currentPoints: [...snapshot.wallDrawingState.currentPoints],
      })
      setStairDrawingPoints([...snapshot.stairDrawingPoints])
      clearPenConstraints()
      clearRectConstraints()
      scheduleMousePreviewPosition(null)
      setProjectedSnapGuides([])
    },
    [clearPenConstraints, clearRectConstraints, scheduleMousePreviewPosition]
  )

  const pushDrawingUndoBeforeMutation = useCallback(() => {
    const next = captureDrawingSnapshot()
    drawingUndoStackRef.current.push(next)
    if (drawingUndoStackRef.current.length > MAX_FLOOR_PLAN_DRAWING_UNDO_ENTRIES) {
      drawingUndoStackRef.current.shift()
    }
    drawingRedoStackRef.current = []
  }, [captureDrawingSnapshot])

  const tryUndoDrawing = useCallback((): boolean => {
    if (
      !isFloorPlanDrawingInProgress(
        activeTool,
        wallDrawingStateRef.current,
        stairDrawingPointsRef.current
      )
    ) {
      return false
    }
    if (drawingUndoStackRef.current.length === 0) return false
    const current = captureDrawingSnapshot()
    const previous = drawingUndoStackRef.current.pop()
    if (!previous) return false
    drawingRedoStackRef.current.push(current)
    applyDrawingSnapshot(previous)
    return true
  }, [activeTool, applyDrawingSnapshot, captureDrawingSnapshot])

  const tryRedoDrawing = useCallback((): boolean => {
    if (
      !isFloorPlanDrawingInProgress(
        activeTool,
        wallDrawingStateRef.current,
        stairDrawingPointsRef.current
      )
    ) {
      return false
    }
    if (drawingRedoStackRef.current.length === 0) return false
    const current = captureDrawingSnapshot()
    const next = drawingRedoStackRef.current.pop()
    if (!next) return false
    drawingUndoStackRef.current.push(current)
    applyDrawingSnapshot(next)
    return true
  }, [activeTool, applyDrawingSnapshot, captureDrawingSnapshot])

  const commitWallWithUndo = useCallback(
    (floorId: string, points: Point2[], curve?: Wall['curve']) => {
      runProjectCommand(
        'plan.createBuildingGeometry',
        {
          kind: 'wall',
          floorId,
          points,
          curve,
          thickness: wallDrawingThicknessCm,
        },
        { label: 'add wall', source: 'floor-plan-drawing' }
      )
      clearDrawingUndoStacks()
    },
    [clearDrawingUndoStacks, wallDrawingThicknessCm]
  )

  const commitStairWithUndo = useCallback(
    (floorId: string, stair: Omit<Stair, 'id'>) => {
      runProjectCommand(
        'plan.createBuildingGeometry',
        {
          kind: 'stair',
          ...stair,
          floorId,
        },
        { label: 'add stair', source: 'floor-plan-drawing' }
      )
      clearDrawingUndoStacks()
    },
    [clearDrawingUndoStacks]
  )

  const commitCurrentPenDrawing = useCallback(() => {
    if (isFinalizingPenRef.current) return false
    if (!activeFloorId) return false
    if (
      !wallDrawingState.isDrawing ||
      wallDrawingState.pendingCurve ||
      wallDrawingState.currentPoints.length < 2
    )
      return false
    isFinalizingPenRef.current = true
    commitWallWithUndo(activeFloorId, wallDrawingState.currentPoints)
    resetDrawingState()
    requestAnimationFrame(() => {
      isFinalizingPenRef.current = false
    })
    return true
  }, [
    activeFloorId,
    wallDrawingState.isDrawing,
    wallDrawingState.pendingCurve,
    wallDrawingState.currentPoints,
    commitWallWithUndo,
    resetDrawingState,
  ])

  useEffect(() => {
    if (
      !activeFloorId ||
      !wallDrawingState.pendingCurve ||
      wallDrawingState.currentPoints.length < 3
    )
      return
    commitWallWithUndo(
      activeFloorId,
      wallDrawingState.currentPoints.slice(0, 3),
      createQuarterCircleWallCurve()
    )
    resetDrawingState()
  }, [
    activeFloorId,
    commitWallWithUndo,
    resetDrawingState,
    wallDrawingState.currentPoints,
    wallDrawingState.pendingCurve,
  ])

  const commitCurrentRectangleDrawing = useCallback(() => {
    const start = wallDrawingState.rectStartPoint
    const end = mousePreviewPositionRef.current
    if (!activeFloorId || !start || !end) return false
    const points = handleDrawWallRect(start, end, gridSize, false)
    if (points.length < 2) return false
    commitWallWithUndo(activeFloorId, points)
    resetDrawingState()
    return true
  }, [
    activeFloorId,
    commitWallWithUndo,
    gridSize,
    resetDrawingState,
    wallDrawingState.rectStartPoint,
  ])

  const commitCurrentStairDrawing = useCallback(() => {
    if (!activeFloorId || stairDrawingPoints.length < 1) return false
    const stair: Omit<Stair, 'id'> = {
      floorId: activeFloorId,
      points: stairDrawingPoints.length === 1 ? [stairDrawingPoints[0]!] : stairDrawingPoints,
      width: (PLAN_STAIR_DEFAULT_WIDTH_CM / 100) * canvasPxPerMeter,
      stepDepth: (PLAN_STAIR_DEFAULT_STEP_DEPTH_CM / 100) * canvasPxPerMeter,
      spiralPoleDiameter: (PLAN_STAIR_SPIRAL_POLE_DIAMETER_CM / 100) * canvasPxPerMeter,
      cornerStyle: 'round',
      cornerMode: 'turn',
      showUpArrow: false,
      invertUpArrow: true,
      spiralRotationDeg: 0,
    }
    commitStairWithUndo(activeFloorId, stair)
    setStairDrawingPoints([])
    scheduleMousePreviewPosition(null)
    return true
  }, [
    activeFloorId,
    stairDrawingPoints,
    canvasPxPerMeter,
    commitStairWithUndo,
    scheduleMousePreviewPosition,
  ])

  const commitGraphicElement = useCallback(
    (start: Point2, end: Point2, useDraggedSize: boolean) => {
      if (!activeFloorId || !selectedGraphicAssetId || canvasPxPerMeter <= 0) return
      const asset = getPlanGraphicElementAsset(selectedGraphicAssetId)
      if (!asset) return

      const left = Math.min(start.x, end.x)
      const right = Math.max(start.x, end.x)
      const top = Math.min(start.y, end.y)
      const bottom = Math.max(start.y, end.y)
      const draggedWidth = right - left
      const draggedHeight = bottom - top
      const draggedLargeEnough = draggedWidth >= 4 && draggedHeight >= 4

      if (useDraggedSize && draggedLargeEnough && !asset.sizeLocked) {
        runProjectCommand('plan.createBuildingGeometry', {
          kind: 'graphicElement',
          floorId: activeFloorId,
          elementKind: asset.kind,
          assetId: asset.id,
          pos: { x: left + draggedWidth / 2, y: top + draggedHeight / 2 },
          width: draggedWidth,
          height: draggedHeight,
          rotationDeg: 0,
          sizeLocked: asset.sizeLocked,
          layer: 'floor-plan-graphics',
        })
        return
      }

      const defaultPos =
        useDraggedSize && draggedLargeEnough
          ? { x: left + draggedWidth / 2, y: top + draggedHeight / 2 }
          : end
      const draft = createPlanGraphicElementDraft(
        activeFloorId,
        asset.id,
        defaultPos,
        canvasPxPerMeter
      )
      if (draft) {
        const { floorId, kind, ...element } = draft
        runProjectCommand(
          'plan.createBuildingGeometry',
          {
            kind: 'graphicElement',
            floorId,
            elementKind: kind,
            ...element,
          },
          { label: 'add plan graphic', source: 'floor-plan-drawing' }
        )
      }
    },
    [activeFloorId, canvasPxPerMeter, selectedGraphicAssetId]
  )

  const {
    rememberStageContainer,
    capturePenPointer,
    releasePenPointer,
    clientCoordsToCanvasPoint,
    getCanvasPointFromEvent,
  } = useFloorPlanPointerCoordinates({
    stageContainerRef,
    penPointerCaptureTargetRef,
    penPointerCaptureIdRef,
    planView,
  })

  const snapPointToPenAngle = useCallback((start: Point2, target: Point2): Point2 => {
    const dx = target.x - start.x
    const dy = target.y - start.y
    const length = Math.sqrt(dx * dx + dy * dy)
    if (length <= 1e-6) return target
    const angle = Math.atan2(dy, dx)
    const step = Math.PI / 4
    const snappedAngle = Math.round(angle / step) * step
    return {
      x: start.x + Math.cos(snappedAngle) * length,
      y: start.y + Math.sin(snappedAngle) * length,
    }
  }, [])

  const pointsMatch = useCallback((a: Point2, b: Point2, epsilon = 1e-4) => {
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
  }, [])

  const {
    findClosestWallForOpening,
    resolveOpeningAnchor,
    getDefaultOpeningWidth,
    getOpeningPlacementOptions,
    resolvePlacementDoorOrientation,
    commitOpeningInsert,
  } = useFloorPlanOpeningPlacement({
    activeFloorId,
    getWallsByFloor,
    planView,
    gridSize,
    canvasPxPerMeter,
    previewPxPerMeter,
    activeFloor,
    doorPlacementOpenSideRef,
    currentProject,
    onOpeningInserted,
    setSelection,
  })

  const { resolveNearbyLineSnap, resolveProjectedPenSnap } = useFloorPlanProjectionSnaps({
    pointsMatch,
    planView,
    activeFloor,
    wallDrawingState,
    stairDrawingPoints,
    gridSize,
  })

  const isFloorPlanHitTarget = useCallback((e: FloorPlanInputEvent) => {
    const targetType = e.target.getType?.()
    const targetName = e.target.name?.()
    const isTransparentRect =
      (targetType === 'Rect' || targetType === 'Shape') && targetName === 'floor-plan-hit-area'
    const isGroup = e.target === e.currentTarget
    const isDraftPoint = targetName === 'floor-plan-draft-point'
    if (isDraftPoint) return false
    return isTransparentRect || isGroup
  }, [])

  const appendPenPoint = useCallback(
    (
      rawPoint: Point2,
      options?: {
        snapTo45Degrees?: boolean
        lockedLengthMeters?: number | null
        commitSegment?: boolean
      }
    ) => {
      if (!activeFloorId) return
      pushDrawingUndoBeforeMutation()

      const walls = getWallsByFloor(activeFloorId)
      const nearbyLine = resolveNearbyLineSnap(rawPoint, { excludeCurrentTail: 'drawWall' })
      let pointToUse = nearbyLine?.point ?? rawPoint
      const shouldSnapTo45Degrees = options?.snapTo45Degrees === true
      const effectiveLockedLengthMeters =
        options && 'lockedLengthMeters' in options
          ? options.lockedLengthMeters
          : penLockedLengthMeters

      if (
        !nearbyLine &&
        shouldSnapTo45Degrees &&
        wallDrawingState.isDrawing &&
        wallDrawingState.currentPoints.length > 0
      ) {
        const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
        pointToUse = snapPointToPenAngle(start, pointToUse)
      } else if (!nearbyLine) {
        const projected =
          planView.snapToProjection !== false ? resolveProjectedPenSnap(pointToUse, walls) : null
        if (projected && projected.length > 0) {
          pointToUse = projected[0]!.snappedPoint
          if (projected.length > 1) {
            pointToUse = projected[1]!.snappedPoint
          }
        }
      }

      if (
        wallDrawingState.isDrawing &&
        wallDrawingState.currentPoints.length > 0 &&
        effectiveLockedLengthMeters &&
        canvasPxPerMeter
      ) {
        const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
        const dx = rawPoint.x - start.x
        const dy = rawPoint.y - start.y
        const len = Math.sqrt(dx * dx + dy * dy)
        const targetPx = effectiveLockedLengthMeters * canvasPxPerMeter
        if (len > 1e-6 && targetPx > 0) {
          const scale = targetPx / len
          pointToUse = {
            x: start.x + dx * scale,
            y: start.y + dy * scale,
          }
        }
      }

      const result = handleDrawWall(
        pointToUse,
        {
          mode: 'drawWall',
          currentWall: null,
          currentPoints: wallDrawingState.currentPoints,
          isDrawing: wallDrawingState.isDrawing,
          startPoint: wallDrawingState.startPoint,
          selectedPointIndex: null,
          selectedWallId: null,
        },
        gridSize,
        !nearbyLine &&
          !(effectiveLockedLengthMeters && canvasPxPerMeter) &&
          planView.snapToGrid &&
          !shouldSnapTo45Degrees,
        walls
      )

      const nextState = {
        ...wallDrawingState,
        isDrawing: result.isDrawing ?? wallDrawingState.isDrawing,
        currentPoints: result.currentPoints ?? wallDrawingState.currentPoints,
        startPoint: result.startPoint ?? wallDrawingState.startPoint,
      }

      // If the new point closes the loop (near the first point), snap and commit a closed wall immediately.
      if (
        !wallDrawingState.pendingCurve &&
        nextState.isDrawing &&
        nextState.currentPoints.length >= 3
      ) {
        const first = nextState.currentPoints[0]!
        const lastIndex = nextState.currentPoints.length - 1
        const last = nextState.currentPoints[lastIndex]!
        const dx = last.x - first.x
        const dy = last.y - first.y
        const distSq = dx * dx + dy * dy
        const CLOSE_EPSILON_SQ = 10 * 10 // ~10 px in canvas space

        if (distSq <= CLOSE_EPSILON_SQ) {
          const normalizedPoints = [...nextState.currentPoints]
          // Snap the last point exactly onto the first so we don't get
          // nearly-duplicate vertices that produce spiky joins.
          normalizedPoints[lastIndex] = first

          commitWallWithUndo(activeFloorId, normalizedPoints)

          // Fully reset drawing state and clear constraints.
          resetDrawingState()
          setWallDrawingState({
            currentPoints: [],
            isDrawing: false,
            startPoint: null,
            rectStartPoint: null,
            pendingCurve: false,
          })
          setActiveTool('drawWall')
          return
        }
      }

      if (options?.commitSegment && nextState.currentPoints.length >= 2) {
        commitWallWithUndo(activeFloorId, nextState.currentPoints)
        resetDrawingState()
        setActiveTool('drawWall')
        return
      }

      // After committing this vertex (i.e. after finishing the current segment),
      // dimension constraints are ephemeral and must be reset so the next
      // segment starts "fresh".
      clearPenConstraints()
      setProjectedSnapGuides([])
      setActiveGeometrySnap(null)
      setWallDrawingState(nextState)
    },
    [
      activeFloorId,
      getWallsByFloor,
      gridSize,
      planView.snapToGrid,
      planView.snapToProjection,
      penLockedLengthMeters,
      canvasPxPerMeter,
      clearPenConstraints,
      wallDrawingState,
      commitWallWithUndo,
      pushDrawingUndoBeforeMutation,
      resetDrawingState,
      setActiveTool,
      snapPointToPenAngle,
      resolveProjectedPenSnap,
      resolveNearbyLineSnap,
    ]
  )

  const resolveStairDrawingSnap = useCallback(
    (rawPoint: Point2) => {
      const nearbyLine = resolveNearbyLineSnap(rawPoint, { excludeCurrentTail: 'drawStair' })
      if (nearbyLine) return { point: nearbyLine.point, guides: [] }
      let point = rawPoint
      const walls = activeFloorId ? getWallsByFloor(activeFloorId) : []
      const projected =
        planView.snapToProjection !== false ? resolveProjectedPenSnap(point, walls) : null

      if (projected && projected.length > 0) {
        point = projected[projected.length - 1]!.snappedPoint
      }
      point = snapToGrid(point, gridSize, planView.snapToGrid)

      const guides = (projected ?? []).map((projection) => {
        const isVerticalGuide = Math.abs(projection.guideFrom.x - projection.guideTo.x) <= 1e-6
        return {
          from: projection.guideFrom,
          to: isVerticalGuide
            ? { x: projection.guideFrom.x, y: point.y }
            : { x: point.x, y: projection.guideFrom.y },
        }
      })

      return { point, guides }
    },
    [
      activeFloorId,
      getWallsByFloor,
      gridSize,
      planView.snapToGrid,
      planView.snapToProjection,
      resolveProjectedPenSnap,
      resolveNearbyLineSnap,
    ]
  )

  // Register after the pending curved-wall command effect: it resets drawing first.
  useFloorPlanDrawDimensionTimers(dimensionSource, dimensions, readMousePreviewPosition)

  // Track Shift globally so pointer/touch handlers can reliably read modifier state.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveViewport()) return
      if (e.key === 'Shift') {
        isShiftPressedRef.current = true
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftPressedRef.current = false
      }
    }
    const handleWindowBlur = () => {
      isShiftPressedRef.current = false
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [isActiveViewport, window])

  useEffect(() => {
    planFloorDrawingUndoRef.current = {
      tryUndo: tryUndoDrawing,
      tryRedo: tryRedoDrawing,
      pushBeforeMutation: pushDrawingUndoBeforeMutation,
      clearStacks: clearDrawingUndoStacks,
    }
    return () => {
      planFloorDrawingUndoRef.current = null
    }
  }, [tryUndoDrawing, tryRedoDrawing, pushDrawingUndoBeforeMutation, clearDrawingUndoStacks])

  const commitPenDimensionInput = useCallback(() => {
    if (activeTool !== 'drawWall' || !wallDrawingState.isDrawing) return
    const previewPoint = mousePreviewPositionRef.current

    // A curved gesture needs its third point to be added first; the existing
    // pending-curve effect then commits the curve. Straight pen input should
    // finish the current segment immediately instead of adding another point.
    if (wallDrawingState.pendingCurve) {
      if (!previewPoint) return
      appendPenPoint(previewPoint)
      return
    }

    const typedCentimeters = Number.parseFloat(penDimensionText.trim().replace(',', '.'))
    const hasTypedLength = Number.isFinite(typedCentimeters) && typedCentimeters > 0

    // Without a typed length, Enter finishes the polyline as drawn. A typed length
    // always adds that segment first, also after earlier segments were clicked.
    if (
      wallDrawingState.currentPoints.length >= 2 &&
      activeFloorId &&
      !(hasTypedLength && previewPoint)
    ) {
      commitWallWithUndo(activeFloorId, wallDrawingState.currentPoints)
      resetDrawingState()
      setActiveTool('drawWall')
      return
    }

    if (!previewPoint) return

    appendPenPoint(previewPoint, {
      lockedLengthMeters: hasTypedLength ? typedCentimeters / 100 : penLockedLengthMeters,
      commitSegment: true,
    })
  }, [
    activeTool,
    wallDrawingState.isDrawing,
    wallDrawingState.pendingCurve,
    wallDrawingState.currentPoints,
    activeFloorId,
    commitWallWithUndo,
    resetDrawingState,
    setActiveTool,
    penDimensionText,
    appendPenPoint,
    penLockedLengthMeters,
  ])

  const cancelDrawingTool = useCallback(() => {
    setOpeningPointerState(null)
    onOpeningPreviewOverrideChange?.(null)
    onWallHover?.(null, null)
    if (wallDrawingState.isDrawing || wallDrawingState.rectStartPoint) resetDrawingState()
    if (activeTool === 'drawWall') suppressAutoCommitRef.current = true
    if (activeTool === 'drawStair') {
      suppressStairAutoCommitRef.current = true
      setStairDrawingPoints([])
      stairLastClickTimeRef.current = 0
      resetDrawingState()
    }
    if (activeTool !== 'select') setActiveTool('select')
    else onExitDrawMode()
  }, [
    activeTool,
    wallDrawingState.isDrawing,
    wallDrawingState.rectStartPoint,
    resetDrawingState,
    onOpeningPreviewOverrideChange,
    onWallHover,
    setActiveTool,
    onExitDrawMode,
  ])

  const drawDimensionEditor = useMemo<FloorPlanDrawDimensionEditor | null>(() => {
    if (!currentMousePosition) return null

    if (
      activeTool === 'drawWall' &&
      wallDrawingState.isDrawing &&
      wallDrawingState.currentPoints.length > 0
    ) {
      const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
      const dx = currentMousePosition.x - start.x
      const dy = currentMousePosition.y - start.y
      const centimeters = (Math.sqrt(dx * dx + dy * dy) / canvasPxPerMeter) * 100
      return {
        ownerId: 'draw-tool',
        fields: [
          {
            id: 'length',
            anchor: {
              x: (start.x + currentMousePosition.x) / 2,
              y: (start.y + currentMousePosition.y) / 2,
            },
            placement: 'center',
            value: penDimensionText || centimeters.toFixed(1),
            live: !penDimensionText,
            active: true,
          },
        ],
        onActivate: () => undefined,
        onChange: (_id, value) => setPenDimensionText(value),
        onEnter: commitPenDimensionInput,
        onTab: () => undefined,
        onEscape: cancelDrawingTool,
      }
    }

    if (activeTool === 'drawWallRect' && wallDrawingState.rectStartPoint) {
      const start = wallDrawingState.rectStartPoint
      let end = snapToGrid(currentMousePosition, gridSize, planView.snapToGrid)
      if (rectLockedXMeters != null) {
        end = {
          ...end,
          x: start.x + (end.x >= start.x ? 1 : -1) * rectLockedXMeters * canvasPxPerMeter,
        }
      }
      if (rectLockedYMeters != null) {
        end = {
          ...end,
          y: start.y + (end.y >= start.y ? 1 : -1) * rectLockedYMeters * canvasPxPerMeter,
        }
      }

      const widthPx = Math.abs(end.x - start.x)
      const heightPx = Math.abs(end.y - start.y)
      const fields: FloorPlanDrawDimensionEditor['fields'] = []
      if (widthPx > 1e-3) {
        fields.push({
          id: 'x',
          anchor: { x: (start.x + end.x) / 2, y: start.y },
          placement: 'above',
          value: rectDimensionTextX || ((widthPx / canvasPxPerMeter) * 100).toFixed(1),
          live: !rectDimensionTextX,
          active: rectActiveAxis === 'x',
        })
      }
      if (heightPx > 1e-3) {
        fields.push({
          id: 'y',
          anchor: { x: end.x, y: (start.y + end.y) / 2 },
          placement: 'right',
          value: rectDimensionTextY || ((heightPx / canvasPxPerMeter) * 100).toFixed(1),
          live: !rectDimensionTextY,
          active: rectActiveAxis === 'y',
        })
      }
      if (fields.length === 0) return null

      return {
        ownerId: 'draw-tool',
        fields,
        onActivate: (id) => {
          if (id === 'x' || id === 'y') setRectActiveAxis(id)
        },
        onChange: (id, value) => {
          if (id === 'x') setRectDimensionTextX(value)
          if (id === 'y') setRectDimensionTextY(value)
        },
        onEnter: () => undefined,
        onTab: () => setRectActiveAxis((axis) => (axis === 'x' ? 'y' : 'x')),
        onEscape: cancelDrawingTool,
      }
    }

    return null
  }, [
    setPenDimensionText,
    setRectActiveAxis,
    setRectDimensionTextX,
    setRectDimensionTextY,
    cancelDrawingTool,
    activeTool,
    currentMousePosition,
    wallDrawingState.isDrawing,
    wallDrawingState.currentPoints,
    wallDrawingState.rectStartPoint,
    canvasPxPerMeter,
    penDimensionText,
    commitPenDimensionInput,
    gridSize,
    planView.snapToGrid,
    rectLockedXMeters,
    rectLockedYMeters,
    rectDimensionTextX,
    rectDimensionTextY,
    rectActiveAxis,
  ])

  useEffect(() => {
    if (drawDimensionEditor) setFloorPlanDrawDimensionEditor(drawDimensionEditor)
    else clearFloorPlanDrawDimensionEditor('draw-tool')
  }, [drawDimensionEditor])

  useEffect(() => () => clearFloorPlanDrawDimensionEditor('draw-tool'), [])

  // Expose drawing mode so global Tab (dock collapse) can defer to dimension typing.
  useEffect(() => {
    const isPenTool = activeTool === 'drawWall'
    const isRectTool = activeTool === 'drawWallRect'
    const isStairTool = activeTool === 'drawStair'
    const isPenDrawing = isPenTool && wallDrawingState.isDrawing
    const isRectDrawing = isRectTool && !!wallDrawingState.rectStartPoint
    const isStairDrawing = isStairTool && stairDrawingPoints.length > 0
    planFloorDrawingConsumesTabRef.current = isPenDrawing || isRectDrawing || isStairDrawing
    return () => {
      planFloorDrawingConsumesTabRef.current = false
    }
  }, [activeTool, wallDrawingState.isDrawing, wallDrawingState.rectStartPoint, stairDrawingPoints])

  // Handle keyboard events for floor plan mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveViewport()) return
      const target = e.target
      const isNativeDimensionInput =
        (target as HTMLElement | null)?.nodeType === 1 &&
        (target as HTMLElement).dataset.floorPlanDimensionInput === 'true'
      if (isNativeDimensionInput && e.key !== 'Escape') return
      if (isKeyboardTypingTarget(target) && !isNativeDimensionInput) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelDrawingTool()
        return
      }

      const isPenTool = activeTool === 'drawWall'
      const isRectTool = activeTool === 'drawWallRect'
      const isStairTool = activeTool === 'drawStair'
      const isPenDrawing = isPenTool && wallDrawingState.isDrawing
      const isRectDrawing = isRectTool && !!wallDrawingState.rectStartPoint
      const isStairDrawing = isStairTool && stairDrawingPoints.length > 0

      if (!isPenDrawing && !isRectDrawing && !isStairDrawing) {
        // Non-drawing deletion is handled centrally in usePlanKeyboard.
        return
      }

      if (e.key === 'Tab') {
        if (e.repeat) return
        e.preventDefault()
        e.stopPropagation()
        if (isRectDrawing) {
          setRectActiveAxis((prev) => (prev === 'x' ? 'y' : 'x'))
        }
        return
      }

      if (e.key === 'Enter') {
        if (e.repeat) return
        e.preventDefault()
        e.stopPropagation()
        if (isPenDrawing) {
          commitPenDimensionInput()
        } else if (isStairDrawing) {
          commitCurrentStairDrawing()
        }
        return
      }

      if (e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        if (isPenDrawing) {
          setPenDimensionText((prev) => prev.slice(0, -1))
        } else if (isRectDrawing) {
          if (rectActiveAxis === 'x') {
            setRectDimensionTextX((prev) => prev.slice(0, -1))
          } else {
            setRectDimensionTextY((prev) => prev.slice(0, -1))
          }
        }
        return
      }

      if (e.key.length === 1 && /[0-9.,]/.test(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        if (isPenDrawing) {
          setPenDimensionText((prev) => prev + e.key)
        } else if (isRectDrawing) {
          if (rectActiveAxis === 'x') {
            setRectDimensionTextX((prev) => prev + e.key)
          } else {
            setRectDimensionTextY((prev) => prev + e.key)
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    setPenDimensionText,
    setRectActiveAxis,
    setRectDimensionTextX,
    setRectDimensionTextY,
    cancelDrawingTool,
    wallDrawingState.isDrawing,
    wallDrawingState.currentPoints,
    wallDrawingState.rectStartPoint,
    stairDrawingPoints,
    activeTool,
    selection,
    setSelection,
    setActiveTool,
    resetDrawingState,
    activeFloorId,
    commitWallWithUndo,
    commitCurrentStairDrawing,
    commitPenDimensionInput,
    appendPenPoint,
    penDimensionText,
    penLockedLengthMeters,
    rectActiveAxis,
    onOpeningPreviewOverrideChange,
    onWallHover,
    onExitDrawMode,
    window,
    isActiveViewport,
  ])

  useEffect(() => {
    onProjectedSnapGuidesChange?.(projectedSnapGuides)
  }, [projectedSnapGuides, onProjectedSnapGuidesChange])

  useEffect(() => {
    return () => onProjectedSnapGuidesChange?.([])
  }, [onProjectedSnapGuidesChange])

  useEffect(() => {
    return () => {
      if (mousePreviewRafRef.current != null) {
        cancelAnimationFrame(mousePreviewRafRef.current)
        mousePreviewRafRef.current = null
      }
      pendingMousePreviewPositionRef.current = null
      mousePreviewPositionRef.current = null
    }
  }, [])

  // When user leaves drawing tools (toolbar toggle / tool switch)
  useEffect(() => {
    const previousTool = previousToolRef.current
    if (
      previousTool === 'drawWall' &&
      activeTool !== 'drawWall' &&
      !isFinalizingPenRef.current &&
      !suppressAutoCommitRef.current
    ) {
      commitCurrentPenDrawing()
      setPenDimensionText('')
      setPenLockedLengthMeters(null)
    }
    // Always clear any partial rectangle when leaving the rectangle tool
    if (previousTool === 'drawWallRect' && activeTool !== 'drawWallRect') {
      resetDrawingState()
    }
    if (previousTool === 'drawStair' && activeTool !== 'drawStair') {
      if (!suppressStairAutoCommitRef.current) {
        commitCurrentStairDrawing()
      }
      setStairDrawingPoints([])
      suppressStairAutoCommitRef.current = false
    }
    if (previousTool === 'drawGraphicElement' && activeTool !== 'drawGraphicElement') {
      setGraphicPointerState(null)
      graphicDidDragRef.current = false
    }
    if (suppressAutoCommitRef.current && previousTool === 'drawWall' && activeTool !== 'drawWall') {
      // One-shot suppression after ESC / explicit cancel
      suppressAutoCommitRef.current = false
    }
    previousToolRef.current = activeTool
  }, [
    activeTool,
    commitCurrentPenDrawing,
    commitCurrentStairDrawing,
    resetDrawingState,
    setPenDimensionText,
    setPenLockedLengthMeters,
  ])

  // Handle floor plan tool clicks
  const handleFloorPlanClick = useCallback(
    (e: FloorPlanInputEvent) => {
      if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) {
        return
      }
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false
        return
      }
      // Only handle clicks on empty space
      if (!isFloorPlanHitTarget(e)) {
        return
      }

      // Only process if clicking on empty space
      e.cancelBubble = true

      if (!activeFloorId) {
        return
      }
      const canvasPoint = getCanvasPointFromEvent(e)
      if (!canvasPoint) {
        return
      }

      if (activeTool === 'drawWall') {
        // If we're already drawing and the user clicks near the first point,
        // close the loop and commit the wall instead of adding another vertex.
        if (
          !wallDrawingState.pendingCurve &&
          wallDrawingState.isDrawing &&
          wallDrawingState.currentPoints.length >= 3
        ) {
          const first = wallDrawingState.currentPoints[0]!
          const dx = canvasPoint.x - first.x
          const dy = canvasPoint.y - first.y
          const distSq = dx * dx + dy * dy
          const CLOSE_EPSILON_SQ = 10 * 10 // ~10 px in canvas space
          if (distSq <= CLOSE_EPSILON_SQ) {
            const closedPoints = [...wallDrawingState.currentPoints, first]
            commitWallWithUndo(activeFloorId, closedPoints)
            resetDrawingState()
            setActiveTool('drawWall')
            return
          }
        }

        appendPenPoint(canvasPoint, {
          snapTo45Degrees: !!e?.evt?.shiftKey || isShiftPressedRef.current,
        })
      } else if (activeTool === 'drawWallRect') {
        // Rectangle tool - start on first click, finish on second click
        if (!wallDrawingState.rectStartPoint) {
          // Start rectangle
          const snappedPoint =
            resolveNearbyLineSnap(canvasPoint)?.point ??
            snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
          pushDrawingUndoBeforeMutation()
          setWallDrawingState((prev) => ({
            ...prev,
            rectStartPoint: snappedPoint,
          }))
          scheduleMousePreviewPosition(snappedPoint)
        } else {
          // Finish rectangle - create wall using the same end point as the preview,
          // so commit always matches what the user sees.
          const start = wallDrawingState.rectStartPoint!
          const previewEnd = mousePreviewPositionRef.current

          if (previewEnd) {
            const points = handleDrawWallRect(start, previewEnd, gridSize, false)
            if (activeFloorId && points.length >= 2) {
              commitWallWithUndo(activeFloorId, points)
              setWallDrawingState({
                currentPoints: [],
                isDrawing: false,
                startPoint: null,
                rectStartPoint: null,
                pendingCurve: false,
              })
              scheduleMousePreviewPosition(null)
              clearRectConstraints()
            }
          } else {
            // Fallback: no preview yet, use snapped click position without constraints.
            const snappedPoint =
              resolveNearbyLineSnap(canvasPoint)?.point ??
              snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
            const points = handleDrawWallRect(start, snappedPoint, gridSize, planView.snapToGrid)
            if (activeFloorId && points.length >= 2) {
              commitWallWithUndo(activeFloorId, points)
              setWallDrawingState({
                currentPoints: [],
                isDrawing: false,
                startPoint: null,
                rectStartPoint: null,
                pendingCurve: false,
              })
              scheduleMousePreviewPosition(null)
              clearRectConstraints()
            }
          }
        }
      } else if (activeTool === 'drawStair') {
        const now = Date.now()
        if (now - stairLastClickTimeRef.current < FLOOR_PLAN_DRAW_DOUBLE_CLICK_MS) {
          stairLastClickTimeRef.current = now
          return
        }
        stairLastClickTimeRef.current = now
        const { point: snapped } = resolveStairDrawingSnap(canvasPoint)
        pushDrawingUndoBeforeMutation()
        setStairDrawingPoints((prev) => [...prev, snapped])
        setProjectedSnapGuides([])
      }
    },
    [
      activeTool,
      activeFloorId,
      planView,
      gridSize,
      wallDrawingState,
      clearRectConstraints,
      commitWallWithUndo,
      isFloorPlanHitTarget,
      getCanvasPointFromEvent,
      appendPenPoint,
      pushDrawingUndoBeforeMutation,
      scheduleMousePreviewPosition,
      resetDrawingState,
      setActiveTool,
      resolveStairDrawingSnap,
      resolveNearbyLineSnap,
    ]
  )

  // Handle floor plan tool taps (for touch devices)
  const handleFloorPlanTap = useCallback(
    (e: FloorPlanInputEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false
        return
      }
      // Only handle taps on empty space
      if (!isFloorPlanHitTarget(e)) {
        return
      }

      e.cancelBubble = true

      if (!activeFloorId) return
      const canvasPoint = getCanvasPointFromEvent(e)
      if (!canvasPoint) return

      // Handle same as onClick
      if (activeTool === 'drawWall') {
        appendPenPoint(canvasPoint)
      } else if (activeTool === 'drawStair') {
        const now = Date.now()
        if (now - stairLastClickTimeRef.current < FLOOR_PLAN_DRAW_DOUBLE_CLICK_MS) {
          stairLastClickTimeRef.current = now
          return
        }
        stairLastClickTimeRef.current = now
        const { point: snapped } = resolveStairDrawingSnap(canvasPoint)
        pushDrawingUndoBeforeMutation()
        setStairDrawingPoints((prev) => [...prev, snapped])
        setProjectedSnapGuides([])
      }
    },
    [
      activeTool,
      activeFloorId,
      isFloorPlanHitTarget,
      getCanvasPointFromEvent,
      appendPenPoint,
      pushDrawingUndoBeforeMutation,
      resolveStairDrawingSnap,
    ]
  )

  const updateDraftPoint = useCallback(
    (tool: 'drawWall' | 'drawStair', index: number, rawPoint: Point2) => {
      const nearbyLine = resolveNearbyLineSnap(rawPoint, {
        excludeDraftPoint: { tool, index },
      })
      const nextPoint = nearbyLine?.point ?? snapToGrid(rawPoint, gridSize, planView.snapToGrid)
      if (tool === 'drawWall') {
        setWallDrawingState((prev) => {
          if (!prev.isDrawing || index < 0 || index >= prev.currentPoints.length) return prev
          const nextPoints = [...prev.currentPoints]
          nextPoints[index] = nextPoint
          return { ...prev, currentPoints: nextPoints }
        })
      } else {
        setStairDrawingPoints((prev) => {
          if (index < 0 || index >= prev.length) return prev
          const nextPoints = [...prev]
          nextPoints[index] = nextPoint
          return nextPoints
        })
      }
      scheduleMousePreviewPosition(nextPoint)
    },
    [gridSize, planView.snapToGrid, resolveNearbyLineSnap, scheduleMousePreviewPosition]
  )

  const beginDraftPointDrag = useCallback(
    (tool: 'drawWall' | 'drawStair', index: number, e: FloorPlanInputEvent) => {
      pushDrawingUndoBeforeMutation()
      draftPointDragRef.current = { tool, index }
      draftPointDidDragRef.current = false
      e.cancelBubble = true
    },
    [pushDrawingUndoBeforeMutation]
  )

  const moveDraftPointDrag = useCallback(
    (tool: 'drawWall' | 'drawStair', index: number, e: FloorPlanInputEvent) => {
      const point = getCanvasPointFromEvent(e) ?? { x: e.target.x(), y: e.target.y() }
      draftPointDragRef.current = { tool, index }
      draftPointDidDragRef.current = true
      updateDraftPoint(tool, index, point)
      e.cancelBubble = true
    },
    [getCanvasPointFromEvent, updateDraftPoint]
  )

  const endDraftPointDrag = useCallback(
    (tool: 'drawWall' | 'drawStair', index: number, e: FloorPlanInputEvent) => {
      const point = getCanvasPointFromEvent(e) ?? { x: e.target.x(), y: e.target.y() }
      updateDraftPoint(tool, index, point)
      draftPointDragRef.current = null
      if (draftPointDidDragRef.current) {
        suppressNextClickRef.current = true
        suppressDraftPointTapUntilRef.current = Date.now() + 500
        scheduleMousePreviewPosition(null)
      }
      draftPointDidDragRef.current = false
      e.cancelBubble = true
    },
    [getCanvasPointFromEvent, scheduleMousePreviewPosition, updateDraftPoint]
  )

  // Handle double-click to finish wall drawing
  const handleFloorPlanDblClick = useCallback(
    (e: FloorPlanInputEvent) => {
      if (activeTool !== 'drawWall' && activeTool !== 'drawStair') {
        return
      }

      e.cancelBubble = true

      if (activeTool === 'drawWall') {
        const isDoubleClick = penDoubleClickDetectedRef.current
        penDoubleClickDetectedRef.current = false
        if (!isDoubleClick) return
        commitCurrentPenDrawing()
        setActiveTool('drawWall')
        return
      }
      commitCurrentStairDrawing()
    },
    [activeTool, commitCurrentPenDrawing, commitCurrentStairDrawing, setActiveTool]
  )

  const syncDrawToolPreviewFromCanvasPoint = useCallback(
    (canvasPoint: Point2, shiftHeld: boolean) => {
      if (activeTool === 'drawWall') {
        const nearbyLine = resolveNearbyLineSnap(canvasPoint, { excludeCurrentTail: 'drawWall' })
        let next = nearbyLine?.point ?? canvasPoint
        const shouldSnapTo45Degrees = shiftHeld
        let nextGuides: Array<{ from: Point2; to: Point2; hideDistanceLabel?: boolean }> = []
        if (
          !nearbyLine &&
          shouldSnapTo45Degrees &&
          wallDrawingState.currentPoints.length > 0 &&
          wallDrawingState.isDrawing
        ) {
          const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
          next = snapPointToPenAngle(start, next)
        } else if (!nearbyLine) {
          const walls = getWallsByFloor(activeFloorId!)
          const projected =
            planView.snapToProjection !== false ? resolveProjectedPenSnap(next, walls) : null
          if (projected && projected.length > 0) {
            next = projected[0]!.snappedPoint
            if (projected.length > 1) {
              next = projected[1]!.snappedPoint
            }
            const segmentStart =
              wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1] ?? null
            nextGuides = projected.map((p) => ({
              from: p.guideFrom,
              to: p.guideTo,
              // When projection snaps against the just-placed pen vertex, the pen tool
              // already shows the segment distance label; suppress duplicate projected label.
              hideDistanceLabel: !!segmentStart && pointsMatch(p.guideFrom, segmentStart),
            }))
          }
        }
        if (
          wallDrawingState.isDrawing &&
          penLockedLengthMeters &&
          wallDrawingState.currentPoints.length > 0 &&
          canvasPxPerMeter
        ) {
          const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
          const dx = next.x - start.x
          const dy = next.y - start.y
          const lenPx = Math.sqrt(dx * dx + dy * dy)
          const targetPx = penLockedLengthMeters * canvasPxPerMeter
          if (lenPx > 1e-6 && targetPx > 0) {
            const scale = targetPx / lenPx
            next = {
              x: start.x + dx * scale,
              y: start.y + dy * scale,
            }
          }
        } else if (wallDrawingState.isDrawing && !shouldSnapTo45Degrees && !nearbyLine) {
          // During pen drawing, apply grid snap after projection snap so both
          // enabled rules can cooperate instead of projection bypassing grid.
          next = snapToGrid(next, gridSize, planView.snapToGrid)
        }
        if (!wallDrawingState.isDrawing && !nearbyLine) {
          next = snapToGrid(next, gridSize, planView.snapToGrid)
        }
        if (nextGuides.length > 0) {
          // Keep projected guides tied to the final preview point that will be placed
          // (after optional angle, lock-length, and grid adjustments).
          nextGuides = nextGuides.map((guide) => {
            const isVerticalGuide = Math.abs(guide.from.x - guide.to.x) <= 1e-6
            if (isVerticalGuide) {
              return {
                from: guide.from,
                to: { x: guide.from.x, y: next.y },
                hideDistanceLabel: guide.hideDistanceLabel,
              }
            }
            return {
              from: guide.from,
              to: { x: next.x, y: guide.from.y },
              hideDistanceLabel: guide.hideDistanceLabel,
            }
          })
        }
        setActiveGeometrySnap(
          nearbyLine && pointsMatch(next, nearbyLine.point)
            ? { point: nearbyLine.point, kind: nearbyLine.kind }
            : null
        )
        scheduleMousePreviewPosition(next)
        setProjectedSnapGuides(nextGuides)
      } else if (activeTool === 'drawWallRect') {
        setActiveGeometrySnap(null)
        if (!wallDrawingState.rectStartPoint && !rectPointerDownRef.current) {
          const nearbyLine = resolveNearbyLineSnap(canvasPoint)
          scheduleMousePreviewPosition(
            nearbyLine?.point ?? snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
          )
          setProjectedSnapGuides((prev) => (prev.length > 0 ? [] : prev))
        } else {
          let next = canvasPoint
          const startForPreview = wallDrawingState.rectStartPoint ?? rectPointerDownRef.current
          if (startForPreview) {
            const nearbyLine = resolveNearbyLineSnap(canvasPoint)
            let end = nearbyLine?.point ?? snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
            if (rectLockedXMeters != null) {
              const dx = end.x - startForPreview.x
              const signX = dx >= 0 ? 1 : -1
              const targetPxX = rectLockedXMeters * canvasPxPerMeter
              end = {
                ...end,
                x: startForPreview.x + signX * targetPxX,
              }
            }
            if (rectLockedYMeters != null) {
              const dy = end.y - startForPreview.y
              const signY = dy >= 0 ? 1 : -1
              const targetPxY = rectLockedYMeters * canvasPxPerMeter
              end = {
                ...end,
                y: startForPreview.y + signY * targetPxY,
              }
            }
            next = end
          }
          scheduleMousePreviewPosition(next)
        }
      } else if (activeTool === 'drawStair') {
        setActiveGeometrySnap(null)
        const snapped = resolveStairDrawingSnap(canvasPoint)
        scheduleMousePreviewPosition(snapped.point)
        setProjectedSnapGuides(snapped.guides)
      }
    },
    [
      activeFloorId,
      activeTool,
      canvasPxPerMeter,
      getWallsByFloor,
      gridSize,
      penLockedLengthMeters,
      planView.snapToGrid,
      planView.snapToProjection,
      rectLockedXMeters,
      rectLockedYMeters,
      resolveProjectedPenSnap,
      resolveNearbyLineSnap,
      resolveStairDrawingSnap,
      scheduleMousePreviewPosition,
      snapPointToPenAngle,
      pointsMatch,
      wallDrawingState.currentPoints,
      wallDrawingState.isDrawing,
      wallDrawingState.rectStartPoint,
    ]
  )

  useEffect(() => {
    if (!activeFloorId) return
    if (activeTool !== 'drawWall' && activeTool !== 'drawWallRect' && activeTool !== 'drawStair')
      return
    const sp = lastStagePointerRef.current
    if (!sp) return
    const canvasPoint: Point2 = {
      x: (sp.x - planView.pan.x) / planView.zoom,
      y: (sp.y - planView.pan.y) / planView.zoom,
    }
    syncDrawToolPreviewFromCanvasPoint(canvasPoint, isShiftPressedRef.current)
  }, [
    activeFloorId,
    activeTool,
    planView.pan.x,
    planView.pan.y,
    planView.zoom,
    syncDrawToolPreviewFromCanvasPoint,
  ])

  // Handle mouse move for rectangle preview and wall hover
  const handleFloorPlanMouseMove = useCallback(
    (e: FloorPlanInputEvent) => {
      if (!activeFloorId) return
      const buttons = 'buttons' in e.evt && typeof e.evt.buttons === 'number' ? e.evt.buttons : 0
      const isViewportPanGesture = (buttons & 2) !== 0 || (buttons & 4) !== 0
      if (isViewportPanGesture) {
        lastStagePointerRef.current = null
        scheduleMousePreviewPosition(null)
        if (!didClearWallHoverRef.current) {
          onWallHover?.(null, null)
          didClearWallHoverRef.current = true
        }
        return
      }
      const stage = e.target.getStage()
      if (!stage) return
      const pointer = stage.getPointerPosition()
      if (!pointer) return

      lastStagePointerRef.current = { x: pointer.x, y: pointer.y }

      const canvasPoint: Point2 = {
        x: (pointer.x - planView.pan.x) / planView.zoom,
        y: (pointer.y - planView.pan.y) / planView.zoom,
      }

      const shiftHeld = !!e?.evt?.shiftKey || isShiftPressedRef.current

      const draftPointDrag = draftPointDragRef.current
      if (draftPointDrag) {
        draftPointDidDragRef.current = true
        updateDraftPoint(draftPointDrag.tool, draftPointDrag.index, canvasPoint)
        e.cancelBubble = true
        return
      }

      const pointerDragThresholdCanvas = screenPxToCanvasUnits(planView.zoom, 12, 8, 20)
      const pointerDragThresholdSq = pointerDragThresholdCanvas * pointerDragThresholdCanvas

      if (activeTool === 'drawWall') {
        syncDrawToolPreviewFromCanvasPoint(canvasPoint, shiftHeld)
        if (penPointerDownRef.current) {
          const dx = canvasPoint.x - penPointerDownRef.current.x
          const dy = canvasPoint.y - penPointerDownRef.current.y
          if (dx * dx + dy * dy > pointerDragThresholdSq) penDidDragRef.current = true
        }
      } else if (activeTool === 'drawWallRect') {
        syncDrawToolPreviewFromCanvasPoint(canvasPoint, shiftHeld)
        if (rectPointerDownRef.current) {
          const dx = canvasPoint.x - rectPointerDownRef.current.x
          const dy = canvasPoint.y - rectPointerDownRef.current.y
          if (dx * dx + dy * dy > pointerDragThresholdSq) {
            rectDidDragRef.current = true
            if (!wallDrawingState.rectStartPoint) {
              setWallDrawingState((prev) => ({
                ...prev,
                rectStartPoint: rectPointerDownRef.current,
              }))
            }
          }
        }
      } else if (activeTool === 'drawStair') {
        syncDrawToolPreviewFromCanvasPoint(canvasPoint, shiftHeld)
        if (stairPointerDownRef.current) {
          const dx = canvasPoint.x - stairPointerDownRef.current.x
          const dy = canvasPoint.y - stairPointerDownRef.current.y
          if (dx * dx + dy * dy > pointerDragThresholdSq) stairDidDragRef.current = true
        }
      } else if (activeTool === 'drawGraphicElement') {
        const nextPoint = snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
        scheduleMousePreviewPosition(nextPoint)
        if (graphicPointerState) {
          const dx = nextPoint.x - graphicPointerState.start.x
          const dy = nextPoint.y - graphicPointerState.start.y
          if (dx * dx + dy * dy > pointerDragThresholdSq) graphicDidDragRef.current = true
          const didDrag = graphicDidDragRef.current
          setGraphicPointerState((prev) => (prev ? { ...prev, current: nextPoint, didDrag } : prev))
        }
      } else {
        scheduleMousePreviewPosition(null)
        setProjectedSnapGuides((prev) => (prev.length > 0 ? [] : prev))
      }

      if ((activeTool === 'insertDoor' || activeTool === 'insertWindow') && openingPointerState) {
        setOpeningPointerState((prev) => {
          if (!prev) return prev
          const next = { ...prev, pointer: canvasPoint }
          if (prev.dragSizingLatched) return next
          const placement = computeOpeningDragPlacement(
            prev.wall,
            prev.anchor,
            canvasPoint,
            getDefaultOpeningWidth(prev.kind),
            6,
            getOpeningPlacementOptions(prev.kind)
          )
          return placement.isDraggingAlongWall ? { ...next, dragSizingLatched: true } : next
        })
      }

      const shouldTrackWallHover =
        activeTool === 'insertDoor' ||
        activeTool === 'insertWindow' ||
        activeTool === 'clipWall' ||
        activeTool === 'insertPoint' ||
        activeTool === 'drawStair' ||
        activeTool === 'drawGraphicElement' ||
        activeTool === 'select'
      if (!shouldTrackWallHover) {
        if (!didClearWallHoverRef.current) {
          onWallHover?.(null, null)
          didClearWallHoverRef.current = true
        }
        return
      }
      didClearWallHoverRef.current = false

      if ((activeTool === 'insertDoor' || activeTool === 'insertWindow') && openingPointerState)
        return

      // Update hover state for walls
      const walls = getWallsByFloor(activeFloorId)
      let hovered: string | null = null

      for (const wall of walls) {
        if (isCurvedWall(wall) && getCurvedWallToolHoverFeedback(activeTool) === 'suppressed') {
          continue
        }
        const pathPoints = getWallPathPoints(wall)
        for (let i = 0; i < pathPoints.length - 1; i++) {
          const p1 = pathPoints[i]
          const p2 = pathPoints[i + 1]
          if (!p1 || !p2) continue
          const dx = p2.x - p1.x
          const dy = p2.y - p1.y
          const lengthSq = dx * dx + dy * dy
          if (lengthSq < 1e-10) continue

          const t = Math.max(
            0,
            Math.min(1, ((canvasPoint.x - p1.x) * dx + (canvasPoint.y - p1.y) * dy) / lengthSq)
          )
          const projX = p1.x + t * dx
          const projY = p1.y + t * dy
          const dist = Math.sqrt(
            Math.pow(canvasPoint.x - projX, 2) + Math.pow(canvasPoint.y - projY, 2)
          )

          if (dist < 10) {
            hovered = wall.id
            break
          }
        }
        if (hovered) break
      }

      onWallHover?.(hovered, canvasPoint)
    },
    [
      activeFloorId,
      activeTool,
      planView,
      wallDrawingState,
      getWallsByFloor,
      gridSize,
      onWallHover,
      scheduleMousePreviewPosition,
      syncDrawToolPreviewFromCanvasPoint,
      openingPointerState,
      graphicPointerState,
      updateDraftPoint,
      getDefaultOpeningWidth,
      getOpeningPlacementOptions,
    ]
  )

  const handleFloorPlanPointerDown = useCallback(
    (e: FloorPlanInputEvent) => {
      if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) return
      if (!isFloorPlanHitTarget(e) || !activeFloorId) return
      const canvasPoint = getCanvasPointFromEvent(e)
      if (!canvasPoint) return

      if (activeTool === 'drawWall') {
        e.cancelBubble = true
        capturePenPointer(e)
        const now = Date.now()
        const previousPointerDown = penLastPointerDownPointRef.current
        const doubleClickDistance = screenPxToCanvasUnits(
          planView.zoom,
          FLOOR_PLAN_DRAW_DOUBLE_CLICK_DISTANCE_PX,
          4,
          12
        )
        const distanceFromPrevious = previousPointerDown
          ? Math.hypot(canvasPoint.x - previousPointerDown.x, canvasPoint.y - previousPointerDown.y)
          : Number.POSITIVE_INFINITY
        const isDoubleDown =
          now - penLastPointerDownTimeRef.current < FLOOR_PLAN_DRAW_DOUBLE_CLICK_MS &&
          distanceFromPrevious <= doubleClickDistance
        penLastPointerDownTimeRef.current = now
        penLastPointerDownPointRef.current = canvasPoint
        penDoubleClickDetectedRef.current = isDoubleDown
        penPointerDownRef.current = canvasPoint
        penDidDragRef.current = false
        penCurveGestureRef.current = !wallDrawingState.isDrawing
        suppressNextClickRef.current = true
        if (!isDoubleDown || wallDrawingState.pendingCurve) {
          appendPenPoint(canvasPoint, {
            snapTo45Degrees: ('shiftKey' in e.evt && !!e.evt.shiftKey) || isShiftPressedRef.current,
          })
        }
      } else if (activeTool === 'drawWallRect') {
        rectPointerDownRef.current =
          resolveNearbyLineSnap(canvasPoint)?.point ??
          snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
        rectDidDragRef.current = false
        setRectPointerActive(true)
      } else if (activeTool === 'insertDoor' || activeTool === 'insertWindow') {
        e.cancelBubble = true
        rememberStageContainer(e)
        const kind: 'door' | 'window' = activeTool === 'insertDoor' ? 'door' : 'window'
        const closestWall = findClosestWallForOpening(canvasPoint, getWallsByFloor(activeFloorId))
        if (!closestWall) {
          setOpeningPointerState(null)
          return
        }
        doorPlacementOpenSideRef.current = 'right'
        const anchor = resolveOpeningAnchor(closestWall, canvasPoint)
        setOpeningPointerState({
          kind,
          wall: closestWall,
          anchor,
          pointer: canvasPoint,
          dragSizingLatched: false,
        })
      } else if (activeTool === 'drawGraphicElement') {
        const point = snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
        setGraphicPointerState({ start: point, current: point, didDrag: false })
        graphicDidDragRef.current = false
        e.cancelBubble = true
      } else if (activeTool === 'drawStair') {
        const { point } = resolveStairDrawingSnap(canvasPoint)
        stairPointerDownRef.current = point
        stairDidDragRef.current = false
        e.cancelBubble = true
      }
    },
    [
      activeTool,
      activeFloorId,
      isFloorPlanHitTarget,
      getCanvasPointFromEvent,
      capturePenPointer,
      appendPenPoint,
      findClosestWallForOpening,
      getWallsByFloor,
      gridSize,
      planView.snapToGrid,
      planView.zoom,
      rememberStageContainer,
      resolveStairDrawingSnap,
      resolveNearbyLineSnap,
      resolveOpeningAnchor,
      wallDrawingState.isDrawing,
      wallDrawingState.pendingCurve,
    ]
  )

  const handleFloorPlanPointerUp = useCallback(
    (e: FloorPlanInputEvent) => {
      if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) return
      if (!activeFloorId) return

      if ((activeTool === 'insertDoor' || activeTool === 'insertWindow') && openingPointerState) {
        e.cancelBubble = true
        const baseWidth = getDefaultOpeningWidth(openingPointerState.kind)
        commitOpeningInsert(
          openingPointerState.kind,
          openingPointerState.wall,
          openingPointerState.anchor,
          openingPointerState.pointer,
          baseWidth,
          openingPointerState.dragSizingLatched
        )
        setOpeningPointerState(null)
        suppressNextClickRef.current = true
        return
      }

      const canvasPoint = getCanvasPointFromEvent(e)
      if (!canvasPoint) return

      if (draftPointDragRef.current) {
        const draftPointDrag = draftPointDragRef.current
        updateDraftPoint(draftPointDrag.tool, draftPointDrag.index, canvasPoint)
        draftPointDragRef.current = null
        if (draftPointDidDragRef.current) {
          suppressNextClickRef.current = true
          suppressDraftPointTapUntilRef.current = Date.now() + 500
          scheduleMousePreviewPosition(null)
        }
        draftPointDidDragRef.current = false
        e.cancelBubble = true
        return
      }

      if (activeTool === 'drawWall') {
        releasePenPointer()
        if (penPointerDownRef.current && penDidDragRef.current) {
          appendPenPoint(canvasPoint, {
            snapTo45Degrees: !!e?.evt?.shiftKey || isShiftPressedRef.current,
          })
          if (penCurveGestureRef.current) {
            setWallDrawingState((prev) => ({ ...prev, pendingCurve: true }))
          }
        }
        const startedCurve = penCurveGestureRef.current && penDidDragRef.current
        penPointerDownRef.current = null
        penDidDragRef.current = false
        penCurveGestureRef.current = false
        if (!startedCurve) scheduleMousePreviewPosition(null)
        suppressNextClickRef.current = true
      } else if (activeTool === 'drawWallRect') {
        if (rectPointerDownRef.current && rectDidDragRef.current) {
          const start = rectPointerDownRef.current
          const previewEnd = mousePreviewPositionRef.current
          const end = previewEnd ?? canvasPoint
          // When we have a preview end, it's already snapped/constrained, so skip extra snapping.
          const snapEnabled = !previewEnd && planView.snapToGrid
          const points = handleDrawWallRect(start, end, gridSize, snapEnabled)
          if (points.length >= 2) {
            commitWallWithUndo(activeFloorId, points)
          }
          // Ephemeral constraints: clear after each committed rectangle.
          clearRectConstraints()
          setWallDrawingState((prev) => ({
            ...prev,
            currentPoints: [],
            isDrawing: false,
            startPoint: null,
            rectStartPoint: null,
          }))
          suppressNextClickRef.current = true
        }
        rectPointerDownRef.current = null
        rectDidDragRef.current = false
        setRectPointerActive(false)
      } else if (activeTool === 'drawStair') {
        if (stairPointerDownRef.current && stairDidDragRef.current) {
          const start = stairPointerDownRef.current
          const { point: end } = resolveStairDrawingSnap(canvasPoint)
          pushDrawingUndoBeforeMutation()
          setStairDrawingPoints((prev) => [...prev, start, end])
          scheduleMousePreviewPosition(null)
          setProjectedSnapGuides([])
          suppressNextClickRef.current = true
        }
        stairPointerDownRef.current = null
        stairDidDragRef.current = false
      } else if (activeTool === 'drawGraphicElement' && graphicPointerState) {
        const end = snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
        commitGraphicElement(graphicPointerState.start, end, graphicDidDragRef.current)
        setGraphicPointerState(null)
        graphicDidDragRef.current = false
        suppressNextClickRef.current = true
      }
    },
    [
      activeTool,
      activeFloorId,
      getCanvasPointFromEvent,
      updateDraftPoint,
      releasePenPointer,
      appendPenPoint,
      gridSize,
      planView.snapToGrid,
      commitWallWithUndo,
      pushDrawingUndoBeforeMutation,
      scheduleMousePreviewPosition,
      clearRectConstraints,
      openingPointerState,
      getDefaultOpeningWidth,
      commitOpeningInsert,
      graphicPointerState,
      commitGraphicElement,
      resolveStairDrawingSnap,
    ]
  )

  // Check if a floor plan drawing tool is active.
  // The implicit select+move tool has no overlay group of its own.
  const isFloorPlanToolActive =
    activeTool === 'drawWall' ||
    activeTool === 'drawWallRect' ||
    activeTool === 'drawStair' ||
    activeTool === 'insertDoor' ||
    activeTool === 'insertWindow' ||
    activeTool === 'insertPoint' ||
    activeTool === 'drawGraphicElement' ||
    activeTool === 'clipWall'

  const drawStrokeCanvas = screenPxToCanvasUnits(
    planView.zoom,
    DRAW_TOOL_STROKE_PX,
    DRAW_TOOL_STROKE_PX_MIN,
    DRAW_TOOL_STROKE_PX_MAX
  )
  const drawPointRadiusCanvas = screenPxToCanvasUnits(
    planView.zoom,
    DRAW_TOOL_POINT_RADIUS_PX,
    DRAW_TOOL_POINT_RADIUS_PX_MIN,
    DRAW_TOOL_POINT_RADIUS_PX_MAX
  )
  const drawHandleRadiusCanvas = screenPxToCanvasUnits(
    planView.zoom,
    DRAW_TOOL_HANDLE_RADIUS_PX,
    DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
    DRAW_TOOL_HANDLE_RADIUS_PX_MAX
  )
  const drawDashCanvas = screenPxToCanvasUnits(planView.zoom, DRAW_TOOL_DASH_PX, 2, 10)
  const stairPreviewColor = theme.mode === 'dark' ? '#9ca3af' : '#64748b'
  const stairPreviewMetrics = getStairRenderMetrics(canvasPxPerMeter)
  const stairSpiralPreviewSnapRadius = screenPxToCanvasUnits(planView.zoom, 18, 10, 24)
  const stairPreviewRawPoints =
    activeTool === 'drawStair'
      ? [
          ...stairDrawingPoints,
          ...(stairDrawingPoints.length > 0 && currentMousePosition ? [currentMousePosition] : []),
        ]
      : []
  const stairSpiralPreviewActive =
    activeTool === 'drawStair' &&
    stairDrawingPoints.length === 1 &&
    !!currentMousePosition &&
    Math.hypot(
      currentMousePosition.x - stairDrawingPoints[0]!.x,
      currentMousePosition.y - stairDrawingPoints[0]!.y
    ) <= stairSpiralPreviewSnapRadius
  const stairPreviewStair: Stair | null =
    activeTool === 'drawStair' && stairDrawingPoints.length > 0
      ? {
          id: '__preview-stair__',
          floorId: activeFloorId ?? '__preview-floor__',
          points:
            stairDrawingPoints.length === 1
              ? [stairDrawingPoints[0]!]
              : stairPreviewRawPoints.length >= 2
                ? stairPreviewRawPoints
                : stairDrawingPoints,
          width: (PLAN_STAIR_DEFAULT_WIDTH_CM / 100) * canvasPxPerMeter,
          stepDepth: (PLAN_STAIR_DEFAULT_STEP_DEPTH_CM / 100) * canvasPxPerMeter,
          spiralPoleDiameter: (PLAN_STAIR_SPIRAL_POLE_DIAMETER_CM / 100) * canvasPxPerMeter,
          cornerStyle: 'round',
          cornerMode: 'turn',
          showUpArrow: false,
          invertUpArrow: true,
          spiralRotationDeg: 0,
        }
      : null
  const stairPreviewGeometry = stairPreviewStair ? buildStairGeometry(stairPreviewStair) : null
  const firstClickSnapPreviewRadiusCanvas = Math.max(
    2 / planView.zoom,
    drawPointRadiusCanvas * 0.85
  )
  const showFirstClickSnapPreview =
    !!currentMousePosition &&
    ((activeTool === 'drawWall' && !wallDrawingState.isDrawing) ||
      (activeTool === 'drawWallRect' && !wallDrawingState.rectStartPoint && !rectPointerActive) ||
      (activeTool === 'drawGraphicElement' && !graphicPointerState))
  const openingFloorPlan = activeFloor?.floorPlan
  const openingDragFitted = useMemo(() => {
    if (!openingPointerState || !openingFloorPlan) return null
    return computeOpeningDragPreview(
      openingFloorPlan,
      openingPointerState,
      getDefaultOpeningWidth(openingPointerState.kind),
      getOpeningPlacementOptions(openingPointerState.kind)
    )
  }, [openingPointerState, openingFloorPlan, getDefaultOpeningWidth, getOpeningPlacementOptions])

  const openingDragPreview = (() => {
    if (!openingDragFitted) return null

    const geom = computeOpeningGeometry(
      openingDragFitted.wall.points,
      openingDragFitted.fitted.position
    )
    if (!geom) return null

    const half = openingDragFitted.fitted.width / 2
    const start = {
      x: geom.center.x - geom.tangent.x * half,
      y: geom.center.y - geom.tangent.y * half,
    }
    const end = {
      x: geom.center.x + geom.tangent.x * half,
      y: geom.center.y + geom.tangent.y * half,
    }
    return { start, end }
  })()

  const openingDragDimension = openingDragFitted
    ? {
        cursor: openingDragFitted.pointer,
        widthCm: openingWidthCentimeters(openingDragFitted.fitted.width, canvasPxPerMeter),
      }
    : null

  useEffect(() => {
    if (!openingPointerState) return

    const handleWindowTouchMove = (evt: TouchEvent) => {
      const touch = evt.touches[0]
      if (!touch) return
      const canvasPoint = clientCoordsToCanvasPoint(touch.clientX, touch.clientY)
      if (!canvasPoint) return
      setOpeningPointerState((prev) => {
        if (!prev) return prev
        const next = { ...prev, pointer: canvasPoint }
        if (prev.dragSizingLatched) return next
        const placement = computeOpeningDragPlacement(
          prev.wall,
          prev.anchor,
          canvasPoint,
          getDefaultOpeningWidth(prev.kind),
          6,
          getOpeningPlacementOptions(prev.kind)
        )
        return placement.isDraggingAlongWall ? { ...next, dragSizingLatched: true } : next
      })
      evt.preventDefault()
    }

    window.addEventListener('touchmove', handleWindowTouchMove, { capture: true, passive: false })
    return () => window.removeEventListener('touchmove', handleWindowTouchMove, true)
  }, [
    openingPointerState,
    clientCoordsToCanvasPoint,
    getDefaultOpeningWidth,
    getOpeningPlacementOptions,
    window,
  ])

  useEffect(() => {
    if (!onOpeningPreviewOverrideChange) return
    if (!openingDragFitted) {
      onOpeningPreviewOverrideChange(null)
      return
    }

    const doorOrientation =
      openingDragFitted.kind === 'door'
        ? resolvePlacementDoorOrientation(
            openingDragFitted.wall,
            openingDragFitted.fitted.position,
            openingDragFitted.pointer,
            openingDragFitted.placement.doorSwing,
            { useOpenSideDeadzone: false }
          )
        : null
    if (doorOrientation) {
      doorPlacementOpenSideRef.current = doorOrientation.openSide
    }

    onOpeningPreviewOverrideChange({
      wallId: openingDragFitted.wall.id,
      position: openingDragFitted.fitted.position,
      width: openingDragFitted.fitted.width,
      kind: openingDragFitted.kind,
      valid: true,
      ...(doorOrientation
        ? {
            doorSwing: doorOrientation.swing,
            doorDirection: doorOrientation.direction,
          }
        : {}),
    })
  }, [openingDragFitted, onOpeningPreviewOverrideChange, resolvePlacementDoorOrientation])

  useEffect(() => {
    return () => {
      onOpeningPreviewOverrideChange?.(null)
    }
  }, [onOpeningPreviewOverrideChange])

  if (!activeFloor) {
    return null
  }

  return (
    <>
      {/* Floor Plan Drawing Layer - render BEFORE placements so it can receive clicks when symbols have listening=false */}
      {isFloorPlanToolActive && (
        <Group
          listening={true}
          onPointerDown={handleFloorPlanPointerDown}
          onPointerUp={handleFloorPlanPointerUp}
          onPointerCancel={handleFloorPlanPointerUp}
          onPointerMove={handleFloorPlanMouseMove}
          onTouchStart={handleFloorPlanPointerDown}
          onTouchMove={handleFloorPlanMouseMove}
          onTouchEnd={handleFloorPlanPointerUp}
          onTouchCancel={handleFloorPlanPointerUp}
          onClick={handleFloorPlanClick}
          onTap={handleFloorPlanTap}
          onDblClick={handleFloorPlanDblClick}
          onContextMenu={(e) => {
            const action = resolveFloorPlanToolContextMenuAction(
              activeTool,
              wallDrawingState.isDrawing,
              wallDrawingState.currentPoints.length
            )
            if (action === 'ignore') return
            e.evt.preventDefault()
            e.cancelBubble = true
            if (action === 'commitPenAndDropTool') {
              commitCurrentPenDrawing()
            } else if (action === 'dropTool') {
              if (activeTool === 'drawWall') {
                suppressAutoCommitRef.current = true
                resetDrawingState()
              }
              if (activeTool === 'drawWallRect') commitCurrentRectangleDrawing()
              if (activeTool === 'drawStair') commitCurrentStairDrawing()
              if (activeTool === 'drawGraphicElement' && graphicPointerState) {
                commitGraphicElement(
                  graphicPointerState.start,
                  graphicPointerState.current,
                  graphicDidDragRef.current
                )
              }
              if (
                (activeTool === 'insertDoor' || activeTool === 'insertWindow') &&
                openingPointerState
              ) {
                commitOpeningInsert(
                  openingPointerState.kind,
                  openingPointerState.wall,
                  openingPointerState.anchor,
                  openingPointerState.pointer,
                  getDefaultOpeningWidth(openingPointerState.kind),
                  openingPointerState.dragSizingLatched
                )
              }
              setOpeningPointerState(null)
              onOpeningPreviewOverrideChange?.(null)
              onWallHover?.(null, null)
            }
            setActiveTool('select')
          }}
        >
          <FloorPlanDrawingPreview
            activeTool={activeTool}
            wallDrawingState={wallDrawingState}
            currentMousePosition={currentMousePosition}
            planView={planView}
            drawStrokeCanvas={drawStrokeCanvas}
            drawDashCanvas={drawDashCanvas}
            stairDrawingPoints={stairDrawingPoints}
            stairPreviewGeometry={stairPreviewGeometry}
            stairPreviewColor={stairPreviewColor}
            stairPreviewMetrics={stairPreviewMetrics}
            stairSpiralPreviewActive={stairSpiralPreviewActive}
            drawPointRadiusCanvas={drawPointRadiusCanvas}
            beginDraftPointDrag={beginDraftPointDrag}
            moveDraftPointDrag={moveDraftPointDrag}
            endDraftPointDrag={endDraftPointDrag}
            suppressDraftPointTapUntilRef={suppressDraftPointTapUntilRef}
            commitCurrentStairDrawing={commitCurrentStairDrawing}
            activeGeometrySnap={activeGeometrySnap}
            showFirstClickSnapPreview={showFirstClickSnapPreview}
            firstClickSnapPreviewRadiusCanvas={firstClickSnapPreviewRadiusCanvas}
            activeFloorId={activeFloorId}
            commitWallWithUndo={commitWallWithUndo}
            resetDrawingState={resetDrawingState}
            setActiveTool={setActiveTool}
            openingDragPreview={openingDragPreview}
            openingDragDimension={openingDragDimension}
            theme={theme}
            drawHandleRadiusCanvas={drawHandleRadiusCanvas}
            fontFamily={fontFamily}
            rectLockedXMeters={rectLockedXMeters}
            rectLockedYMeters={rectLockedYMeters}
            canvasPxPerMeter={canvasPxPerMeter}
            gridSize={gridSize}
            graphicPointerState={graphicPointerState}
            selectedGraphicAssetId={selectedGraphicAssetId}
          />

          {/* Transparent hit area to capture clicks on empty space */}
          <Rect
            name="floor-plan-hit-area"
            {...hitArea}
            fill="transparent"
            listening={true}
            perfectDrawEnabled={false}
          />
        </Group>
      )}
      {!onProjectedSnapGuidesChange && (
        <PlanProjectionGuides
          guides={projectedSnapGuides}
          zoom={planView.zoom}
          pxPerMeter={canvasPxPerMeter}
          fontFamily={fontFamily}
          themeMode={theme.mode}
        />
      )}
    </>
  )
}
