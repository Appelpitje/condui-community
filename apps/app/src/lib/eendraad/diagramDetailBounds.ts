import type { LayoutNode } from '@/lib/layout/layoutTree'

export interface DiagramDetailBounds {
  x: number
  y: number
  width: number
  height: number
}
const boundsCache = new WeakMap<LayoutNode, DiagramDetailBounds>()

/** Derived layout nodes are revision-stable. Include descendants and floating metadata cards. */
export function diagramDetailBounds(node: LayoutNode): DiagramDetailBounds {
  const cached = boundsCache.get(node)
  if (cached) return cached
  let left = node.bounds.x,
    top = node.bounds.y
  let right = left + node.bounds.width,
    bottom = top + node.bounds.height
  const include = (bounds: DiagramDetailBounds) => {
    left = Math.min(left, bounds.x)
    top = Math.min(top, bounds.y)
    right = Math.max(right, bounds.x + bounds.width)
    bottom = Math.max(bottom, bounds.y + bounds.height)
  }
  // Symbols use a centre anchor; right/centred labels can extend left of x.
  if (node.visual?.type === 'symbol' || node.visual?.type === 'label') {
    include({
      x: node.bounds.x - node.bounds.width,
      y: node.bounds.y - node.bounds.height,
      width: node.bounds.width,
      height: node.bounds.height,
    })
  }
  for (const child of node.children) include(diagramDetailBounds(child))
  const callout = node.visual?.type === 'symbol' ? node.visual.metadataCallout : undefined
  if (callout) {
    include({
      x: node.bounds.x + callout.x,
      y: node.bounds.y + callout.y,
      width: callout.width,
      height: callout.height,
    })
    for (const points of callout.leaderSegments ?? [callout.leaderPoints]) {
      for (let i = 0; i < points.length; i += 2)
        include({
          x: node.bounds.x + points[i]!,
          y: node.bounds.y + points[i + 1]!,
          width: 0,
          height: 0,
        })
    }
  }
  const bounds = { x: left, y: top, width: right - left, height: bottom - top }
  boundsCache.set(node, bounds)
  return bounds
}
