import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import type { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import { EMPTY_WALL_SELECTION_IDS } from '@/components/canvas/plan/planCanvasBindings'
import React, { useCallback, useEffect, useMemo } from 'react'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import {
  encodeStairPointId,
  encodeWallPointId,
  parseStairPointIds,
  parseWallPointIds,
  resolvePlanCanvasPointSelection,
} from '@/lib/plan/planCanvasPointSelection'
import {
  createFloorPlanClipboardPayload,
  selectWallsForFloorPlanClipboard,
} from '@/lib/plan/floorPlanClipboard'

import type { Placement, Point2, Stair } from '@/types/schema'
import { getStairBounds } from '@/components/canvas/plan'
import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'
import { PROJECTED_SNAP_GUIDE_AUTO_CLEAR_MS } from '@/constants/canvasConstants'

interface PlanGeometrySelectionOptions {
  selection: import('@/types/ui').Selection
  mixedSelectedDoorIds: string[]
  mixedSelectedWindowIds: string[]
  applyMixedSelectedDoorIds: React.Dispatch<React.SetStateAction<string[]>>
  applyMixedSelectedWindowIds: React.Dispatch<React.SetStateAction<string[]>>
  applySelection: (selection: import('@/types/ui').Selection) => void
  vertexMoveProjectedSnapGuides: {
    from: import('@/types/schema').Point2
    to: import('@/types/schema').Point2
    hideDistanceLabel?: boolean | undefined
  }[]

  applyVertexMoveProjectedSnapGuides: React.Dispatch<
    React.SetStateAction<
      {
        from: import('@/types/schema').Point2
        to: import('@/types/schema').Point2
        hideDistanceLabel?: boolean | undefined
      }[]
    >
  >
  selectedStairPointIndices: Map<string, number[]>
  stairSelectionDragRef: ReturnType<typeof usePlanGeometryGestureState>['stairSelectionDragRef']
  stairsForRender: ReturnType<typeof usePlanCanvasGeometry>['stairsForRender']
  wallsForRender: ReturnType<typeof usePlanCanvasGeometry>['wallsForRender']
  selectedSegmentIndices: Map<string, number[]>
  graphicElementsForRender: ReturnType<typeof usePlanCanvasGeometry>['graphicElementsForRender']
  doorsForRender: ReturnType<typeof usePlanCanvasGeometry>['doorsForRender']
  windowsForRender: ReturnType<typeof usePlanCanvasGeometry>['windowsForRender']
  activeFloorId: string | null
  activeFloor: import('@/types/schema').Floor | null | undefined
  getPlacementsByFloor: (floorId: string) => (import('@/types/schema').Placement & {
    endpointId?: string | undefined
    trunkDeviceId?: string | undefined
    enclosureId?: string | undefined
    planLabel?: string | undefined
    junctionPanelLabel?: string | undefined
    isEarthing?: boolean | undefined
  })[]
  planCanvasViewportPx: { width: number; height: number } | null
  containerRef: React.RefObject<HTMLDivElement | null>
  planView: import('@/types/ui').ViewState
  activeTool: import('@/types/ui').PlanToolMode
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  isFloorPlanMode: boolean
  updatePlanGraphicElement: (
    elementId: string,
    updates: Partial<import('@/types/schema').PlanGraphicElement>
  ) => void
  floorPlanClipboardRef: React.RefObject<
    import('@/lib/plan/floorPlanClipboard').FloorPlanClipboardPayload | null
  >
  selectedPointIndices: Map<string, number[]>
}

export function usePlanGeometrySelection({
  selection,
  mixedSelectedDoorIds,
  mixedSelectedWindowIds,
  applyMixedSelectedDoorIds,
  applyMixedSelectedWindowIds,
  applySelection,
  vertexMoveProjectedSnapGuides,

  applyVertexMoveProjectedSnapGuides,
  selectedStairPointIndices,
  stairSelectionDragRef,
  stairsForRender,
  wallsForRender,
  selectedSegmentIndices,
  graphicElementsForRender,
  doorsForRender,
  windowsForRender,
  activeFloorId,
  activeFloor,
  getPlacementsByFloor,
  planCanvasViewportPx,
  containerRef,
  planView,
  activeTool,
  viewportUI,
  isFloorPlanMode,
  updatePlanGraphicElement,
  floorPlanClipboardRef,
  selectedPointIndices,
}: PlanGeometrySelectionOptions) {
  const window = useCanvasWindow()

  const selectedWallIds = useMemo(
    function () {
      if (selection.type === 'wall') return selection.ids
      if (selection.type === 'wallPoint' && selection.ids.length > 0) {
        const parsed = parseWallPointIds(selection.ids)
        return Array.from(parsed.keys())
      }
      return EMPTY_WALL_SELECTION_IDS
    },
    [selection.type, selection.ids]
  )
  const selectedDoorIds = useMemo(
    () =>
      Array.from(
        new Set([...(selection.type === 'door' ? selection.ids : []), ...mixedSelectedDoorIds])
      ),
    [selection.type, selection.ids, mixedSelectedDoorIds]
  )
  const selectedWindowIds = useMemo(
    () =>
      Array.from(
        new Set([...(selection.type === 'window' ? selection.ids : []), ...mixedSelectedWindowIds])
      ),
    [selection.type, selection.ids, mixedSelectedWindowIds]
  )
  const clearMixedOpeningSelection = useCallback(() => {
    applyMixedSelectedDoorIds([])
    applyMixedSelectedWindowIds([])
  }, [applyMixedSelectedDoorIds, applyMixedSelectedWindowIds])
  const retainDirectOpeningSelectionForMixed = useCallback(() => {
    if (selection.type === 'door') {
      applyMixedSelectedDoorIds((current) => Array.from(new Set([...current, ...selection.ids])))
    }
    if (selection.type === 'window') {
      applyMixedSelectedWindowIds((current) => Array.from(new Set([...current, ...selection.ids])))
    }
  }, [selection.type, selection.ids, applyMixedSelectedDoorIds, applyMixedSelectedWindowIds])
  const toggleMixedOpeningSelection = useCallback(
    (kind: 'door' | 'window', openingId: string) => {
      const doors = new Set(selectedDoorIds)
      const windows = new Set(selectedWindowIds)
      const target = kind === 'door' ? doors : windows
      if (target.has(openingId)) target.delete(openingId)
      else target.add(openingId)

      const hasGeometrySelection =
        selection.type === 'wall' ||
        selection.type === 'wallPoint' ||
        selection.type === 'stair' ||
        selection.type === 'stairPoint'

      if (hasGeometrySelection) {
        applyMixedSelectedDoorIds(Array.from(doors))
        applyMixedSelectedWindowIds(Array.from(windows))
        return
      }

      if (kind === 'door' && doors.size > 0) {
        applySelection({ type: 'door', ids: Array.from(doors) })
        applyMixedSelectedDoorIds([])
        applyMixedSelectedWindowIds(Array.from(windows))
        return
      }
      if (kind === 'window' && windows.size > 0) {
        applySelection({ type: 'window', ids: Array.from(windows) })
        applyMixedSelectedDoorIds(Array.from(doors))
        applyMixedSelectedWindowIds([])
        return
      }
      if (doors.size > 0) {
        applySelection({ type: 'door', ids: Array.from(doors) })
        applyMixedSelectedDoorIds([])
        applyMixedSelectedWindowIds(Array.from(windows))
        return
      }
      if (windows.size > 0) {
        applySelection({ type: 'window', ids: Array.from(windows) })
        applyMixedSelectedDoorIds(Array.from(doors))
        applyMixedSelectedWindowIds([])
        return
      }

      clearMixedOpeningSelection()
      applySelection({ type: null, ids: [] })
    },
    [
      selectedDoorIds,
      selectedWindowIds,
      selection.type,
      clearMixedOpeningSelection,
      applySelection,
      applyMixedSelectedDoorIds,
      applyMixedSelectedWindowIds,
    ]
  )
  const selectedGraphicElementIds = useMemo(
    () => (selection.type === 'graphicElement' ? selection.ids : []),
    [selection.ids, selection.type]
  )
  useEffect(
    function () {
      if (vertexMoveProjectedSnapGuides.length === 0) return
      const timer = window.setTimeout(() => {
        applyVertexMoveProjectedSnapGuides([])
      }, PROJECTED_SNAP_GUIDE_AUTO_CLEAR_MS)
      return () => window.clearTimeout(timer)
    },
    [applyVertexMoveProjectedSnapGuides, vertexMoveProjectedSnapGuides, window]
  )
  const selectedStairIds = useMemo(
    function () {
      if (selection.type === 'stair') return selection.ids
      if (selection.type === 'stairPoint')
        return selection.ids.length > 0 ? [selection.ids[0]!] : []
      if (selection.type === 'wallPoint' && selection.ids.length > 0) {
        const parsed = parseStairPointIds(selection.ids)
        return Array.from(parsed.keys())
      }
      return []
    },
    [selection.type, selection.ids]
  )
  const selectedStairId = useMemo(
    function () {
      if (selection.type === 'stair' || selection.type === 'stairPoint') {
        return selection.ids[0] ?? null
      }
      if (selection.type === 'wallPoint' && selection.ids.length > 0) {
        const parsed = parseStairPointIds(selection.ids)
        return parsed.size === 1 && selectedWallIds.length === 0
          ? (Array.from(parsed.keys())[0] ?? null)
          : null
      }
      return null
    },
    [selection.type, selection.ids, selectedWallIds]
  )
  const selectedStairPointIndex = useMemo(
    function () {
      if (selection.type === 'stairPoint') {
        const parsed = Number(selection.ids[1])
        return Number.isFinite(parsed) ? parsed : null
      }
      if (selection.type === 'wallPoint' && selectedWallIds.length === 0 && selectedStairId) {
        const indices = selectedStairPointIndices.get(selectedStairId) ?? []
        return indices.length === 1 ? indices[0]! : null
      }
      return null
    },
    [selection.type, selection.ids, selectedWallIds, selectedStairId, selectedStairPointIndices]
  )
  useEffect(
    function () {
      if (selection.type === 'stair' || selection.type === 'stairPoint') return
      stairSelectionDragRef.current = {
        stairId: null,
        pointIndex: null,
        start: null,
        initialPoints: null,
        mode: 'free',
      }
    },
    [selection.type, stairSelectionDragRef]
  )
  const selectedStair = useMemo(
    () =>
      selectedStairId
        ? (stairsForRender.find((stair: Stair) => stair.id === selectedStairId) ?? null)
        : null,
    [selectedStairId, stairsForRender]
  )
  const selectedStairsForCopy = useMemo(
    () => stairsForRender.filter((stair) => selectedStairIds.includes(stair.id)),
    [stairsForRender, selectedStairIds]
  )
  const selectedWallsForCopy = useMemo(
    () =>
      selectWallsForFloorPlanClipboard({
        walls: wallsForRender,
        selectedWallIds,
        selectedSegmentIndices,
      }),
    [wallsForRender, selectedWallIds, selectedSegmentIndices]
  )
  const selectedGraphicElementsForCopy = useMemo(
    () =>
      graphicElementsForRender.filter((element) => selectedGraphicElementIds.includes(element.id)),
    [graphicElementsForRender, selectedGraphicElementIds]
  )
  const selectedOpeningsForCopy = useMemo(
    function () {
      const selectedWallIdSet = new Set(selectedWallsForCopy.map((wall) => wall.id))
      return {
        doors: doorsForRender.filter((door) => selectedWallIdSet.has(door.wallId)),
        windows: windowsForRender.filter((window) => selectedWallIdSet.has(window.wallId)),
      }
    },
    [selectedWallsForCopy, doorsForRender, windowsForRender]
  )
  const createClipboardPayloadFromSelection = useCallback(() => {
    if (!activeFloorId || !activeFloor) return null
    const selectedPlacementIds = new Set(selection.type === 'placement' ? selection.ids : [])
    const selectedPlacementsForCopy = getPlacementsByFloor(activeFloorId).flatMap(
      (row: Placement & { endpointId?: string }) => {
        if (!selectedPlacementIds.has(row.id) || !row.endpointId) return []
        return [
          {
            endpointId: row.endpointId,
            placement: {
              id: row.id,
              floorId: row.floorId,
              layer: row.layer,
              pos: row.pos,
              rotationDeg: row.rotationDeg,
              rotationMode: row.rotationMode,
              scale: row.scale,
              locked: row.locked,
              style: row.style,
            },
          },
        ]
      }
    )
    return createFloorPlanClipboardPayload({
      sourceFloorId: activeFloorId,
      sourcePxPerMeter: calculatePxPerMeter(activeFloor) ?? 100,
      sourceMasterWallThickness: activeFloor.floorPlan?.masterWallThickness ?? 20,
      walls: selectedWallsForCopy,
      doors: selectedOpeningsForCopy.doors,
      windows: selectedOpeningsForCopy.windows,
      stairs: selectedStairsForCopy,
      graphicElements: selectedGraphicElementsForCopy,
      placements: selectedPlacementsForCopy,
    })
  }, [
    activeFloor,
    activeFloorId,
    selectedGraphicElementsForCopy,
    selectedOpeningsForCopy.doors,
    selectedOpeningsForCopy.windows,
    selectedStairsForCopy,
    selectedWallsForCopy,
    getPlacementsByFloor,
    selection.ids,
    selection.type,
  ])

  const getPlanViewportCenter = useCallback((): Point2 | undefined => {
    const width = planCanvasViewportPx?.width ?? containerRef.current?.clientWidth ?? 0
    const height = planCanvasViewportPx?.height ?? containerRef.current?.clientHeight ?? 0
    if (width <= 0 || height <= 0 || planView.zoom <= 0) return undefined
    return {
      x: (width / 2 - planView.pan.x) / planView.zoom,
      y: (height / 2 - planView.pan.y) / planView.zoom,
    }
  }, [
    planCanvasViewportPx?.height,
    planCanvasViewportPx?.width,
    planView.pan,
    planView.zoom,
    containerRef,
  ])

  const shouldKeepGeometryTouchSelection = useCallback(
    (
      event: object | undefined,
      kind: 'wall' | 'stair' | 'door' | 'window',
      id: string,
      pointIndex?: number
    ) => {
      const pointer = event as Partial<TouchEvent & PointerEvent> | undefined
      if (
        !pointer ||
        !(
          pointer.type?.startsWith('touch') ||
          pointer.changedTouches ||
          pointer.pointerType === 'touch'
        )
      ) {
        return false
      }
      const appWindow = window as typeof window & { __eendraSuppressNextElementTap?: boolean }
      if (appWindow.__eendraSuppressNextElementTap) {
        appWindow.__eendraSuppressNextElementTap = false
        return true
      }
      if (
        activeTool !== 'select' ||
        pointer.shiftKey ||
        pointer.altKey ||
        pointer.ctrlKey ||
        pointer.metaKey
      ) {
        return false
      }
      const liveSelection = viewportUI.getState().selection
      if (liveSelection.ids.length <= 1) return false
      if (liveSelection.type === kind) return liveSelection.ids.includes(id)
      if (liveSelection.type !== 'wallPoint' || (kind !== 'wall' && kind !== 'stair')) return false
      const points =
        kind === 'wall'
          ? parseWallPointIds(liveSelection.ids)
          : parseStairPointIds(liveSelection.ids)
      const indices = points.get(id)
      return !!indices?.length && (pointIndex === undefined || indices.includes(pointIndex))
    },
    [activeTool, window, viewportUI]
  )

  const handleGraphicElementSelect = useCallback(
    (elementId: string, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
      if (!isFloorPlanMode || activeTool !== 'select') return
      const isMultiSelect = !!(event && (event.shiftKey || event.ctrlKey || event.metaKey))
      if (!isMultiSelect || selection.type !== 'graphicElement') {
        applySelection({ type: 'graphicElement', ids: [elementId] })
        return
      }
      const existing = new Set(selection.ids)
      if (existing.has(elementId)) existing.delete(elementId)
      else existing.add(elementId)
      const ids = Array.from(existing)
      applySelection(ids.length > 0 ? { type: 'graphicElement', ids } : { type: null, ids: [] })
    },
    [activeTool, isFloorPlanMode, selection.ids, selection.type, applySelection]
  )

  const handleGraphicElementMove = useCallback(
    (elementId: string, pos: Point2) => {
      if (!isFloorPlanMode || activeTool !== 'select') return
      updatePlanGraphicElement(elementId, { pos })
    },
    [activeTool, isFloorPlanMode, updatePlanGraphicElement]
  )

  const handleGraphicElementResize = useCallback(
    (elementId: string, size: { width: number; height: number }) => {
      if (!isFloorPlanMode || activeTool !== 'select') return
      updatePlanGraphicElement(elementId, size)
    },
    [activeTool, isFloorPlanMode, updatePlanGraphicElement]
  )

  const handleCopySelectionToFloors = useCallback(
    (targetFloorIds: string[], options: { copyOpenings: boolean }) => {
      if (targetFloorIds.length === 0) return
      const payload = createClipboardPayloadFromSelection()
      if (!payload) return
      runProjectCommand('plan.copyToFloor', {
        payload,
        targetFloorIds,
        copyOpenings: options.copyOpenings,
      })
    },
    [createClipboardPayloadFromSelection]
  )

  const handleCopyFloorPlanSelection = useCallback(() => {
    const payload = createClipboardPayloadFromSelection()
    if (!payload) return false
    floorPlanClipboardRef.current = payload
    return true
  }, [createClipboardPayloadFromSelection, floorPlanClipboardRef])

  const handlePasteFloorPlanSelection = useCallback(() => {
    const payload = floorPlanClipboardRef.current
    if (!activeFloorId || !payload) return false
    const outcome = runProjectCommand(
      'plan.copyToFloor',
      {
        payload,
        targetFloorIds: [activeFloorId],
        copyOpenings: true,
        ...(payload.sourceFloorId === activeFloorId
          ? { targetCenter: getPlanViewportCenter() }
          : {}),
      },
      { label: 'paste-floor-plan-selection' }
    )
    const select = outcome?.results[0]?.select ?? []
    if (!outcome?.changed) return false
    const selectionTypeByKind = {
      wall: 'wall',
      stair: 'stair',
      element: 'graphicElement',
      placement: 'placement',
    } as const
    const kind = select[0]?.kind as keyof typeof selectionTypeByKind | undefined
    if (kind && kind in selectionTypeByKind) {
      applySelection({ type: selectionTypeByKind[kind], ids: select.map((ref) => ref.id) })
    }
    return true
  }, [activeFloorId, applySelection, getPlanViewportCenter, floorPlanClipboardRef])
  const buildEncodedFloorPointIds = useCallback(
    (wallPoints: Map<string, number[]>, stairPoints: Map<string, number[]>): string[] => {
      const ids: string[] = []
      for (const [wallId, indices] of wallPoints.entries()) {
        for (const index of indices) ids.push(encodeWallPointId(wallId, index))
      }
      for (const [stairId, indices] of stairPoints.entries()) {
        for (const index of indices) ids.push(encodeStairPointId(stairId, index))
      }
      return ids
    },
    []
  )
  const getCurrentMixedPointSelection = useCallback(
    () =>
      resolvePlanCanvasPointSelection({
        selection,
        selectedWallPointIndices: selectedPointIndices,
        selectedStairPointIndices,
        walls: activeFloor?.floorPlan?.walls ?? [],
        stairs: stairsForRender,
      }),
    [
      activeFloor?.floorPlan?.walls,
      selection,
      selectedPointIndices,
      selectedStairPointIndices,
      stairsForRender,
    ]
  )
  const stairSelectionBounds = useMemo(
    function () {
      if (!selectedStair) return null
      if (selection.type === 'wallPoint') return null
      if (selection.type === 'stairPoint' && selectedStairPointIndex != null) {
        const point = selectedStair.points[selectedStairPointIndex]
        if (!point) return null
        return {
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
        }
      }
      return getStairBounds(selectedStair)
    },
    [selectedStair, selection.type, selectedStairPointIndex]
  )

  return {
    selectedWallIds,
    selectedDoorIds,
    selectedWindowIds,
    clearMixedOpeningSelection,
    retainDirectOpeningSelectionForMixed,
    toggleMixedOpeningSelection,
    selectedGraphicElementIds,
    selectedStairIds,
    selectedStairId,
    selectedStairPointIndex,
    selectedStair,
    selectedStairsForCopy,
    selectedWallsForCopy,
    selectedGraphicElementsForCopy,
    selectedOpeningsForCopy,
    createClipboardPayloadFromSelection,
    getPlanViewportCenter,
    shouldKeepGeometryTouchSelection,
    handleGraphicElementSelect,
    handleGraphicElementMove,
    handleGraphicElementResize,
    handleCopySelectionToFloors,
    handleCopyFloorPlanSelection,
    handlePasteFloorPlanSelection,
    buildEncodedFloorPointIds,
    getCurrentMixedPointSelection,
    stairSelectionBounds,
  }
}
