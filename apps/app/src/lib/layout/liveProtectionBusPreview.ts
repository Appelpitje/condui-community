import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import type { WireSegment } from '@/types/schema'
import type { DropTarget } from './findDropTarget'
import {
  getProtectionPreviewBusSegments,
  isSecondaryBusPreviewTarget,
} from './eendraadPreviewTarget'

/** Existing rails already contain all geometry needed for the floating insertion ghost. */
export function resolveLiveProtectionBusPreview(
  symbolId: string | undefined,
  target: DropTarget | null | undefined,
  position: { x: number; y: number },
  wires: WireSegment[]
) {
  if (!target?.panelId || !(PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbolId ?? ''))
    return null
  const secondary = isSecondaryBusPreviewTarget(target)
  if (
    !secondary &&
    !(
      target.type === 'mainBus' &&
      typeof target.mainBusInsertIndex === 'number' &&
      typeof target.mainBusItemCount === 'number'
    )
  )
    return null
  const segments = getProtectionPreviewBusSegments(
    wires,
    target,
    target.diagramId ?? target.panelId
  ).filter((segment) => Math.abs(position.y - segment.startPoint.y) <= 20)
  // Bodies/nesting targets still need the full layout to locate their new device.
  if (!segments.length) return null
  const hit =
    segments.find(
      (segment) =>
        position.x >= Math.min(segment.startPoint.x, segment.endPoint.x) &&
        position.x <= Math.max(segment.startPoint.x, segment.endPoint.x)
    ) ??
    segments.reduce((closest, segment) =>
      Math.abs((segment.startPoint.x + segment.endPoint.x) / 2 - position.x) <
      Math.abs((closest.startPoint.x + closest.endPoint.x) / 2 - position.x)
        ? segment
        : closest
    )
  const left = Math.min(
    ...segments.flatMap((segment) => [segment.startPoint.x, segment.endPoint.x])
  )
  const right = Math.max(
    ...segments.flatMap((segment) => [segment.startPoint.x, segment.endPoint.x])
  )
  return {
    panelId: target.panelId,
    x: position.x,
    busY: hit.startPoint.y,
    hit,
    segments: secondary ? segments : [],
    extensionX: secondary ? (position.x < left ? left : position.x > right ? right : null) : null,
  }
}

export type LiveProtectionBusPreviewGeometry = NonNullable<
  ReturnType<typeof resolveLiveProtectionBusPreview>
>
