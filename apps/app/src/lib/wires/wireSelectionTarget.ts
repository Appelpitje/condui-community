import type { WireSegment } from '@/types/schema'
import type { Selection } from '@/types/ui'

/** Selection follows electrical connections, independently of a saved run's shared properties. */
export function wireSegmentMatchesSelection(segment: WireSegment, selection: Selection): boolean {
  if (selection.type !== 'wire' && selection.type !== 'structuralConnection') return false
  if (selection.type === 'wire' && selection.ids.includes(segment.id)) return true
  const matches = (anchor: string | undefined) =>
    Boolean(anchor && (segment.wireAnchor === anchor || segment.wireAnchors?.includes(anchor)))
  if (matches(selection.wireAnchor)) return true
  return (
    selection.type === 'wire' &&
    Boolean(
      selection.wireMetadata?.some(
        (metadata) => matches(metadata.wireAnchor) || metadata.wireAnchors?.some(matches)
      )
    )
  )
}

/** Touch taps have no mouse button; mouse selection is primary-button only. */
export function isPrimaryWireSelection(button?: number): boolean {
  return button == null || button === 0
}

/**
 * A bus-section association describes which rail feeds a conductor; it does not turn that
 * conductor into the rail's selection surface. Only the rendered busbar itself selects the rail.
 */
export function wireSegmentSelectsBusSection(segment: WireSegment): boolean {
  return segment.type === 'mainBus' && Boolean(segment.busSectionId)
}
