import { useMemo } from 'react'
import { getBranchDropPreviewUnit, type BranchDropTargets } from '@/lib/layout/branchDropInteraction'
import { getDropZoneHintProximityForDistance } from '@/lib/layout/dropZoneHintDeclutter'
import { LocalSvgCanvasOverlay, type CanvasSvgOverlayItem } from '../shared/LocalSvgCanvasOverlay'

const pointerOpacity = (item: CanvasSvgOverlayItem, distance: number | null) => item.opacity === 1 ? 1
  : 0.12 + 0.88 * getDropZoneHintProximityForDistance(distance ?? Infinity)

export function BranchDropHints({ targets, activeId, zoom }: {
  targets: BranchDropTargets; activeId: string | null; zoom: number
}) {
  const items = useMemo<CanvasSvgOverlayItem[]>(() => targets.intents.map((intent) => {
    const { point, wirePoint: wire } = intent
    const unit = getBranchDropPreviewUnit(zoom)
    const strokeUnit = 1 / zoom
    const radius = 4.5 * unit
    const padding = radius + 1.5 * strokeUnit
    const left = Math.min(point.x, wire.x) - padding
    const top = Math.min(point.y, wire.y) - padding
    return {
      id: `branch-drop-${intent.id}`, pointerAnchor: point,
      opacity: intent.id === activeId ? 1 : 0.12,
      bounds: { x: left, y: top, width: Math.abs(point.x - wire.x) + padding * 2,
        height: Math.abs(point.y - wire.y) + padding * 2 },
      content: intent.kind === 'multiply' && intent.id === activeId ? null : <>
        {!intent.id.includes('/body/') && (point.x !== wire.x || point.y !== wire.y) &&
          <line x1={point.x} y1={point.y} x2={wire.x} y2={wire.y}
            stroke="#0284c7" strokeWidth={strokeUnit} strokeDasharray={`${3 * unit} ${3 * unit}`} />}
        <circle cx={point.x} cy={point.y} r={radius} fill="rgba(2,132,199,0.08)"
          stroke="#0284c7" strokeWidth={strokeUnit}
          strokeDasharray={intent.kind === 'multiply' ? undefined : `${3 * unit} ${2 * unit}`} />
        {intent.kind === 'multiply' && <path
          d={`M${point.x - 2.5 * unit},${point.y}h${5 * unit}M${point.x},${point.y - 2.5 * unit}v${5 * unit}`}
          stroke="#0284c7" strokeWidth={1.2 * strokeUnit} />}
      </>,
    }
  }), [targets, activeId, zoom])
  return <LocalSvgCanvasOverlay name="branch-drop-hints" items={items} pointerOpacity={pointerOpacity} />
}
