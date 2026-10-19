import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Group, Rect, KonvaRenderer } from 'react-konva'
import Konva from 'konva'
import { installLiveGroupViewportCulling } from '@/lib/canvas/liveGroupViewportCulling'
import { registerCanvasGroupMaterialization } from '@/lib/canvas/groupMaterialization'
import { awaitPendingSymbolImages } from '@/lib/symbolImage'
import {
  scheduleLiveGroupMountCheck,
  cancelLiveGroupMountCheck,
} from '@/lib/canvas/liveGroupMountScheduling'
import { PANEL_SCENE_FRAME_MARGIN, type PanelSceneSurface } from '@/lib/panel/panelScene'

type View = { pan: { x: number; y: number }; zoom: number; width: number; height: number }
const OVERSCAN = 400
export const PANEL_DETAIL_MIN_ZOOM = 0.4
let nextSubscription = 0

export function PanelSurfaceGroup({
  surface,
  initialView,
  forceMounted,
  forceDetails = false,
  overview,
  children,
}: {
  surface: Pick<PanelSceneSurface, 'id' | 'x' | 'y' | 'width' | 'height'>
  initialView: View
  forceMounted: boolean
  forceDetails?: boolean
  overview?: () => ReactNode
  children: () => ReactNode
}) {
  const groupRef = useRef<Konva.Group>(null)
  const [exportMounted, setExportMounted] = useState(false)
  const [detailed, setDetailed] = useState(initialView.zoom >= PANEL_DETAIL_MIN_ZOOM)
  const detailedRef = useRef(detailed)
  detailedRef.current = detailed
  const materializations = useRef(0)
  const [mounted, setMounted] = useState(() => {
    const { pan, zoom, width, height } = initialView
    return !(
      (surface.x + surface.width) * zoom + pan.x < -OVERSCAN ||
      surface.x * zoom + pan.x > width + OVERSCAN ||
      (surface.y + surface.height) * zoom + pan.y < -OVERSCAN ||
      surface.y * zoom + pan.y > height + OVERSCAN
    )
  })
  const mountedRef = useRef(mounted)
  mountedRef.current = mounted

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    let active = true
    const unregister = registerCanvasGroupMaterialization(group, async () => {
      materializations.current++
      let released = false
      const release = () => {
        if (released) return
        released = true
        materializations.current--
        if (active && materializations.current === 0)
          KonvaRenderer.flushSyncFromReconciler(() => setExportMounted(false))
      }
      try {
        KonvaRenderer.flushSyncFromReconciler(() => setExportMounted(true))
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

  useLayoutEffect(() => {
    const group = groupRef.current
    const layer = group?.getLayer()
    const stage = group?.getStage()
    if (!group || !layer || !stage) return
    let active = true
    const check = () => {
      // Do not unmount the owner of an in-progress drag or its resize handles.
      if (!active || Konva.isDragging()) return
      const nextDetailed = Math.abs(layer.scaleX()) >= PANEL_DETAIL_MIN_ZOOM
      if (nextDetailed !== detailedRef.current) {
        detailedRef.current = nextDetailed
        setDetailed(nextDetailed)
      }
      const transform = group.getAbsoluteTransform()
      const topLeft = transform.point({
        x: -PANEL_SCENE_FRAME_MARGIN,
        y: -PANEL_SCENE_FRAME_MARGIN * 2,
      })
      const bottomRight = transform.point({
        x: surface.width + PANEL_SCENE_FRAME_MARGIN,
        y: surface.height + PANEL_SCENE_FRAME_MARGIN,
      })
      const next = !(
        bottomRight.x < -OVERSCAN ||
        topLeft.x > stage.width() + OVERSCAN ||
        bottomRight.y < -OVERSCAN ||
        topLeft.y > stage.height() + OVERSCAN
      )
      if (next !== mountedRef.current) {
        mountedRef.current = next
        setMounted(next)
      }
    }
    const schedule = () => scheduleLiveGroupMountCheck(check)
    const namespace = `.panelSurfaceMount${++nextSubscription}`
    layer.on(
      `xChange${namespace} yChange${namespace} scaleXChange${namespace} scaleYChange${namespace} dragend${namespace}`,
      schedule
    )
    group.on(`xChange${namespace} yChange${namespace}`, schedule)
    stage.on(`widthChange${namespace} heightChange${namespace}`, schedule)
    schedule()
    const releaseCulling = installLiveGroupViewportCulling(group, {
      x: -PANEL_SCENE_FRAME_MARGIN,
      y: -PANEL_SCENE_FRAME_MARGIN * 2,
      width: surface.width + PANEL_SCENE_FRAME_MARGIN * 2,
      height: surface.height + PANEL_SCENE_FRAME_MARGIN * 3,
    })
    return () => {
      active = false
      cancelLiveGroupMountCheck(check)
      layer.off(namespace)
      group.off(namespace)
      stage.off(namespace)
      releaseCulling()
    }
  }, [surface.width, surface.height])

  return (
    <Group
      ref={groupRef}
      x={surface.x}
      y={surface.y}
      name={`hierarchy-surface hierarchy-surface-${surface.id}`}
    >
      <Rect
        name="panel-surface-placeholder"
        width={surface.width}
        height={surface.height}
        fillEnabled={false}
        strokeEnabled={false}
        listening={false}
      />
      {forceMounted || exportMounted || mounted
        ? overview && !forceDetails && !forceMounted && !exportMounted && !detailed
          ? overview()
          : children()
        : null}
    </Group>
  )
}
