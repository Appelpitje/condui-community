import type { Point } from '@/types/ui'
import { getPanelDiagramId, type BottomUpLayoutResult } from './bottomUpLayout'
import type { BranchDropIntent } from './branchDropInteraction'

export interface BranchInsertionPreviewGeometry {
  center: Point
  size: number
  wire: number[]
}

/** Presentation in the existing drawing's gap, independent of the post-drop layout. */
export function getBranchInsertionPreview(
  layout: BottomUpLayoutResult, intent: BranchDropIntent,
): BranchInsertionPreviewGeometry | null {
  if (intent.kind === 'multiply') return null
  const size = 22
  const half = size / 2
  const direction = intent.direction
  const anchor = intent.wirePoint
  if (intent.kind === 'trunk') return { center: anchor, size, wire: [] }
  if (intent.kind === 'branch') {
    const center = { x: anchor.x + direction * 36, y: anchor.y }
    return { center, size, wire: [anchor.x, anchor.y, center.x - direction * half, center.y] }
  }

  const panel = layout.panels.find((entry) => getPanelDiagramId(entry) === intent.target.diagramId)
  const ids = intent.target.branchEndpoints ?? []
  const points = ids.flatMap((id) => {
    const element = panel?.elements.find((entry) => entry.type === 'endpoint' && entry.endpointId === id)
    return element ? [element.position] : []
  })
  if (!points.length) return null
  const index = intent.target.insertAfterEndpointId == null ? 0
    : ids.indexOf(intent.target.insertAfterEndpointId) + 1
  const previous = points[index - 1]
  const next = points[index]
  if (!next && previous) {
    // Continuations sit beside the existing endpoint, including body/padded hits.
    const center = { x: previous.x + direction * 36, y: previous.y }
    return { center, size, wire: [previous.x + direction * 15, previous.y,
      center.x - direction * half, center.y] }
  }
  const room = next ? Math.abs(next.x - (previous?.x ?? anchor.x * 2 - next.x)) : 0
  // A short lead-in cannot contain a full block. Keep its anchor in that gap,
  // and show the block just above it rather than overlapping the existing glyph.
  const center = { x: anchor.x, y: anchor.y - (room < 60 ? 28 : 0) }
  return { center, size, wire: center.y === anchor.y ? []
    : [anchor.x, anchor.y, center.x, center.y + half] }
}
