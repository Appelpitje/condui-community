import type { DropTarget } from './findDropTarget'
import type { WireSegment } from '@/types/schema'

/** Structural edits need their wider supply/panel consequences visible before drop. */
export function usesStructuralDropPreview(symbolId: string | undefined, target: DropTarget | null | undefined): boolean {
  return !!target?.type?.startsWith('supply') || [
    'panel_distribution', 'mains', 'backup_feed', 'source_changeover',
    'inverter', 'transformer', 'rectifier', 'dc_dc_converter', 'dc_bus',
  ].includes(symbolId ?? '')
}

/** Both RCD rails and nested-circuit rails have ordered protection slots. */
export function isSecondaryBusPreviewTarget(target: DropTarget | null | undefined): boolean {
  return !!target && !target.dcBusId && typeof target.secondaryBusInsertIndex === 'number' &&
    ((target.type === 'circuit' && !!target.circuitId) ||
      (target.type === 'rcd' && !!target.protectionId))
}

/** Select the actual rail, excluding its feeder and rails in other frames. */
export function getProtectionPreviewBusSegments(
  segments: WireSegment[], target: DropTarget, diagramId: string
): WireSegment[] {
  const inFrame = (segment: WireSegment) => segment.panelId === target.panelId &&
    (segment.diagramId ?? segment.panelId) === diagramId
  const rootX = target.type === 'circuit' ? segments.find((segment) =>
    inFrame(segment) && segment.type === 'vertical' && segment.circuitId === target.circuitId &&
    segment.fromElementType === 'protection'
  )?.startPoint.x : undefined
  return segments.filter((segment) => {
    if (!inFrame(segment)) return false
    if (target.type === 'rcd') {
      return segment.type === 'trunk' && segment.fromElementType === 'rcd' &&
        segment.fromElementId === target.protectionId
    }
    if (segment.type !== 'mainBus') return false
    return target.type === 'circuit'
      ? segment.fromElementType === 'secondaryBus' && segment.circuitId === target.circuitId
      : segment.fromElementType !== 'secondaryBus'
  }).flatMap((segment) => {
    // Nested rails start at their parent's stem, not at the small left overhang
    // of the layout hit zone. Match the existing secondary-bus preview clipping.
    if (rootX == null || segment.startPoint.x >= rootX) return [segment]
    return segment.endPoint.x <= rootX ? [] : [{ ...segment, startPoint: { ...segment.startPoint, x: rootX } }]
  })
}

/**
 * Pick the circuit whose top nesting slot should anchor a protection preview.
 * The resolved drop target is authoritative; debug hit nodes can belong to an
 * overlapping parent slot when nesting below an existing secondary bus.
 */
export function resolveProtectionNestPreviewCircuitId(
  dropTarget: DropTarget | null | undefined,
  matchedNestCircuitId: string | undefined,
): string | undefined {
  if (
    dropTarget?.type === 'circuit' &&
    dropTarget.circuitId &&
    typeof dropTarget.secondaryBusInsertIndex !== 'number'
  ) {
    return dropTarget.circuitId
  }
  return matchedNestCircuitId
}
