import type Konva from 'konva'

type Release = () => void
type Acquire = () => Promise<Release>

const materializers = new WeakMap<Konva.Group, Acquire>()

/** Let virtualized live groups briefly mount their complete artwork for export. */
export function registerCanvasGroupMaterialization(group: Konva.Group, acquire: Acquire): Release {
  materializers.set(group, acquire)
  return () => {
    if (materializers.get(group) === acquire) materializers.delete(group)
  }
}

export async function acquireCanvasGroupMaterialization(group: Konva.Group): Promise<Release> {
  return materializers.get(group)?.() ?? (() => {})
}

/** Materialize independent virtualized layers beneath a complete canvas root. */
export async function acquireCanvasDescendantsMaterialization(root: Konva.Group): Promise<Release> {
  const releases: Release[] = []
  let released = false
  const release = () => {
    if (released) return
    released = true
    for (const cleanup of releases.reverse()) cleanup()
  }
  try {
    for (const group of [root, ...root.find<Konva.Group>('Group')]) {
      const acquire = materializers.get(group)
      if (acquire) releases.push(await acquire())
    }
    return release
  } catch (error) {
    release()
    throw error
  }
}
