import type { WireSegment } from '@/types/schema'
import { getEnclosureSeparatorGeometry } from './enclosureSeparatorGeometry'

interface SupplySeparatorGeometry {
  id: string
  diagramId: string
  /** Dashed pieces; a label that cannot be avoided splits the dash in two. */
  pieces: Array<[number, number, number, number]>
  center: { x: number; y: number }
  horizontal: boolean
  transition?: { from: string; to: string }
}

export function getSupplySeparatorsForDiagram(
  wireSegments: WireSegment[],
  diagramId: string
): SupplySeparatorGeometry[] {
  const diagramSegments = wireSegments.filter((segment) => segment.diagramId === diagramId)
  const enclosureBoundaries = diagramSegments.filter(
    (segment) => segment.supplyEnclosureBoundary === true || segment.enclosureTransition != null
  )
  const separators: SupplySeparatorGeometry[] = enclosureBoundaries.map((segment) => {
    const geometry = getEnclosureSeparatorGeometry(segment)
    return {
      id: `supply-enclosure-separator-${diagramId}-${segment.id}`,
      diagramId,
      pieces: geometry.pieces,
      center: geometry.center,
      horizontal: geometry.horizontal,
      ...(segment.enclosureTransition ? { transition: segment.enclosureTransition } : {}),
    }
  })
  if (enclosureBoundaries.some((segment) => segment.supplyEnclosureBoundary === true))
    return separators

  const crossing = diagramSegments.find(
    (segment) =>
      segment.isSupplyTrunk === true &&
      segment.supplyWireRole === 'crossing' &&
      segment.supplySeparatorX != null
  )
  if (!crossing || crossing.supplySeparatorX == null) return separators

  const legacySeparator: SupplySeparatorGeometry = {
    id: `supply-separator-${diagramId}`,
    diagramId,
    pieces: [
      [
        crossing.supplySeparatorX,
        crossing.startPoint.y - 16,
        crossing.supplySeparatorX,
        crossing.startPoint.y + 16,
      ],
    ],
    center: { x: crossing.supplySeparatorX, y: crossing.startPoint.y },
    horizontal: true,
  }
  return [...separators, legacySeparator]
}

function separatorPointsEqual(left: SupplySeparatorGeometry, right: SupplySeparatorGeometry) {
  const a = left.pieces.flat()
  const b = right.pieces.flat()
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]!) < 0.001)
}

export function getChangedSupplySeparatorsForDiagram(
  previewWireSegments: WireSegment[],
  currentWireSegments: WireSegment[],
  diagramId: string
): SupplySeparatorGeometry[] {
  const currentById = new Map(
    getSupplySeparatorsForDiagram(currentWireSegments, diagramId).map((separator) => [
      separator.id,
      separator,
    ])
  )
  return getSupplySeparatorsForDiagram(previewWireSegments, diagramId).filter((preview) => {
    // Simulating an unrelated drop can rebuild an enclosure boundary with a new wire id.
    // Stable geometry means there is no separator change to preview.
    const current =
      currentById.get(preview.id) ??
      [...currentById.values()].find((candidate) => separatorPointsEqual(preview, candidate))
    return !current || !separatorPointsEqual(preview, current)
  })
}
