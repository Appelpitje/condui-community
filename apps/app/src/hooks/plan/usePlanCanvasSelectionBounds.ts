import type { usePlanCanvasMarqueeSelection } from '@/hooks/plan/usePlanCanvasMarqueeSelection'
import { useCallback } from 'react'
import { usePlanDragVisualStore } from '@/stores/planDragVisualStore'
import { useProjectStore } from '@/stores/projectStore'
import { resolvePlanMarqueePlacementOwner } from '@/lib/plan/planMarqueeSelection'
import type { Placement, Panel } from '@/types/schema'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { estimateCableRoutesCached } from '@/lib/cableRouting/cableRoutePlanWires'
import { selectedCableBounds } from '@/lib/cableRouting/cableRouteSelection'
import { resolvePanelForDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
} from '@/lib/projectV2/electrical'

interface PlanCanvasSelectionBoundsOptions {
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  getPlacementsByFloor: (floorId: string) => (import('@/types/schema').Placement & {
    endpointId?: string | undefined
    trunkDeviceId?: string | undefined
    enclosureId?: string | undefined
    planLabel?: string | undefined
    junctionPanelLabel?: string | undefined
    isEarthing?: boolean | undefined
  })[]
  getPlacementWorldBoundsMemo: ReturnType<
    typeof usePlanCanvasMarqueeSelection
  >['getPlacementWorldBoundsMemo']
  getEndpointById: (id: string) => import('@/types/schema').Endpoint | undefined
}

export function usePlanCanvasSelectionBounds({
  viewportUI,
  getPlacementsByFloor,
  getPlacementWorldBoundsMemo,
  getEndpointById,
}: PlanCanvasSelectionBoundsOptions) {
  const handleGetSelectionBounds = useCallback(
    function () {
      const { selection } = viewportUI.getState()
      if (selection.ids.length === 0) return null
      // A selected cable: frame its runs on this floor, so F finds it.
      const project = useProjectStore.getState().currentProject
      const floorId = viewportUI.getState().activeFloorId
      if (isCableRoutesEnabled() && project && floorId) {
        const cableBounds = selectedCableBounds(
          selection,
          estimateCableRoutesCached(project).routes,
          floorId
        )
        if (cableBounds) return cableBounds
      }
      const tempDragPositions = usePlanDragVisualStore.getState().positions

      const floorIdForPlacements = viewportUI.getState().activeFloorId ?? ''
      const floorPlacements = getPlacementsByFloor(floorIdForPlacements)
      const store = useProjectStore.getState()
      const currentInst = store.currentProject
        ? selectProjectElectricalInstallation(store.currentProject)
        : undefined

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let found = false

      if (selection.type === 'graphicElement') {
        const floor = store.getFloorById(floorIdForPlacements)
        for (const element of floor?.floorPlan?.graphicElements ?? []) {
          if (!selection.ids.includes(element.id)) continue
          minX = Math.min(minX, element.pos.x - element.width / 2)
          minY = Math.min(minY, element.pos.y - element.height / 2)
          maxX = Math.max(maxX, element.pos.x + element.width / 2)
          maxY = Math.max(maxY, element.pos.y + element.height / 2)
          found = true
        }
        if (!found) return null
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        }
      }

      if (selection.type === 'ground' && selection.ids.includes('ground')) {
        const earthingRow = floorPlacements.find(
          (row: Placement) => (row as Placement & { isEarthing?: boolean }).isEarthing
        )
        if (earthingRow) {
          const pos = tempDragPositions.get(earthingRow.id) ?? earthingRow.pos
          const bounds = getPlacementWorldBoundsMemo(
            pos,
            earthingRow.rotationDeg,
            earthingRow.scale,
            1,
            'earthing'
          )
          const width = bounds.right - bounds.left
          const height = bounds.bottom - bounds.top
          if (width > 0 && height > 0) {
            return { x: bounds.left, y: bounds.top, width, height }
          }
        }
        return null
      }

      // Helper: true if any of the candidateIds is in the current selection
      const isAnyIdSelected = (candidateIds: string[]) =>
        candidateIds.some((id) => id && selection.ids.includes(id))

      floorPlacements.forEach((row: Placement) => {
        const placement = row as Placement & {
          endpointId?: string
          trunkDeviceId?: string
          junctionPanelLabel?: string
          isEarthing?: boolean
        }
        const pos = tempDragPositions.get(placement.id) ?? placement.pos

        if (placement.isEarthing) {
          if (!selection.ids.includes('ground')) return
          const bounds = getPlacementWorldBoundsMemo(
            pos,
            placement.rotationDeg,
            placement.scale,
            1,
            'earthing'
          )
          minX = Math.min(minX, bounds.left)
          minY = Math.min(minY, bounds.top)
          maxX = Math.max(maxX, bounds.right)
          maxY = Math.max(maxY, bounds.bottom)
          found = true
          return
        }

        // Junction panels: selection may contain trunkDevice ids (device ids) and/or the placement id.
        if (placement.junctionPanelLabel != null) {
          const jpLabel = placement.junctionPanelLabel
          const candidateIds: string[] = [placement.id]

          if (currentInst) {
            const labelMatchesJunction = (d: { type: string; label: string }) =>
              d.type === 'junction_panel' && d.label === jpLabel

            currentInst.mainSupply?.supplyTrunkDevices
              ?.filter(labelMatchesJunction)
              .forEach((d: { id: string }) => candidateIds.push(d.id))
            currentInst.groundTrunkDevices
              ?.filter(labelMatchesJunction)
              .forEach((d: { id: string }) => candidateIds.push(d.id))
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
                  .forEach((d: { id: string }) => candidateIds.push(d.id))
              )
            })
          }

          if (!isAnyIdSelected(candidateIds)) return

          const bounds = getPlacementWorldBoundsMemo(
            pos,
            placement.rotationDeg,
            placement.scale,
            1,
            'junction_panel'
          )
          minX = Math.min(minX, bounds.left)
          minY = Math.min(minY, bounds.top)
          maxX = Math.max(maxX, bounds.right)
          maxY = Math.max(maxY, bounds.bottom)
          found = true
          return
        }

        // Keep persistent selection bounds in sync with marquee hit-testing for
        // both endpoint- and trunk-device-backed placements.
        const owner = resolvePlanMarqueePlacementOwner(
          placement,
          getEndpointById,
          (id) => store.getTrunkDeviceById(id)?.device
        )
        if (!owner) return

        const { endpoint, selectionIds, socketCount, symbol } = owner
        const candidateIds = [...selectionIds]

        // Panel symbols: also include panel id so panel selection contributes to bounds
        if (endpoint?.symbol === 'panel_distribution' && store.currentProject) {
          const panel = resolvePanelForDistributionEndpoint(store.currentProject, endpoint)
          if (panel) candidateIds.push(panel.id)
        }

        if (!isAnyIdSelected(candidateIds)) return

        const bounds = getPlacementWorldBoundsMemo(
          pos,
          placement.rotationDeg,
          placement.scale,
          socketCount,
          symbol
        )
        minX = Math.min(minX, bounds.left)
        minY = Math.min(minY, bounds.top)
        maxX = Math.max(maxX, bounds.right)
        maxY = Math.max(maxY, bounds.bottom)
        found = true
      })

      if (!found) return null
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      }
    },
    [getPlacementWorldBoundsMemo, getEndpointById, getPlacementsByFloor, viewportUI]
  )

  return { handleGetSelectionBounds }
}
