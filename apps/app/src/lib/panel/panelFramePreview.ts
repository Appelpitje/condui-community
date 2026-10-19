import type { PanelSceneSurface } from './panelScene'

type Frame = { x: number; y: number; width: number; height: number }

export function panelPreviewFrame(surface: PanelSceneSurface): Frame {
  return {
    x: surface.x,
    y: surface.y + (surface.kind === 'panel' ? surface.mainPanelY : 0),
    width: surface.width,
    height: surface.kind === 'panel' ? surface.panelFrameHeight : surface.height,
  }
}

function inside(frame: Frame, x: number, y: number): boolean {
  return x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height
}

/** Remove the part of a path between an enclosure's centre and its first frame exit. */
function trimFrameInterior(points: number[], frame: Frame): number[] {
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]!,
      y = points[i + 1]!
    if (inside(frame, x, y)) continue
    const previousX = points[i - 2]!,
      previousY = points[i - 1]!
    const borderX = x === previousX ? x : x < frame.x ? frame.x : frame.x + frame.width
    const borderY = y === previousY ? y : y < frame.y ? frame.y : frame.y + frame.height
    return [borderX, borderY, ...points.slice(i)]
  }
  return []
}

function reversePoints(points: number[]): number[] {
  const result: number[] = []
  for (let i = points.length - 2; i >= 0; i -= 2) result.push(points[i]!, points[i + 1]!)
  return result
}

/** Keep the overview's exterior corridors, terminating at the two cabinet frames. */
export function routePanelFramePreview(
  source: Frame,
  target: Frame,
  corridor?: number[]
): number[] {
  const sx = source.x + source.width / 2,
    sy = source.y + source.height / 2
  const tx = target.x + target.width / 2,
    ty = target.y + target.height / 2
  let points: number[]
  if (corridor && corridor.length >= 4) {
    points = [sx, sy, sx, corridor[1]!, ...corridor, corridor.at(-2)!, ty, tx, ty]
  } else if (source.y + source.height <= target.y || target.y + target.height <= source.y) {
    const fromY = ty > sy ? source.y + source.height : source.y
    const toY = ty > sy ? target.y : target.y + target.height
    const gapY = (fromY + toY) / 2
    points = [sx, sy, sx, gapY, tx, gapY, tx, ty]
  } else {
    const fromX = tx > sx ? source.x + source.width : source.x
    const toX = tx > sx ? target.x : target.x + target.width
    const gapX = (fromX + toX) / 2
    points = [sx, sy, gapX, sy, gapX, ty, tx, ty]
  }
  points = reversePoints(
    trimFrameInterior(reversePoints(trimFrameInterior(points, source)), target)
  )
  const result: number[] = []
  for (let i = 0; i < points.length; i += 2) {
    if (result.at(-2) !== points[i] || result.at(-1) !== points[i + 1])
      result.push(points[i]!, points[i + 1]!)
  }
  return result
}
