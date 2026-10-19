import type Konva from 'konva'

export function resolveKonvaElementId(node: Konva.Node, stage: Konva.Stage): string | null {
  if (node === stage) return null
  const check = (name: string): string | null => {
    const prefixes = [
      'endpoint-',
      'protection-',
      'panel-',
      'trunkDevice-',
      'panelModule-',
      'supplyPanel-',
      'placement-',
      'note-',
      'frame-',
      'wire-',
      'oneWireReference-',
    ]
    for (const p of prefixes) {
      if (name.startsWith(p)) return name.slice(p.length)
    }
    return name === 'ground-ground' ? 'ground' : null
  }
  const id = check(node.name())
  if (id) return id
  let parent = node.getParent()
  let depth = 0
  while (parent && parent !== stage && depth < 10) {
    const parentId = check(parent.name())
    if (parentId) return parentId
    parent = parent.getParent()
    depth++
  }
  return null
}
