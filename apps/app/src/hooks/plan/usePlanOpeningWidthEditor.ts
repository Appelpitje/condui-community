import { useEffect, useMemo, useState } from 'react'
import { computeOpeningGeometry } from '@/handlers/plan/wallDrawing'
import type { Door, Floor, Point2, Wall, Window } from '@/types/schema'
import type { Selection } from '@/types/ui'
import type { ProjectState } from '@/stores/projectStore'
import {
  clearFloorPlanDrawDimensionEditor,
  setFloorPlanDrawDimensionEditor,
} from '@/components/canvas/plan/floorPlanDrawDimensionEditorStore'
import { getOpeningWidthEditorGeometry } from '@/lib/plan/openingWidthEditorGeometry'

export type PlanOpeningWidthEditorModel = {
  kind: 'door' | 'window'
  id: string
  width: number
  center: Point2
  tangent: Point2
  doorDirection: Door['direction'] | null
  doorSwing: Door['swing'] | null
}

type UsePlanOpeningWidthEditorOptions = {
  activeFloor: Floor | null | undefined
  activeTool: string
  canvasPxPerMeter: number
  canEditFloorPlan: boolean
  zoom: number
  doorsForRender: Door[]
  isFloorPlanMode: boolean
  selection: Selection
  updateDoor: ProjectState['updateDoor']
  updateWindow: ProjectState['updateWindow']
  windowsForRender: Window[]
}

export function usePlanOpeningWidthEditor({
  activeFloor,
  activeTool,
  canvasPxPerMeter,
  canEditFloorPlan,
  doorsForRender,
  isFloorPlanMode,
  selection,
  updateDoor,
  updateWindow,
  windowsForRender,
  zoom,
}: UsePlanOpeningWidthEditorOptions) {
  const selectedOpeningForWidthEditor = useMemo<PlanOpeningWidthEditorModel | null>(() => {
    const canShowInTool =
      activeTool === 'select' || activeTool === 'insertDoor' || activeTool === 'insertWindow'
    if (!isFloorPlanMode || !canShowInTool || !activeFloor?.floorPlan) return null
    if ((selection.type !== 'door' && selection.type !== 'window') || selection.ids.length !== 1) {
      return null
    }

    const openingId = selection.ids[0]
    const isDoor = selection.type === 'door'
    const opening = isDoor
      ? doorsForRender.find((door) => door.id === openingId)
      : windowsForRender.find((window) => window.id === openingId)
    if (!opening) return null

    const wall = activeFloor.floorPlan.walls.find((candidate: Wall) => candidate.id === opening.wallId)
    if (!wall) return null

    const geom = computeOpeningGeometry(wall.points, opening.position)
    if (!geom) return null

    return {
      kind: selection.type,
      id: opening.id,
      width: opening.width,
      center: geom.center,
      tangent: geom.tangent,
      doorDirection: isDoor ? ((opening as Door).direction ?? 'out') : null,
      doorSwing: isDoor ? ((opening as Door).swing ?? 'right') : null,
    }
  }, [
    activeFloor,
    activeTool,
    doorsForRender,
    isFloorPlanMode,
    selection.ids,
    selection.type,
    windowsForRender,
  ])
  const [openingWidthText, setOpeningWidthText] = useState(() => {
    const width = selectedOpeningForWidthEditor
      ? (selectedOpeningForWidthEditor.width / canvasPxPerMeter) * 100 : Number.NaN
    return Number.isFinite(width) ? `${Math.round(width * 10) / 10}` : ''
  })
  const [openingWidthEditorActive, setOpeningWidthEditorActive] = useState(false)
  const openingWidthEditorOwnerId = selectedOpeningForWidthEditor
    ? `opening-width:${selectedOpeningForWidthEditor.kind}:${selectedOpeningForWidthEditor.id}`
    : 'opening-width'

  const [draftSource, setDraftSource] = useState({ canvasPxPerMeter, selectedOpeningForWidthEditor })
  if (draftSource.canvasPxPerMeter !== canvasPxPerMeter ||
    draftSource.selectedOpeningForWidthEditor !== selectedOpeningForWidthEditor) {
    setDraftSource({ canvasPxPerMeter, selectedOpeningForWidthEditor })
    if (!selectedOpeningForWidthEditor) {
      setOpeningWidthText('')
      setOpeningWidthEditorActive(false)
    } else {
      const widthDisplay = (selectedOpeningForWidthEditor.width / canvasPxPerMeter) * 100
      setOpeningWidthText(Number.isFinite(widthDisplay) ? `${Math.round(widthDisplay * 10) / 10}` : '')
      setOpeningWidthEditorActive(false)
    }
  }
  if (!canEditFloorPlan && openingWidthEditorActive) setOpeningWidthEditorActive(false)

  useEffect(() => {
    if (!selectedOpeningForWidthEditor || !openingWidthEditorActive || !canEditFloorPlan) {
      clearFloorPlanDrawDimensionEditor(openingWidthEditorOwnerId)
      return
    }

    const geometry = getOpeningWidthEditorGeometry(selectedOpeningForWidthEditor, zoom)
    setFloorPlanDrawDimensionEditor({
      ownerId: openingWidthEditorOwnerId,
      fields: [
        {
          id: openingWidthEditorOwnerId,
          anchor: geometry.anchor,
          placement: 'center',
          value: openingWidthText,
          active: true,
          rotationDeg: geometry.rotationDeg,
        },
      ],
      onActivate: () => undefined,
      onChange: (_id, value) => setOpeningWidthText(value),
      onEnter: () => {
        const parsed = Number.parseFloat(openingWidthText.replace(',', '.'))
        const widthPx = (parsed / 100) * canvasPxPerMeter
        if (!Number.isFinite(widthPx) || widthPx <= 0) return
        if (Math.abs(widthPx - selectedOpeningForWidthEditor.width) >= 1e-4) {
          if (selectedOpeningForWidthEditor.kind === 'door') {
            updateDoor(selectedOpeningForWidthEditor.id, { width: widthPx })
          } else {
            updateWindow(selectedOpeningForWidthEditor.id, { width: widthPx })
          }
        }
        setOpeningWidthEditorActive(false)
      },
      onTab: () => undefined,
      onEscape: () => {
        const widthDisplay = (selectedOpeningForWidthEditor.width / canvasPxPerMeter) * 100
        setOpeningWidthText(
          Number.isFinite(widthDisplay) ? `${Math.round(widthDisplay * 10) / 10}` : ''
        )
        setOpeningWidthEditorActive(false)
      },
    })
  }, [
    canvasPxPerMeter,
    canEditFloorPlan,
    openingWidthEditorActive,
    openingWidthEditorOwnerId,
    openingWidthText,
    selectedOpeningForWidthEditor,
    updateDoor,
    updateWindow,
    zoom,
  ])

  useEffect(
    () => () => clearFloorPlanDrawDimensionEditor(openingWidthEditorOwnerId),
    [openingWidthEditorOwnerId]
  )

  return {
    openingWidthEditorActive,
    openingWidthText,
    selectedOpeningForWidthEditor,
    setOpeningWidthEditorActive,
  }
}
