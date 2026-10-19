/** Keep the routed corridor fixed while the module's terminal lead follows a drag. */
export function moveRelationWireEndpoint(
  points: number[], endpoint: 'source' | 'target', dx: number, dy: number,
): number[] {
  if ((!dx && !dy) || points.length < 4) return points
  const source: Array<{ x: number; y: number }> = []
  for (let index = 0; index + 1 < points.length; index += 2) {
    source.push({ x: points[index]!, y: points[index + 1]! })
  }
  if (endpoint === 'target') source.reverse()
  const first = source[0]!
  const second = source[1]!
  const horizontal = Math.abs(second.y - first.y) < 0.001
  const moved = { x: first.x + dx, y: first.y + dy }
  const lead = source.length > 2
    ? { x: second.x + dx, y: second.y + dy }
    : { x: moved.x + (horizontal ? Math.sign(second.x - first.x) * 8 : 0),
      y: moved.y + (horizontal ? 0 : Math.sign(second.y - first.y) * 8) }
  const fixed = source[source.length > 2 ? 2 : 1]!
  const corner = horizontal ? { x: lead.x, y: fixed.y } : { x: fixed.x, y: lead.y }
  const result: typeof source = []
  for (const point of [moved, lead, corner, ...source.slice(source.length > 2 ? 2 : 1)]) {
    const previous = result.at(-1)
    if (previous && previous.x === point.x && previous.y === point.y) continue
    result.push(point)
    while (result.length >= 3) {
      const [a, b, c] = result.slice(-3) as [typeof point, typeof point, typeof point]
      const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
      if (!collinear) break
      result.splice(result.length - 2, 1)
    }
  }
  if (endpoint === 'target') result.reverse()
  return result.flatMap(({ x, y }) => [x, y])
}
