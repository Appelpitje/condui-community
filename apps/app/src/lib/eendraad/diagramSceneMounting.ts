import { getPanelDiagramId, type BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import type { WireSegment } from '@/types/schema'

export interface DiagramLogicalBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Complete logical geometry remains available even when its symbol components are unmounted. */
export function indexDiagramSceneMounting(
  panels: readonly BottomUpPanelLayout[],
  panelNodes: readonly LayoutNode[],
  wires: readonly WireSegment[]
) {
  const boundsByDiagramId = new Map<string, DiagramLogicalBounds>()
  const diagramIdsByEntityId = new Map<string, Set<string>>()
  const addEntity = (id: string | undefined, diagramId: string) => {
    if (!id) return
    let diagrams = diagramIdsByEntityId.get(id)
    if (!diagrams) diagramIdsByEntityId.set(id, (diagrams = new Set()))
    diagrams.add(diagramId)
  }
  const include = (diagramId: string, rectangle: DiagramLogicalBounds) => {
    if (![rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite))
      return
    const existing = boundsByDiagramId.get(diagramId)
    if (!existing) {
      boundsByDiagramId.set(diagramId, { ...rectangle })
      return
    }
    const right = Math.max(existing.x + existing.width, rectangle.x + rectangle.width)
    const bottom = Math.max(existing.y + existing.height, rectangle.y + rectangle.height)
    existing.x = Math.min(existing.x, rectangle.x)
    existing.y = Math.min(existing.y, rectangle.y)
    existing.width = right - existing.x
    existing.height = bottom - existing.y
  }
  for (const panel of panels) {
    const diagramId = getPanelDiagramId(panel)
    include(diagramId, panel.frame)
    addEntity(panel.panel.id, diagramId)
    for (const device of panel.supplyDevices ?? []) {
      const rect = device.metadataCalloutRect
      if (rect)
        include(diagramId, {
          x: rect.left,
          y: rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
        })
    }
  }
  for (const panelNode of panelNodes) {
    const diagramId = panelNode.diagramId ?? panelNode.domainId
    if (!diagramId) continue
    const visit = (node: LayoutNode) => {
      include(diagramId, node.bounds)
      const callout = node.visual?.type === 'symbol' ? node.visual.metadataCallout : undefined
      if (callout) {
        include(diagramId, {
          x: node.bounds.x + callout.x,
          y: node.bounds.y + callout.y,
          width: callout.width,
          height: callout.height,
        })
        for (const points of callout.leaderSegments ?? [callout.leaderPoints]) {
          for (let index = 0; index < points.length; index += 2) {
            include(diagramId, {
              x: node.bounds.x + points[index]!,
              y: node.bounds.y + points[index + 1]!,
              width: 0,
              height: 0,
            })
          }
        }
      }
      addEntity(node.domainId, diagramId)
      for (const child of node.children) visit(child)
    }
    visit(panelNode)
  }
  for (const wire of wires) {
    const diagramId = wire.diagramId ?? wire.panelId
    addEntity(wire.id, diagramId)
    addEntity(wire.wireAnchor, diagramId)
    for (const anchor of wire.wireAnchors ?? []) addEntity(anchor, diagramId)
    for (const point of [wire.startPoint, wire.endPoint, wire.phaseLabelAnchor]) {
      if (point) include(diagramId, { x: point.x, y: point.y, width: 0, height: 0 })
    }
  }
  return { boundsByDiagramId, diagramIdsByEntityId }
}
