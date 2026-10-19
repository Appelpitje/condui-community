import Konva from 'konva'
import type { ExportScene } from '../types'

/** The caller owns a successful detached clone; temporary renderers never escape.
 * A failed preparation destroys its clone too, including registered Konva shapes. */
export async function prepareIsolatedExportScene(
  root: Konva.Group,
  prepare: (createStage: (width: number, height: number) => Konva.Stage) => ExportScene | Promise<ExportScene>,
): Promise<ExportScene> {
  const stages: Konva.Stage[] = []
  let prepared = false
  try {
    const scene = await prepare((width, height) => {
      const stage = new Konva.Stage({ container: document.createElement('div'), width, height })
      stages.push(stage)
      return stage
    })
    root.remove()
    prepared = true
    return scene
  } finally {
    if (!prepared) root.destroy()
    for (const stage of stages) stage.destroy()
  }
}
