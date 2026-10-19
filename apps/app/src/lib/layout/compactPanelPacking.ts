export const COMPACT_PANEL_THRESHOLD = 8

type Size = { width: number; height: number }
export type PackedPanelGroup = Size & {
  positions: Array<{ x: number; y: number; row: number }>
  /** A clear vertical corridor between columns (or outside a single column). */
  trunkX: number
  compact: boolean
}

/** Stable row-major packing of whole subtrees; never splits a board from its descendants. */
export function packPanelGroup(
  sizes: Size[],
  gapX: number,
  gapY: number,
  threshold = COMPACT_PANEL_THRESHOLD
): PackedPanelGroup {
  if (!sizes.length) return { width: 0, height: 0, positions: [], trunkX: 0, compact: false }
  const compact = sizes.length >= threshold
  const candidate = (columns: number): PackedPanelGroup => {
    const rows = Math.ceil(sizes.length / columns)
    const gutter = compact && columns === 1 ? gapX : 0
    const widths: number[] = Array(columns).fill(0)
    const heights: number[] = Array(rows).fill(0)
    sizes.forEach((size, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      widths[column] = Math.max(widths[column]!, size.width)
      heights[row] = Math.max(heights[row]!, size.height)
    })
    const offsets = (extents: number[], gap: number, start = 0) => {
      let cursor = start
      return extents.map((extent) => {
        const position = cursor
        cursor += extent + gap
        return position
      })
    }
    const xs = offsets(widths, gapX, gutter)
    const ys = offsets(heights, gapY)
    const middleColumn = Math.ceil(columns / 2)
    return {
      width: gutter + widths.reduce((a, b) => a + b, 0) + (columns - 1) * gapX,
      height: heights.reduce((a, b) => a + b, 0) + (rows - 1) * gapY,
      positions: sizes.map((size, index) => ({
        x: xs[index % columns]! + (widths[index % columns]! - size.width) / 2,
        y: ys[Math.floor(index / columns)]!,
        row: Math.floor(index / columns),
      })),
      trunkX: columns > 1 ? xs[middleColumn]! - gapX / 2 : gutter / 2,
      compact,
    }
  }
  if (!compact) return candidate(sizes.length)
  let best = candidate(1)
  const score = (group: Size) =>
    Math.max(group.width, group.height) ** 2 + group.width * group.height * 0.15
  for (let columns = 2; columns <= sizes.length; columns++) {
    const group = candidate(columns)
    if (score(group) < score(best)) best = group
  }
  return best
}
