import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Konva from 'konva'
import { Group, Rect } from 'react-konva'
import type { DiagramDetailBounds } from '@/lib/eendraad/diagramDetailBounds'
import {
  cancelLiveGroupMountCheck,
  scheduleLiveGroupMountCheck,
} from '@/lib/canvas/liveGroupMountScheduling'
import {
  cancelLiveGroupDetail,
  liveGroupDetailPriority,
  scheduleLiveGroupDetail,
} from '@/lib/canvas/liveGroupDetailScheduling'

let nextRegion = 0

/** Only the outer diagram owns export materialization; small live regions need no export registry. */
export function ViewportDetailRegion({
  bounds,
  children,
}: {
  bounds: DiagramDetailBounds
  children: ReactNode
}) {
  const groupRef = useRef<Konva.Group>(null)
  const [visible, setVisible] = useState(false)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  useLayoutEffect(() => {
    const group = groupRef.current,
      layer = group?.getLayer(),
      stage = group?.getStage()
    if (!group || !layer || !stage) return
    const window = stage.container().ownerDocument.defaultView!
    const namespace = `.onewireDetail${++nextRegion}`
    let active = true
    let wanted = false
    const promote = () => {
      if (active && wanted) setVisible(true)
    }
    const refresh = () => {
      if (!active || (Konva.isDragging() && visibleRef.current)) return
      const transform = group.getAbsoluteTransform()
      const start = transform.point({ x: bounds.x, y: bounds.y })
      const end = transform.point({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
      const overscan = 80
      const next =
        stage.width() > 0 &&
        stage.height() > 0 &&
        Math.max(start.x, end.x) >= -overscan &&
        Math.min(start.x, end.x) <= stage.width() + overscan &&
        Math.max(start.y, end.y) >= -overscan &&
        Math.min(start.y, end.y) <= stage.height() + overscan
      wanted = next
      if (next && !visibleRef.current) {
        scheduleLiveGroupDetail(window, promote, liveGroupDetailPriority(stage, start, end))
      } else if (!next) {
        cancelLiveGroupDetail(window, promote)
        setVisible(false)
      }
    }
    const schedule = () => scheduleLiveGroupMountCheck(refresh)
    layer.on(
      `xChange${namespace} yChange${namespace} scaleXChange${namespace} scaleYChange${namespace}`,
      schedule
    )
    stage.on(`widthChange${namespace} heightChange${namespace} dragend${namespace}`, schedule)
    refresh()
    return () => {
      active = false
      cancelLiveGroupDetail(window, promote)
      cancelLiveGroupMountCheck(refresh)
      layer.off(namespace)
      stage.off(namespace)
    }
  }, [bounds])
  return (
    <Group ref={groupRef} name="onewire-detail-region">
      {visible ? (
        children
      ) : (
        <Rect name="onewire-virtual-detail-bounds" {...bounds} opacity={0} listening={false} />
      )}
    </Group>
  )
}
