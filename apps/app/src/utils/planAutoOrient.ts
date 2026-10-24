/**
 * Auto-orientation for symbols on the Situation Plan (e.g. sockets).
 *
 * Primary signal:
 * - Vector walls drawn in floor plan mode (plan walls) – preferred when available.
 *
 * Secondary signal:
 * - Floor plan image under the placement – used as a fallback and to support
 *   legacy/imported plans without drawn walls.
 *
 * Drawn walls use the nearest segment normal for exact alignment. Raster plans
 * use quadrant wedges (45° slice from center to each side) as a forgiving
 * fallback because their wall geometry is not available.
 */

import type { Placement, Rotation, SituationPlanRotation, Wall } from '@/types/schema'
import { clamp } from '@/lib/geometry'
import { MULTI_SOCKET_OFFSET, SYMBOL_SIZE } from '@/lib/canvas/symbolGeometry'
import {
  getClosestPointOnCurvedWall,
  getWallPathPoints,
  isCurvedWall,
} from '@/lib/plan/wallCurve'

const SYMBOL_BASE_SIZE = 40
const OPACITY_THRESHOLD = 128
/** Minimum score to accept a wall direction for vector walls (lower = more forgiving). */
const MIN_QUADRANT_SCORE_WALLS = 0.07
/**
 * Raster floor plans are noisy; require a stronger signal and a clear winner so
 * dragging across photo texture does not flip orientation every few pixels.
 */
const MIN_QUADRANT_SCORE_IMAGE = 0.14
/** Best quadrant must beat the runner-up by at least this (image path only). */
const MIN_IMAGE_SCORE_MARGIN = 0.07
/** How far to look for vector walls, in symbol-radius multiples (larger = more margin). */
const WALL_SEARCH_RADIUS_FACTOR = 4.5

type NearestDrawnWall = {
  distance: number
  point: { x: number; y: number }
  tangent: { x: number; y: number }
}

function nearestDrawnWall(placement: Placement, walls: Wall[]): NearestDrawnWall | null {
  let nearest: NearestDrawnWall | null = null
  for (const wall of walls) {
    if (isCurvedWall(wall)) {
      const closest = getClosestPointOnCurvedWall(wall, placement.pos)
      if (closest && (!nearest || closest.distance < nearest.distance)) {
        nearest = {
          distance: closest.distance,
          point: closest.point,
          tangent: closest.tangent,
        }
      }
      continue
    }

    const points = wall.points
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index]!
      const end = points[index + 1]!
      const vx = end.x - start.x
      const vy = end.y - start.y
      const lengthSquared = vx * vx + vy * vy
      if (lengthSquared < 1e-6) continue
      const t = clamp(
        ((placement.pos.x - start.x) * vx + (placement.pos.y - start.y) * vy) / lengthSquared,
        0,
        1
      )
      const distance = Math.hypot(
        start.x + t * vx - placement.pos.x,
        start.y + t * vy - placement.pos.y
      )
      if (!nearest || distance < nearest.distance) {
        nearest = {
          distance,
          point: {
            x: start.x + t * vx,
            y: start.y + t * vy,
          },
          tangent: { x: vx, y: vy },
        }
      }
    }
  }
  return nearest
}

function rotationFromWallNormal(
  placement: Placement,
  point: { x: number; y: number },
  tangent: { x: number; y: number },
  distance: number,
  wallFacingSide: WallFacingSide,
  symbolBaseSizePx: number,
  socketCount: number
): SituationPlanRotation | null {
  const symbolRadius = (symbolBaseSizePx / 2) * placement.scale
  const symbolSize = symbolBaseSizePx * placement.scale
  const socketOffset = MULTI_SOCKET_OFFSET * (symbolSize / SYMBOL_SIZE)
  const socketExtraWidth = Math.max(0, socketCount - 1) * socketOffset
  if (distance > 2 * symbolRadius + socketExtraWidth || distance < 1e-3) return null

  const tangentLength = Math.hypot(tangent.x, tangent.y)
  if (tangentLength < 1e-6) return null
  const unitTangent = {
    x: tangent.x / tangentLength,
    y: tangent.y / tangentLength,
  }
  const normalA = { x: -unitTangent.y, y: unitTangent.x }
  const towardWall = {
    x: point.x - placement.pos.x,
    y: point.y - placement.pos.y,
  }
  const normal = normalA.x * towardWall.x + normalA.y * towardWall.y >= 0
    ? normalA
    : { x: -normalA.x, y: -normalA.y }

  // At rotation 0, sockets face left, wall lights right and distribution panels down.
  const baseFacingAngle = wallFacingSide === 'left' ? 180 : wallFacingSide === 'right' ? 0 : 90
  const normalAngle = Math.atan2(normal.y, normal.x) * 180 / Math.PI
  const normalized = ((normalAngle - baseFacingAngle) % 360 + 360) % 360
  return Math.round(normalized * 1e6) / 1e6
}

/** Context for image-based wall detection (legacy plan image). */
export interface PlanImageContext {
  image: HTMLImageElement
  /** Position of the plan image in plan/stage coordinates */
  imagePosition: { x: number; y: number }
}

/**
 * Returns true if (px, py) in image coords is inside the top quadrant (90° wedge
 * from center upward to the top two corners of the symbol rect).
 */
function inTopQuadrant(px: number, py: number, cx: number, cy: number, half: number): boolean {
  if (py > cy || py < cy - half) return false
  return Math.abs(px - cx) <= cy - py
}

function inBottomQuadrant(px: number, py: number, cx: number, cy: number, half: number): boolean {
  if (py < cy || py > cy + half) return false
  return Math.abs(px - cx) <= py - cy
}

function inLeftQuadrant(px: number, py: number, cx: number, cy: number, half: number): boolean {
  if (px > cx || px < cx - half) return false
  return Math.abs(py - cy) <= cx - px
}

function inRightQuadrant(px: number, py: number, cx: number, cy: number, half: number): boolean {
  if (px < cx || px > cx + half) return false
  return Math.abs(py - cy) <= px - cx
}

/**
 * Score a quadrant: density of opaque pixels and preference for a "line" (wall)
 * along the relevant axis. Returns a value in [0, 1].
 * Only scans the bounding rect (x0..x1, y0..y1) for efficiency.
 */
function scoreQuadrant(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  inQuadrant: (px: number, py: number) => boolean,
  lineAxis: 'row' | 'col',
  /** Subsample step ≥1; reduces sensitivity to fine-grained photo noise. */
  stride: number
): number {
  let total = 0
  let opaque = 0
  const lineCounts: Map<number, number> = new Map()

  for (let py = y0; py < y1; py += stride) {
    for (let px = x0; px < x1; px += stride) {
      if (!inQuadrant(px, py)) continue
      total++
      const i = (py * w + px) * 4
      if ((data[i + 3] ?? 0) >= OPACITY_THRESHOLD) {
        opaque++
        const key = lineAxis === 'row' ? py : px
        lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1)
      }
    }
  }

  if (total === 0) return 0
  const density = opaque / total

  let lineStrength = 0
  if (lineCounts.size > 0) {
    const axisSize = lineAxis === 'row' ? x1 - x0 : y1 - y0
    const axisSamples = axisSize > 0 ? Math.max(1, Math.ceil(axisSize / stride)) : 1
    let maxLineRatio = 0
    for (const count of lineCounts.values()) {
      maxLineRatio = Math.max(maxLineRatio, count / axisSamples)
    }
    lineStrength = Math.min(1, maxLineRatio)
  }

  return density * (0.6 + 0.4 * lineStrength)
}

export type QuadrantScores = { top: number; right: number; bottom: number; left: number }

/**
 * Returns wall scores for the four quadrants around a placement (same logic as
 * rotation suggestion). Used e.g. to place labels away from walls.
 * Returns null if placement is outside the image or canvas unavailable.
 */
/** Slightly expand the scan area for image-based wall detection (more forgiving). */
const IMAGE_QUADRANT_SIZE_FACTOR = 1.3

export function getQuadrantWallScores(
  placement: Placement,
  ctx: PlanImageContext,
  symbolBaseSizePx?: number
): QuadrantScores | null {
  const { image, imagePosition } = ctx
  const base = symbolBaseSizePx ?? SYMBOL_BASE_SIZE
  const halfSize = (base / 2) * placement.scale * IMAGE_QUADRANT_SIZE_FACTOR
  const centerX = placement.pos.x - imagePosition.x
  const centerY = placement.pos.y - imagePosition.y

  const left = Math.floor(centerX - halfSize)
  const right = Math.ceil(centerX + halfSize)
  const top = Math.floor(centerY - halfSize)
  const bottom = Math.ceil(centerY + halfSize)

  const w = image.width
  const h = image.height

  if (left >= w || right <= 0 || top >= h || bottom <= 0) {
    return null
  }

  const x0 = Math.max(0, left)
  const x1 = Math.min(w, right)
  const y0 = Math.max(0, top)
  const y1 = Math.min(h, bottom)

  // IMPORTANT: avoid reading the entire image per placement.
  // We reuse a single offscreen canvas for the plan image and only read the
  // small sub-rect around the placement.
  // (Canvas getImageData is a sync readback; doing full-frame readbacks is extremely slow.)
  const cache = (() => {
    type Cache = { image: HTMLImageElement | null; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
    type PlanImageCacheGlobal = typeof globalThis & {
      __EENDRA_PLAN_IMAGE_CACHE__?: Cache | null
    }
    const g = globalThis as PlanImageCacheGlobal
    const key = '__EENDRA_PLAN_IMAGE_CACHE__'
    let c: Cache | null = g[key] ?? null
    if (!c) {
      // Image analysis needs a DOM canvas; headless callers fall back to wall heuristics.
      if (typeof document === 'undefined') return null
      const canvas = document.createElement('canvas')
      const ctx2d = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx2d) return null
      c = { image: null, canvas, ctx: ctx2d }
      g[key] = c
    }
    return c
  })()
  if (!cache) return null

  if (cache.image !== image || cache.canvas.width !== w || cache.canvas.height !== h) {
    cache.image = image
    cache.canvas.width = w
    cache.canvas.height = h
    cache.ctx.clearRect(0, 0, w, h)
    cache.ctx.drawImage(image, 0, 0)
  }

  const rectW = x1 - x0
  const rectH = y1 - y0
  const imageData = cache.ctx.getImageData(x0, y0, rectW, rectH)
  const data = imageData.data

  // Convert to local coords inside the sub-rect.
  const cx = centerX - x0
  const cy = centerY - y0
  const half = halfSize

  const inTop = (px: number, py: number) => inTopQuadrant(px, py, cx, cy, half)
  const inBottom = (px: number, py: number) => inBottomQuadrant(px, py, cx, cy, half)
  const inLeft = (px: number, py: number) => inLeftQuadrant(px, py, cx, cy, half)
  const inRight = (px: number, py: number) => inRightQuadrant(px, py, cx, cy, half)

  const minDim = Math.min(rectW, rectH)
  const stride = Math.min(4, Math.max(1, Math.floor(minDim / 22)))

  return {
    top: scoreQuadrant(data, rectW, 0, 0, rectW, rectH, inTop, 'row', stride),
    bottom: scoreQuadrant(data, rectW, 0, 0, rectW, rectH, inBottom, 'row', stride),
    left: scoreQuadrant(data, rectW, 0, 0, rectW, rectH, inLeft, 'col', stride),
    right: scoreQuadrant(data, rectW, 0, 0, rectW, rectH, inRight, 'col', stride),
  }
}

/**
 * Vector-wall based quadrant scores around a placement.
 *
 * Evaluates the distance and direction from the placement to nearby wall
 * segments and accumulates scores per quadrant. Closer segments contribute
 * more, and the dominant axis (horizontal vs vertical) decides which side
 * (left/right vs top/bottom) gets the score.
 *
 * Returns null when there are no walls close enough to the placement.
 */
function getQuadrantWallScoresFromWalls(
  placement: Placement,
  walls: Wall[],
  symbolBaseSizePx?: number
): QuadrantScores | null {
  if (!placement.pos || walls.length === 0) return null

  const cx = placement.pos.x
  const cy = placement.pos.y
  const base = symbolBaseSizePx ?? SYMBOL_BASE_SIZE
  const searchRadius = base * placement.scale * WALL_SEARCH_RADIUS_FACTOR
  const scores = { top: 0, right: 0, bottom: 0, left: 0 }
  let hasAny = false
  let minDist = Infinity

  for (const wall of walls) {
    const pts = getWallPathPoints(wall)
    if (!pts || pts.length < 2) continue

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!
      const p2 = pts[i + 1]!
      const vx = p2.x - p1.x
      const vy = p2.y - p1.y
      const segLenSq = vx * vx + vy * vy
      if (segLenSq < 1e-6) continue

      // Closest point on segment to placement center
      const t = ((cx - p1.x) * vx + (cy - p1.y) * vy) / segLenSq
      const clampedT = clamp(t, 0, 1)
      const px = p1.x + clampedT * vx
      const py = p1.y + clampedT * vy

      const dx = px - cx
      const dy = py - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > searchRadius || dist < 1e-3) continue

      hasAny = true
      if (dist < minDist) minDist = dist
      // Softer falloff so symbols a bit further from the wall still get a clear direction
      const weight = 1 / (0.5 + dist)

      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx < 0) scores.left += weight
        else scores.right += weight
      } else {
        if (dy < 0) scores.top += weight
        else scores.bottom += weight
      }
    }
  }

  if (!hasAny) return null

  // If the closest wall is still farther than ~2× the symbol radius, treat
  // it as “no wall nearby” to avoid jittery flipping when dragging in open areas.
  const symbolRadius = (base / 2) * placement.scale
  if (minDist > 2 * symbolRadius) return null

  const maxScore = Math.max(scores.top, scores.right, scores.bottom, scores.left)
  if (maxScore <= 0) return null

  // Normalize so the best direction is 1.0; relative ratios are preserved.
  return {
    top: scores.top / maxScore,
    right: scores.right / maxScore,
    bottom: scores.bottom / maxScore,
    left: scores.left / maxScore,
  }
}

/**
 * Which side of the symbol faces the wall at rotation 0.
 * - 'left': sockets — at rotation 0 the left side (tail) is against the wall
 * - 'right': wall lights — the mounting line is on the right
 * - 'top':  distribution panels — at rotation 0 the bottom side is against the wall
 *          (symbol body opens away from the wall)
 */
export type WallFacingSide = 'left' | 'right' | 'top'

/**
 * Rotation mapping per wall-facing side.
 * Given a detected wall direction, returns the rotation that places `wallFacingSide` toward that wall.
 */
const ROTATION_MAP: Record<WallFacingSide, { top: Rotation; right: Rotation; bottom: Rotation; left: Rotation }> = {
  // Socket: original LEFT faces wall → left wall = 0°
  left: { left: 0 as Rotation, top: 90 as Rotation, right: 180 as Rotation, bottom: 270 as Rotation },
  right: { left: 180 as Rotation, top: 270 as Rotation, right: 0 as Rotation, bottom: 90 as Rotation },
  // Panel: bottom faces wall at 0° → top wall = 180°
  top:  { top: 180 as Rotation, right: 270 as Rotation, bottom: 0 as Rotation, left: 90 as Rotation },
}

type RotationPickOpts = {
  minQuadrantScore: number
  /** Require best − second ≥ this so near-ties on raster noise do not flip orientation. */
  minWinMargin: number
}

/**
 * Internal helper: pick a rotation from quadrant scores for the requested
 * wall-facing side, returning null when the best score is too weak or not
 * clearly ahead of the runner-up.
 */
function rotationFromScores(
  scores: QuadrantScores,
  wallFacingSide: WallFacingSide,
  pick?: RotationPickOpts
): Rotation | null {
  const minScore = pick?.minQuadrantScore ?? MIN_QUADRANT_SCORE_WALLS
  const winMargin = pick?.minWinMargin ?? 0

  const map = ROTATION_MAP[wallFacingSide]
  const sides = [
    { rotation: map.top,    score: scores.top },
    { rotation: map.bottom, score: scores.bottom },
    { rotation: map.left,   score: scores.left },
    { rotation: map.right,  score: scores.right },
  ]
  const sorted = [...sides].sort((a, b) => b.score - a.score)
  const best = sorted[0]!
  const second = sorted[1]!

  if (best.score < minScore) return null
  if (best.score - second.score < winMargin) return null

  return best.rotation
}

/**
 * Suggests rotation for a placement based on:
 * 1) Drawn vector walls (if any) around the placement, and
 * 2) The legacy floor plan image underneath as a fallback.
 *
 * When both sources provide conflicting directions, vector walls take precedence.
 *
 * @param wallFacingSide  Which side of the symbol faces the wall at rotation 0.
 *                        Defaults to 'left' (sockets).
 */
export function suggestRotationForPlacement(
  placement: Placement,
  ctx: {
    image?: HTMLImageElement | null
    imagePosition?: { x: number; y: number }
    walls?: Wall[]
    /** Base symbol size (pre-placement.scale), in plan/stage pixels. */
    symbolBaseSizePx?: number
    /** Number of rendered socket copies; used to include their extra footprint in wall pickup. */
    socketCount?: number
  },
  wallFacingSide: WallFacingSide = 'left'
): SituationPlanRotation | null {
  const walls = ctx.walls ?? []
  const base = ctx.symbolBaseSizePx ?? SYMBOL_BASE_SIZE
  const socketCount = Math.max(1, ctx.socketCount ?? 1)

  // 1) Prefer vector walls when present
  if (walls.length > 0) {
    const nearest = nearestDrawnWall(placement, walls)
    if (nearest) {
      const wallRotation = rotationFromWallNormal(
        placement,
        nearest.point,
        nearest.tangent,
        nearest.distance,
        wallFacingSide,
        base,
        socketCount
      )
      if (wallRotation != null) return wallRotation
    }
    const wallScores = getQuadrantWallScoresFromWalls(placement, walls, base)
    if (wallScores) {
      const rotation = rotationFromScores(wallScores, wallFacingSide)
      if (rotation != null) return rotation
    }
  }

  // 2) Fall back to image-based detection when available
  if (ctx.image && ctx.imagePosition) {
    const imageScores = getQuadrantWallScores(placement, {
      image: ctx.image,
      imagePosition: ctx.imagePosition,
    }, base)
    if (imageScores) {
      const rotation = rotationFromScores(imageScores, wallFacingSide, {
        minQuadrantScore: MIN_QUADRANT_SCORE_IMAGE,
        minWinMargin: MIN_IMAGE_SCORE_MARGIN,
      })
      if (rotation != null) return rotation
    }
  }

  return null
}
