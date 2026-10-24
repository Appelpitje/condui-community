import type { WireSegment } from '@/types/schema'
import { isPanelBusTapToProtectionOrRcd } from './circuitCableSection'
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
