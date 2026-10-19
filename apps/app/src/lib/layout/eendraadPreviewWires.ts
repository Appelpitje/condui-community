import type { WireSegment } from '@/types/schema'
import type { BottomUpPanelLayout } from './bottomUpLayout'
import type { LayoutNode } from './layoutTree'

const GEOMETRY_EPSILON = 0.001

export interface PreviewPanelTranslation {
  x: number
  y: number
}

/** Pin a routine branch/device ghost to its committed protection stem. */
export function getPreviewCircuitTranslation(
  currentPanel: LayoutNode | undefined,
  previewPanel: LayoutNode,
  circuitId: string | undefined
): PreviewPanelTranslation {
  if (!currentPanel || !circuitId) return { x: 0, y: 0 }
  const find = (node: LayoutNode): LayoutNode | undefined => {
    if ((node.type === 'mcb' || node.type === 'rcd') && node.circuitIdForWires === circuitId) return node
    for (const child of node.children) {
      const match = find(child)
      if (match) return match
    }
    return undefined
  }
  const current = find(currentPanel)
  const preview = find(previewPanel)
  return current && preview
    ? { x: current.bounds.x - preview.bounds.x, y: current.bounds.y - preview.bounds.y }
    : { x: 0, y: 0 }
}

/**
 * Keep a detached supply preview on the same visual anchor as the committed frame.
 *
 * Supply frames are allowed to grow to the left and may be moved down when the
 * simulated frame would overlap another panel. The electrical handoff is the
 * stable point in both cases; the frame bounds are not.
 */
export function getPreviewPanelTranslation(
  currentPanelLayout: BottomUpPanelLayout | undefined,
  previewPanelLayout: BottomUpPanelLayout
): PreviewPanelTranslation {
  if (!currentPanelLayout || previewPanelLayout.frameRole !== 'supply') {
    return { x: 0, y: 0 }
  }

  const currentHandoff = {
    x: currentPanelLayout.mainBus.x + currentPanelLayout.mainBus.width,
    y: currentPanelLayout.mainBus.y,
  }
  const previewHandoff = {
    x: previewPanelLayout.mainBus.x + previewPanelLayout.mainBus.width,
    y: previewPanelLayout.mainBus.y,
  }

  return {
    x: currentHandoff.x - previewHandoff.x,
    y: currentHandoff.y - previewHandoff.y,
  }
}

function sameCoordinate(a: number, b: number): boolean {
  return Math.abs(a - b) <= GEOMETRY_EPSILON
}

/** Compare preview wires without relying on generated segment IDs. */
export function isSamePreviewWireSegment(a: WireSegment, b: WireSegment): boolean {
  return (
    a.panelId === b.panelId &&
    a.type === b.type &&
    a.circuitId === b.circuitId &&
    a.fromElementId === b.fromElementId &&
    a.fromElementType === b.fromElementType &&
    a.toElementId === b.toElementId &&
    a.toElementType === b.toElementType &&
    a.isSupplyTrunk === b.isSupplyTrunk &&
    a.isSubPanelSupply === b.isSubPanelSupply &&
    a.supplyWireRole === b.supplyWireRole &&
    a.supplyFeedScope === b.supplyFeedScope &&
    a.domoticaOutputGroup === b.domoticaOutputGroup &&
    a.domoticaOutputIndex === b.domoticaOutputIndex &&
    sameCoordinate(a.startPoint.x, b.startPoint.x) &&
    sameCoordinate(a.startPoint.y, b.startPoint.y) &&
    sameCoordinate(a.endPoint.x, b.endPoint.x) &&
    sameCoordinate(a.endPoint.y, b.endPoint.y)
  )
}

/** Keep only preview wires whose topology or geometry differs from the current scene. */
export function getChangedPreviewWireSegments(
  previewSegments: WireSegment[],
  currentSegments: WireSegment[],
  panelId: string,
  previewPanelNode?: LayoutNode,
  diagramId: string = panelId
): WireSegment[] {
  const currentPanelSegments = currentSegments.filter(
    (segment) => segment.panelId === panelId && (segment.diagramId ?? segment.panelId) === diagramId
  )
  const secondaryBusRootXByCircuitId = new Map<string, number>()
  const visit = (node: LayoutNode) => {
    if (
      node.type === 'mcb' &&
      node.circuitIdForWires &&
      node.children.some((child) => child.type === 'mcb' || child.type === 'secondaryBus')
    ) {
      secondaryBusRootXByCircuitId.set(node.circuitIdForWires, node.bounds.x)
    }
    node.children.forEach(visit)
  }
  if (previewPanelNode) visit(previewPanelNode)

  const normalizedPreviewSegments = previewSegments.flatMap((segment) => {
    const rootX = segment.circuitId
      ? secondaryBusRootXByCircuitId.get(segment.circuitId)
      : undefined
    const isSecondaryBusBar =
      segment.type === 'mainBus' &&
      segment.fromElementType === 'secondaryBus' &&
      segment.toElementType === 'secondaryBus'
    if (!isSecondaryBusBar || rootX == null || segment.startPoint.x >= rootX) {
      return [segment]
    }
    if (segment.endPoint.x <= rootX + GEOMETRY_EPSILON) return []
    return [{ ...segment, startPoint: { ...segment.startPoint, x: rootX } }]
  })

  return normalizedPreviewSegments.filter(
    (previewSegment) =>
      previewSegment.panelId === panelId &&
      (previewSegment.diagramId ?? previewSegment.panelId) === diagramId &&
      !currentPanelSegments.some((currentSegment) =>
        isSamePreviewWireSegment(previewSegment, currentSegment)
      )
  )
}

/** Return the portions of a line which are not already drawn in the committed scene. */
function subtractDrawnWire(
  segment: WireSegment,
  currentSegments: WireSegment[],
  translation: PreviewPanelTranslation
): WireSegment[] {
  const dx = segment.endPoint.x - segment.startPoint.x
  const dy = segment.endPoint.y - segment.startPoint.y
  const length = Math.hypot(dx, dy)
  if (length <= GEOMETRY_EPSILON) return []
  const ux = dx / length
  const uy = dy / length
  let remaining: Array<[number, number]> = [[0, length]]
  for (const current of currentSegments) {
    if (
      current.panelId !== segment.panelId ||
      (current.diagramId ?? current.panelId) !== (segment.diagramId ?? segment.panelId)
    ) continue
    // The enclosing preview group translates detached supply frames back onto
    // their committed handoff. Compare ink in that same coordinate space.
    const points = [current.startPoint, current.endPoint].map((point) => ({
      x: point.x - translation.x, y: point.y - translation.y,
    }))
    if (points.some((point) => Math.abs(
      (point.x - segment.startPoint.x) * uy - (point.y - segment.startPoint.y) * ux
    ) > GEOMETRY_EPSILON)) continue
    const projections = points.map((point) =>
      (point.x - segment.startPoint.x) * ux + (point.y - segment.startPoint.y) * uy
    )
    const from = Math.min(...projections)
    const to = Math.max(...projections)
    remaining = remaining.flatMap(([start, end]): Array<[number, number]> => {
      if (to <= start || from >= end) return [[start, end]]
      const pieces: Array<[number, number]> = []
      if (from - start > GEOMETRY_EPSILON) pieces.push([start, from])
      if (end - to > GEOMETRY_EPSILON) pieces.push([to, end])
      return pieces
    })
    if (!remaining.length) break
  }
  return remaining.map(([start, end], index) => ({
    ...segment,
    id: `${segment.id}-addition-${index}`,
    startPoint: { x: segment.startPoint.x + ux * start, y: segment.startPoint.y + uy * start },
    endPoint: { x: segment.startPoint.x + ux * end, y: segment.startPoint.y + uy * end },
  }))
}

/**
 * An ordinary drop previews its new/moved symbols and their connections, not the
 * reflow of existing branches. Keep only the added ink, including any extension
 * of the shared circuit stem needed to reach a new branch. Bus protection previews
 * deliberately keep their separate dynamic layout treatment.
 */
export function getAddedPreviewWireSegments(
  previewSegments: WireSegment[],
  currentSegments: WireSegment[],
  previewElementIds: ReadonlySet<string>,
  options: {
    translation?: PreviewPanelTranslation
    includeGroundStem?: boolean
    previewProtectionIds?: ReadonlySet<string>
  } = {}
): WireSegment[] {
  const connectsPreviewElement = (segment: WireSegment) => {
    // Wrapping existing content in a new protection changes the source ID on
    // every branch. Those branches are existing content, not the placed item.
    if (segment.type === 'branch' && segment.fromElementId &&
      options.previewProtectionIds?.has(segment.fromElementId) &&
      segment.toElementId && !previewElementIds.has(segment.toElementId)) return false
    return (
    (!!segment.fromElementId && previewElementIds.has(segment.fromElementId)) ||
    (!!segment.toElementId && previewElementIds.has(segment.toElementId)) ||
    [...previewElementIds].some((id) => segment.supplySectionKey?.includes(`device:${id}`))
    )
  }
  const targetCircuits = new Set(
    previewSegments.filter(connectsPreviewElement).map((segment) => segment.circuitId)
      .filter((id): id is string => !!id)
  )
  return previewSegments
    .filter((segment) => connectsPreviewElement(segment) || (
      !options.previewProtectionIds?.size && segment.type === 'vertical' && !segment.toElementId &&
      !!segment.circuitId && targetCircuits.has(segment.circuitId)
    ) || (options.includeGroundStem && segment.fromElementType === 'ground'))
    .map((segment) => {
      if (!segment.fromElementId || !options.previewProtectionIds?.has(segment.fromElementId) ||
        (segment.toElementId && previewElementIds.has(segment.toElementId))) return segment
      // Existing downstream content may move in the simulated layout. Show a
      // short output stub, not a feeder ending at its invisible reflowed position.
      const dx = segment.endPoint.x - segment.startPoint.x
      const dy = segment.endPoint.y - segment.startPoint.y
      const length = Math.hypot(dx, dy)
      if (length <= 40) return segment
      return { ...segment, endPoint: {
        x: segment.startPoint.x + dx / length * 40,
        y: segment.startPoint.y + dy / length * 40,
      } }
    })
    .flatMap((segment) => subtractDrawnWire(segment, currentSegments, options.translation ?? { x: 0, y: 0 }))
}

/**
 * A protection relocation changes both its source and destination buses in the
 * simulated layout. The source removal must influence layout, but it is not a
 * drop preview; only the destination topology should be highlighted.
 */
export function filterProtectionRelocationPreviewWires(
  segments: WireSegment[],
  sourceParentCircuitId: string | undefined,
  targetCircuitId: string | undefined
): WireSegment[] {
  if (!sourceParentCircuitId || sourceParentCircuitId === targetCircuitId) return segments
  return segments.filter((segment) => segment.circuitId !== sourceParentCircuitId)
}
