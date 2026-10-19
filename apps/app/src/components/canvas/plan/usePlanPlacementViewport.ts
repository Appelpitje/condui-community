import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { KonvaRenderer } from 'react-konva'
import { useUIStore } from '@/stores/uiStore'
import { registerCanvasGroupMaterialization } from '@/lib/canvas/groupMaterialization'
import {
  scheduleLiveGroupMountCheck,
  cancelLiveGroupMountCheck,
} from '@/lib/canvas/liveGroupMountScheduling'
import { awaitPendingSymbolImages } from '@/lib/symbolImage'
import type { Placement } from '@/types/schema'

type Row = Placement & { endpointId?: string; trunkDeviceId?: string }
export type PlacementViewportExtent = { pos: { x: number; y: number }; radius: number }
let subscriptionId = 0
const OVERSCAN = 240

export function usePlanPlacementViewport<T extends Row>(
  placements: T[],
  initialZoom?: number,
  extents?: ReadonlyMap<string, PlacementViewportExtent>
) {
  const groupRef = useRef<Konva.Group>(null)
  const selection = useUIStore((state) => state.selection)
  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids])
  const isSelected = (placement: T) =>
    selectedIds.has(placement.id) ||
    (placement.endpointId != null && selectedIds.has(placement.endpointId)) ||
    (placement.trunkDeviceId != null && selectedIds.has(placement.trunkDeviceId))
  const [complete, setComplete] = useState(false)
  const leases = useRef(0)
  const [view, setView] = useState(() => {
    const camera = useUIStore.getState().planView
    const zoom = initialZoom ?? camera.zoom
    const ids = new Set(
      placements
        .filter((placement) => {
          const extent = extents?.get(placement.id)
          const pos = extent?.pos ?? placement.pos
          const margin = OVERSCAN + (extent?.radius ?? 0) * Math.abs(zoom)
          const x = pos.x * zoom + camera.pan.x
          const y = pos.y * zoom + camera.pan.y
          return (
            x >= -margin &&
            x <= window.innerWidth + margin &&
            y >= -margin &&
            y <= window.innerHeight + margin
          )
        })
        .map((placement) => placement.id)
    )
    return { ids, zoom }
  })
  const viewRef = useRef(view)
  viewRef.current = view

  useLayoutEffect(() => {
    const group = groupRef.current
    const layer = group?.getLayer()
    const stage = group?.getStage()
    if (!group || !layer || !stage) return
    let active = true
    const update = () => {
      if (!active || Konva.isDragging()) return
      const transform = group.getAbsoluteTransform()
      const zoom = Math.max(
        Math.abs(group.getAbsoluteScale().x),
        Math.abs(group.getAbsoluteScale().y)
      )
      const ids = new Set(
        placements
          .filter((placement) => {
            const extent = extents?.get(placement.id)
            const point = transform.point(extent?.pos ?? placement.pos)
            const margin = OVERSCAN + (extent?.radius ?? 0) * zoom
            return (
              point.x >= -margin &&
              point.x <= stage.width() + margin &&
              point.y >= -margin &&
              point.y <= stage.height() + margin
            )
          })
          .map((placement) => placement.id)
      )
      const previous = viewRef.current
      if (
        zoom === previous.zoom &&
        ids.size === previous.ids.size &&
        [...ids].every((id) => previous.ids.has(id))
      )
        return
      const next = { ids, zoom }
      viewRef.current = next
      setView(next)
    }
    const schedule = () => scheduleLiveGroupMountCheck(update)
    const namespace = `.planPlacementViewport${++subscriptionId}`
    layer.on(
      `xChange${namespace} yChange${namespace} scaleXChange${namespace} scaleYChange${namespace} dragend${namespace}`,
      schedule
    )
    stage.on(`widthChange${namespace} heightChange${namespace}`, schedule)
    schedule()
    return () => {
      active = false
      cancelLiveGroupMountCheck(update)
      layer.off(namespace)
      stage.off(namespace)
    }
  }, [placements, extents])

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    let active = true
    const unregister = registerCanvasGroupMaterialization(group, async () => {
      leases.current++
      let released = false
      const release = () => {
        if (released) return
        released = true
        leases.current--
        if (active && leases.current === 0)
          KonvaRenderer.flushSyncFromReconciler(() => setComplete(false))
      }
      try {
        KonvaRenderer.flushSyncFromReconciler(() => setComplete(true))
        KonvaRenderer.flushPassiveEffects()
        await awaitPendingSymbolImages()
        KonvaRenderer.flushSyncFromReconciler(() => {})
        KonvaRenderer.flushPassiveEffects()
        return release
      } catch (error) {
        release()
        throw error
      }
    })
    return () => {
      active = false
      unregister()
    }
  }, [])

  // Only a lease for this floor's export materializes its complete layers.
  // The global export flag also covers one-wire and panels and must not expand
  // an unrelated mounted plan during those exports.
  const fullDetail = complete
  // Uncommon cross-canvas selections (boards/ground) retain every candidate so
  // their specialized symbol selection logic remains authoritative.
  const specialSelection =
    selection.ids.length > 0 &&
    !['placement', 'endpoint', 'trunkDevice'].includes(selection.type ?? '')
  return {
    groupRef,
    zoom: view.zoom,
    fullDetail,
    isSelected,
    visiblePlacements:
      placements.length <= 500 || fullDetail || specialSelection
        ? placements
        : placements.filter((placement) => view.ids.has(placement.id) || isSelected(placement)),
  }
}
