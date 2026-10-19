import type { WireSegment } from '@/types/schema'
import type { ChangeoverGridSourcePreview } from './changeoverGridSourcePreview'
import type { LayoutNode, LayoutTree } from './layoutTree'

export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What the canvas draws for a changeover grid-source hover preview.
 *
 * - `diff`: the supply devices keep their positions, so only the changed wires are drawn:
 *   `added` dashed, `removed` knocked out.
 * - `ghost`: the switch moves supply devices (the frame grows around the new T). Wire
 *   fragments over a drawing whose devices sit elsewhere read as noise, so the current supply
 *   drawing is dimmed under `dim` and the whole simulated supply drawing is shown as an
 *   outline: its wires and device boxes, with the changed wires emphasised.
 */
export interface ChangeoverGridSourcePreviewScene {
  mode: 'diff' | 'ghost'
  /** Wires drawn emphasised (dashed, attention colour). */
  added: WireSegment[]
  /** Current wires knocked out (diff mode only). */
  removed: WireSegment[]
  /** Simulated wires that did not change (ghost mode only, drawn faint). */
  context: WireSegment[]
  /** Simulated supply device boxes (ghost mode only). */
  devices: PreviewRect[]
  /** Region of the current drawing to dim (ghost mode only). */
  dim?: PreviewRect
  junctions: { x: number; y: number }[]
  /** Current T-junction dots the switch removes (diff mode only), knocked out like wires. */
  removedJunctions: { x: number; y: number }[]
}

/** Device movement (canvas units) beyond which the preview switches to the ghost outline. */
export const CHANGEOVER_PREVIEW_GHOST_SHIFT = 2

const diagramOf = (wire: WireSegment) => wire.diagramId ?? wire.panelId ?? ''

function collectTrunkDevices(tree: LayoutTree, diagrams: Set<string>): Map<string, LayoutNode> {
  const devices = new Map<string, LayoutNode>()
  const visit = (node: LayoutNode) => {
    if (node.type === 'trunkDevice' && node.domainId) devices.set(node.domainId, node)
    node.children?.forEach(visit)
  }
  tree.panels
    .filter((panel) => diagrams.has(panel.diagramId ?? panel.domainId ?? ''))
    .forEach(visit)
  return devices
}

const rectOf = (node: LayoutNode): PreviewRect => ({
  x: node.bounds.x - node.bounds.width / 2,
  y: node.bounds.y - node.bounds.height / 2,
  width: node.bounds.width,
  height: node.bounds.height,
})

function unionRect(rects: PreviewRect[], padding: number): PreviewRect | undefined {
  if (rects.length === 0) return undefined
  const left = Math.min(...rects.map((rect) => rect.x)) - padding
  const top = Math.min(...rects.map((rect) => rect.y)) - padding
  const right = Math.max(...rects.map((rect) => rect.x + rect.width)) + padding
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height)) + padding
  return { x: left, y: top, width: right - left, height: bottom - top }
}

const wireRect = (wire: WireSegment): PreviewRect => ({
  x: Math.min(wire.startPoint.x, wire.endPoint.x),
  y: Math.min(wire.startPoint.y, wire.endPoint.y),
  width: Math.abs(wire.endPoint.x - wire.startPoint.x),
  height: Math.abs(wire.endPoint.y - wire.startPoint.y),
})

/** Choose and build the canvas scene for a changeover grid-source preview. */
export function buildChangeoverGridSourcePreviewScene(
  preview: ChangeoverGridSourcePreview,
  current: { tree: LayoutTree | null; wires: readonly WireSegment[] },
  panelId: string
): ChangeoverGridSourcePreviewScene | null {
  const diff = preview.diff
  if (!diff || (diff.added.length === 0 && diff.removed.length === 0)) return null
  const isPanelSupply = (wire: WireSegment) =>
    wire.panelId === panelId && wire.isSupplyTrunk === true
  const currentSupply = current.wires.filter(isPanelSupply)
  const nextSupply = preview.geometry.wires.filter(isPanelSupply)
  const diagrams = new Set([...currentSupply, ...nextSupply].map(diagramOf))
  const currentDevices = current.tree
    ? collectTrunkDevices(current.tree, diagrams)
    : new Map<string, LayoutNode>()
  const nextDevices = collectTrunkDevices(preview.geometry.tree, diagrams)
  let shift = 0
  for (const [id, next] of nextDevices) {
    const before = currentDevices.get(id)
    if (!before) continue
    shift = Math.max(
      shift,
      Math.abs(before.bounds.x - next.bounds.x),
      Math.abs(before.bounds.y - next.bounds.y)
    )
  }
  const junctionsOf = (wires: readonly WireSegment[]) =>
    wires.flatMap((wire) => (wire.junctionPoint ? [wire.junctionPoint] : []))
  const pointKey = (point: { x: number; y: number }) =>
    `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`
  const without = (points: { x: number; y: number }[], others: { x: number; y: number }[]) => {
    const keys = new Set(others.map(pointKey))
    return points.filter((point) => !keys.has(pointKey(point)))
  }
  if (shift <= CHANGEOVER_PREVIEW_GHOST_SHIFT) {
    const currentJunctions = junctionsOf(currentSupply)
    const nextJunctions = junctionsOf(nextSupply)
    return {
      mode: 'diff',
      added: diff.added,
      removed: diff.removed,
      context: [],
      devices: [],
      junctions: without(nextJunctions, currentJunctions),
      removedJunctions: without(currentJunctions, nextJunctions),
    }
  }
  const added = new Set(diff.added)
  const deviceRects = [...nextDevices.values()].map(rectOf)
  return {
    mode: 'ghost',
    added: diff.added,
    removed: [],
    context: nextSupply.filter((wire) => !added.has(wire)),
    devices: deviceRects,
    dim: unionRect(
      [
        ...currentSupply.map(wireRect),
        ...[...currentDevices.values()].map(rectOf),
        ...nextSupply.map(wireRect),
        ...deviceRects,
      ],
      10
    ),
    junctions: junctionsOf(nextSupply),
    removedJunctions: [],
  }
}
