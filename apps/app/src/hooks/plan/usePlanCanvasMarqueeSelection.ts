import type { usePlanCanvasWiringModel } from '@/hooks/plan/usePlanCanvasWiringModel'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import { useCallback } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import {
  encodeStairPointId,
  encodeWallPointId,
  STAIR_POINT_ID_PREFIX,
} from '@/lib/plan/planCanvasPointSelection'
import { resolvePlanMarqueePlacementOwner } from '@/lib/plan/planMarqueeSelection'
import type { Point } from '@/types/ui'
import type { Placement, Panel, Point2 } from '@/types/schema'
import { getPlacementWorldBounds } from '@/utils/plan/placementBounds'
import { segmentIntersectsRect } from '@/lib/geometry'
import { getWallPathPoints } from '@/lib/plan/wallCurve'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
} from '@/lib/projectV2/electrical'

interface PlanCanvasMarqueeSelectionOptions {
  baseSymbolSizePx: ReturnType<typeof usePlanCanvasGeometry>['baseSymbolSizePx']
  activeTool: import('@/types/ui').PlanToolMode
  isFloorPlanMode: boolean
  activeFloor: import('@/types/schema').Floor | null | undefined
  visiblePlacements: ReturnType<typeof usePlanCanvasWiringModel>['visiblePlacements']
  getEndpointById: (id: string) => import('@/types/schema').Endpoint | undefined
}

export function usePlanCanvasMarqueeSelection({
  baseSymbolSizePx,
  activeTool,
  isFloorPlanMode,
  activeFloor,
  visiblePlacements,
  getEndpointById,
}: PlanCanvasMarqueeSelectionOptions) {
  const getPlacementWorldBoundsMemo = useCallback(
    (pos: Point, rotationDeg: number, scale: number, socketCount: number, symbolType?: string) => {
      return getPlacementWorldBounds(
        pos,
        rotationDeg,
        scale,
        socketCount,
        symbolType,
        baseSymbolSizePx
      )
    },
    [baseSymbolSizePx]
  )

  // Find placements that intersect with selection rectangle
  const handleFindElementsInRectangle = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      // Wire mode edits wires: a drag rectangle picks floor passages, never symbols.
      if (activeTool === 'wiring') return []
      // In floor plan draw mode, drag-rect selects walls/vertices; otherwise it selects placements/endpoints/panels.
      if (isFloorPlanMode && activeFloor?.floorPlan) {
        type WallDragResult =
          | { type: 'wall'; id: string }
          | { type: 'vertex'; wallId: string; pointIndex: number }
          | { type: 'graphicElement'; id: string }

        const rectRight = rect.x + rect.width
        const rectBottom = rect.y + rect.height

        // Avoid selecting everything: a very small rect (e.g. accidental click-drag)
        // should not select by bbox intersection, which would hit almost every wall.
        const minRectSize = 8
        const rectIsTiny = rect.width < minRectSize || rect.height < minRectSize

        const results: WallDragResult[] = []
        let hasVertexSelection = false

        for (const wall of activeFloor.floorPlan.walls) {
          if (!wall.points.length) continue
          const sourcePoints = wall.points
          const pts = getWallPathPoints(wall)

          // Check which vertices fall inside the rectangle.
          const vertexIndicesInRect: number[] = []
          sourcePoints.forEach((p: Point2, idx: number) => {
            if (p.x >= rect.x && p.x <= rectRight && p.y >= rect.y && p.y <= rectBottom) {
              vertexIndicesInRect.push(idx)
            }
          })

          if (vertexIndicesInRect.length > 0) {
            hasVertexSelection = true
            vertexIndicesInRect.forEach((idx) => {
              results.push({ type: 'vertex', wallId: wall.id, pointIndex: idx })
            })
            continue
          }

          // No vertices inside the rect for this wall. Decide if the wall stroke itself
          // should be selected, based on polyline–rectangle intersection (stroke hit),
          // not the filled polygon area.
          if (!rectIsTiny) {
            let hit = false
            for (let i = 0; i < pts.length - 1; i++) {
              const p1 = pts[i]!
              const p2 = pts[i + 1]!
              if (segmentIntersectsRect(p1, p2, rect)) {
                hit = true
                break
              }
            }
            if (hit) {
              results.push({ id: wall.id, type: 'wall' })
            }
          }
        }

        const stairs = activeFloor.floorPlan.stairs ?? []
        for (const stair of stairs) {
          if (!stair.points.length) continue
          const vertexIndicesInRect: number[] = []
          stair.points.forEach((p: Point2, idx: number) => {
            if (p.x >= rect.x && p.x <= rectRight && p.y >= rect.y && p.y <= rectBottom) {
              vertexIndicesInRect.push(idx)
            }
          })
          if (vertexIndicesInRect.length > 0) {
            hasVertexSelection = true
            vertexIndicesInRect.forEach((idx) => {
              results.push({
                type: 'vertex',
                wallId: encodeStairPointId(stair.id, idx),
                pointIndex: idx,
              })
            })
          }
        }

        for (const element of activeFloor.floorPlan.graphicElements ?? []) {
          const left = element.pos.x - element.width / 2
          const right = element.pos.x + element.width / 2
          const top = element.pos.y - element.height / 2
          const bottom = element.pos.y + element.height / 2
          const intersects =
            left < rectRight && right > rect.x && top < rectBottom && bottom > rect.y
          if (intersects) {
            results.push({ id: element.id, type: 'graphicElement' })
          }
        }

        if (hasVertexSelection) {
          // Encode vertices so BaseCanvas can store them.
          return results
            .filter(
              (r): r is { type: 'vertex'; wallId: string; pointIndex: number } =>
                r.type === 'vertex'
            )
            .map((r) => ({
              id: r.wallId.startsWith(STAIR_POINT_ID_PREFIX)
                ? r.wallId
                : encodeWallPointId(r.wallId, r.pointIndex),
              type: 'wallPoint' as const,
            }))
        }

        return results.filter(
          (r): r is { type: 'wall' | 'graphicElement'; id: string } =>
            r.type === 'wall' || r.type === 'graphicElement'
        )
      }

      const results: Array<{ id: string; type: 'placement' | 'panel' | 'trunkDevice' }> = []

      const store = useProjectStore.getState()
      const inst = store.currentProject
        ? selectProjectElectricalInstallation(store.currentProject)
        : undefined

      visiblePlacements.forEach(
        (
          placementRow: Placement & {
            endpointId?: string
            trunkDeviceId?: string
            junctionPanelLabel?: string
            isEarthing?: boolean
          }
        ) => {
          const rectRight = rect.x + rect.width
          const rectBottom = rect.y + rect.height

          if (placementRow.isEarthing) {
            const bounds = getPlacementWorldBoundsMemo(
              placementRow.pos,
              placementRow.rotationDeg,
              placementRow.scale,
              1,
              'earthing'
            )
            const intersects =
              bounds.left < rectRight &&
              bounds.right > rect.x &&
              bounds.top < rectBottom &&
              bounds.bottom > rect.y
            if (intersects) results.push({ id: 'ground', type: 'panel' })
            return
          }

          // Junction panels: placement with junctionPanelLabel but no endpoint
          if (placementRow.junctionPanelLabel != null) {
            const pos = placementRow.pos
            const bounds = getPlacementWorldBoundsMemo(
              pos,
              placementRow.rotationDeg,
              placementRow.scale,
              1,
              'junction_panel'
            )

            const intersects =
              bounds.left < rectRight &&
              bounds.right > rect.x &&
              bounds.top < rectBottom &&
              bounds.bottom > rect.y

            if (!intersects) return

            const label = placementRow.junctionPanelLabel
            const junctionIds: string[] = []

            if (inst) {
              const labelMatchesJunction = (d: { type: string; label: string }) =>
                d.type === 'junction_panel' && d.label === label

              inst.mainSupply?.supplyTrunkDevices
                ?.filter(labelMatchesJunction)
                .forEach((d: { id: string }) => junctionIds.push(d.id))
              inst.groundTrunkDevices
                ?.filter(labelMatchesJunction)
                .forEach((d: { id: string }) => junctionIds.push(d.id))
              ;(store.currentProject
                ? selectProjectElectricalPanels(store.currentProject)
                : []
              ).forEach((panel: Panel) => {
                const circuits = [
                  ...(panel.circuits ?? []),
                  ...(panel.protections?.flatMap((pr) => pr.circuits ?? []) ?? []),
                ]
                circuits.forEach((c) =>
                  c.trunkDevices
                    ?.filter(labelMatchesJunction)
                    .forEach((d: { id: string }) => junctionIds.push(d.id))
                )
              })
            }

            if (junctionIds.length > 0) {
              junctionIds.forEach((id) => results.push({ id, type: 'trunkDevice' }))
            } else {
              // Fallback: at least select the placement itself
              results.push({ id: placementRow.id, type: 'trunkDevice' })
            }
            return
          }

          // Regular endpoint- and trunk-device-backed placements
          const owner = resolvePlanMarqueePlacementOwner(
            placementRow,
            getEndpointById,
            (id) => store.getTrunkDeviceById(id)?.device
          )
          if (!owner) return

          const { endpoint, socketCount, symbol } = owner

          const bounds = getPlacementWorldBoundsMemo(
            placementRow.pos,
            placementRow.rotationDeg,
            placementRow.scale,
            socketCount,
            symbol
          )

          const intersects =
            bounds.left < rectRight &&
            bounds.right > rect.x &&
            bounds.top < rectBottom &&
            bounds.bottom > rect.y

          if (!intersects) {
            return
          }

          // Panels: any endpoint whose label matches a panel name should be treated
          // as a panel (same behavior as single-click selection via panel-* Konva name).
          if (endpoint) {
            const panel = store.getPanelByName(endpoint.label)
            if (panel) {
              results.push({ id: panel.id, type: 'panel' })
              return
            }
          }

          // Placement id matches single-click / shift-click selection (one row per symbol)
          results.push({ id: placementRow.id, type: 'placement' })
        }
      )

      return results
    },
    [
      activeTool,
      visiblePlacements,
      getPlacementWorldBoundsMemo,
      getEndpointById,
      isFloorPlanMode,
      activeFloor,
    ]
  )

  return { getPlacementWorldBoundsMemo, handleFindElementsInRectangle }
}
