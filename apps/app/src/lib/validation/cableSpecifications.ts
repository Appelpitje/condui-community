import type { WireSegment } from '@/types/schema'
import { isPanelBusTapToProtectionOrRcd, pickRootmostLiveCircuitWireSegmentForFocus } from './circuitCableSection'
import { hasWirePlacement } from '@/lib/wires/circuitWireSpecifications'

export type CableSpecificationField = 'placement' | 'fireClass'

/** Internal rails and incoming bus taps are not outgoing installation cables. */
export function circuitCableSpecificationSegments(segments: WireSegment[], circuitId: string): WireSegment[] {
  return segments.filter((segment) => segment.circuitId === circuitId && segment.domain !== 'DC' &&
    segment.type !== 'mainBus' && segment.type !== 'secondaryBus' &&
    !isPanelBusTapToProtectionOrRcd(segment) &&
    segment.cable?.customKind?.toLowerCase() !== 'busbar' &&
    !(!segment.wireAnchor && (segment.wireAnchors?.length ?? 0) > 1) &&
    (Math.abs(segment.startPoint.x - segment.endPoint.x) > 0.001 ||
      Math.abs(segment.startPoint.y - segment.endPoint.y) > 0.001))
}

/** Shared by validation and click-to-focus so a known cable is never picked for a missing field. */
export function missingCableSpecificationSegments(
  segments: WireSegment[], circuitId: string, field: CableSpecificationField
): WireSegment[] {
  return circuitCableSpecificationSegments(segments, circuitId).filter((segment) =>
    field === 'fireClass' ? !segment.cable?.fireClass : !hasWirePlacement(segment))
}

/**
 * Click-to-focus target: the shared stem leaving the protection when every connection it carries
 * lacks the field, so the selection and panel match a click on that stem; otherwise the rootmost
 * missing connection.
 */
export function cableSpecificationFocusSegment(
  segments: WireSegment[], circuitId: string, field: CableSpecificationField, protectionId?: string
): WireSegment | undefined {
  const missing = missingCableSpecificationSegments(segments, circuitId, field)
  const missingAnchors = new Set(missing.flatMap((segment) => segment.wireAnchor ? [segment.wireAnchor] : []))
  const stem = segments.find((segment) => segment.circuitId === circuitId && segment.domain !== 'DC' &&
    segment.fromElementType === 'protection' && (protectionId == null || segment.fromElementId === protectionId) &&
    !segment.wireAnchor && (segment.wireAnchors?.length ?? 0) > 1 &&
    segment.wireAnchors!.every((anchor) => missingAnchors.has(anchor)) &&
    (Math.abs(segment.startPoint.x - segment.endPoint.x) > 0.001 ||
      Math.abs(segment.startPoint.y - segment.endPoint.y) > 0.001))
  return stem ?? pickRootmostLiveCircuitWireSegmentForFocus(missing, circuitId, protectionId, 'AC')
}
