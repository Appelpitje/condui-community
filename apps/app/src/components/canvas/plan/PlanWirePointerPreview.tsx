import { useStore } from 'zustand'
import type { PointerPreviewStore } from '@/hooks/usePointerPreview'
import {
  buildPlanWireVArrowHead,
  planWireIncomingAtEnd,
  planWireSplineIncomingAtEnd,
} from '@/lib/plan/planWireArrow'
import { planWireVisualMetrics } from '@/lib/plan/planWireVisualMetrics'
import { PlanWireDragPreview } from './PlanWireDragPreview'

type Point = { x: number; y: number }

/** Only this small overlay subscribes to the live pointer; the plan stays unchanged. */
export function PlanWirePointerPreview({
  pointStore,
  source,
  target,
  illegalTarget,
  routeStyle,
  stroke,
  zoom,
  pxPerMeter,
}: {
  pointStore: PointerPreviewStore
  source: Point
  target: Point | null
  illegalTarget: boolean
  routeStyle: string
  stroke: string
  zoom?: number
  pxPerMeter?: number | null
}) {
  const pointer = useStore(pointStore, (state) => state.point)
  const end = target ?? pointer
  if (!end) return null
  const dx = end.x - source.x,
    dy = end.y - source.y
  const distance = Math.hypot(dx, dy)
  if (distance <= 1e-6) return null
  const metrics = planWireVisualMetrics(zoom, pxPerMeter)
  const color = illegalTarget ? '#ef4444' : stroke
  if (routeStyle === 'spline') {
    const handle = Math.min(distance * 0.44, 180)
    const horizontal = Math.abs(dx) >= Math.abs(dy)
    const direction = horizontal ? (dx >= 0 ? 1 : -1) : dy >= 0 ? 1 : -1
    const controlA = horizontal
      ? { x: source.x + direction * handle, y: source.y }
      : { x: source.x, y: source.y + direction * handle }
    const controlB = horizontal
      ? { x: end.x - direction * handle, y: end.y }
      : { x: end.x, y: end.y - direction * handle }
    const incoming = planWireSplineIncomingAtEnd(end, controlB)
    return (
      <PlanWireDragPreview
        zoom={zoom}
        pxPerMeter={pxPerMeter}
        preview={{
          stroke: color,
          path: `M ${source.x} ${source.y} C ${controlA.x} ${controlA.y} ${controlB.x} ${controlB.y} ${end.x} ${end.y}`,
          points: null,
          arrowHead: incoming
            ? buildPlanWireVArrowHead(end, incoming, {
                length: metrics.arrowLength,
                width: metrics.arrowWidth,
              })
            : null,
        }}
      />
    )
  }
  const elbow = Math.abs(dy) >= Math.abs(dx) ? { x: source.x, y: end.y } : { x: end.x, y: source.y }
  const incoming = planWireIncomingAtEnd(end, elbow)
  return (
    <PlanWireDragPreview
      zoom={zoom}
      pxPerMeter={pxPerMeter}
      preview={{
        stroke: color,
        path: null,
        points: [source.x, source.y, elbow.x, elbow.y, end.x, end.y],
        arrowHead: incoming
          ? buildPlanWireVArrowHead(end, incoming, {
              length: metrics.arrowLength,
              width: metrics.arrowWidth,
            })
          : null,
      }}
    />
  )
}
