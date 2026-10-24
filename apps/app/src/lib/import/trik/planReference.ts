import { parseFigures } from '@/lib/import/trik/parse'
import { scaledPoint, sha256Hex, TRIK_TO_PLAN_SCALE } from '@/lib/import/trik/shared'
import type { Point2, TrikPlanAnchor, TrikPlanReferenceV1 } from '@/types/schema'

const WALL_SHAPE_PRECISION = 1000

function parseWallSegments(pageElement: Element): Array<[Point2, Point2]> {
  const point = (element: Element | null): Point2 | undefined => {
    const x = Number(element?.getAttribute('X'))
    const y = Number(element?.getAttribute('Y'))
    return element && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
  }
  const segments: Array<[Point2, Point2]> = []
  for (const wall of Array.from(pageElement.querySelectorAll('GrondplanElementen > Muur'))) {
    const p1 = point(wall.querySelector(':scope > P1'))
    const p2 = point(wall.querySelector(':scope > P2'))
    if (p1 && p2) segments.push([p1, p2])
  }
  return segments
}

/** The page's walls as one anchor: their outline box plus a hash of their shape inside it. */
async function wallAnchor(pageElement: Element): Promise<TrikPlanAnchor | undefined> {
  const segments = parseWallSegments(pageElement)
  if (segments.length < 3) return undefined
  const points = segments.flat()
  const minX = Math.min(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const width = Math.max(...points.map((p) => p.x)) - minX
  const height = Math.max(...points.map((p) => p.y)) - minY
  if (width <= 0 || height <= 0) return undefined
  const normalize = (p: Point2) =>
    `${Math.round(((p.x - minX) / width) * WALL_SHAPE_PRECISION)},${Math.round(((p.y - minY) / width) * WALL_SHAPE_PRECISION)}`
  const shape = segments
    .map(([a, b]) => [normalize(a), normalize(b)].sort().join('-'))
    .sort()
    .join(';')
  const hash = await sha256Hex(shape)
  if (!hash) return undefined
  return {
    key: `walls:${hash.slice(0, 32)}`,
    center: scaledPoint({ x: minX + width / 2, y: minY + height / 2 }),
    width: width * TRIK_TO_PLAN_SCALE,
    height: height * TRIK_TO_PLAN_SCALE,
    rotationDeg: 0,
  }
}

/**
 * What a TRiK page draws its plan with (background pictures and walls) and where, in plan
 * coordinates. A later TRiK file that draws the same plan, even moved or scaled, can be
 * recognised as the same floor and aligned with `findTrikPlanTransform`.
 */
export async function buildTrikPlanReference(pageElement: Element): Promise<TrikPlanReferenceV1 | undefined> {
  const anchors: TrikPlanAnchor[] = []
  for (const figure of parseFigures(pageElement)) {
    const hash = await sha256Hex(figure.imageAsBase64)
    if (!hash) continue
    anchors.push({
      key: `figure:${hash.slice(0, 32)}`,
      center: scaledPoint(figure.center),
      width: figure.width * TRIK_TO_PLAN_SCALE,
      height: figure.height * TRIK_TO_PLAN_SCALE,
      rotationDeg: figure.rotationDeg,
    })
  }
  const walls = await wallAnchor(pageElement)
  if (walls) anchors.push(walls)
  return anchors.length > 0 ? { version: 1, anchors } : undefined
}

/** Maps a point drawn on one page onto another page that draws the same plan. */
export type TrikPlanTransform = { scale: number; from: Point2; to: Point2 }

export function applyTrikPlanTransform(transform: TrikPlanTransform, point: Point2): Point2 {
  return {
    x: transform.to.x + (point.x - transform.from.x) * transform.scale,
    y: transform.to.y + (point.y - transform.from.y) * transform.scale,
  }
}

const isPicture = (anchor: TrikPlanAnchor) => anchor.key.startsWith('figure:')

/**
 * The transform from `source` onto `target` when both draw the same plan: a shared picture,
 * or else the same walls. Two pages with different pictures are different plans even when
 * their walls agree (floors of one house often share their outer walls).
 */
export function findTrikPlanTransform(
  source: TrikPlanReferenceV1 | undefined,
  target: TrikPlanReferenceV1 | undefined,
): TrikPlanTransform | undefined {
  if (!source || !target) return undefined
  const sourcePictures = source.anchors.filter(isPicture)
  const targetPictures = target.anchors.filter(isPicture)
  const sharesPicture = sourcePictures.some((anchor) => targetPictures.some((candidate) => candidate.key === anchor.key))
  const candidates =
    sharesPicture || sourcePictures.length === 0 || targetPictures.length === 0
      ? [...sourcePictures, ...source.anchors.filter((anchor) => !isPicture(anchor))]
      : []
  for (const anchor of candidates) {
    const match = target.anchors.find(
      (candidate) =>
        candidate.key === anchor.key && Math.abs(candidate.rotationDeg - anchor.rotationDeg) < 0.5,
    )
    if (!match || anchor.width <= 0 || anchor.height <= 0) continue
    const scale = match.width / anchor.width
    if (Math.abs(match.height / anchor.height - scale) > scale * 0.01) continue
    return { scale, from: anchor.center, to: match.center }
  }
  return undefined
}
