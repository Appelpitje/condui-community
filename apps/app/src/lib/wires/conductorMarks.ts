import type {
  CableSpec,
  Circuit,
  ElectricalDomain,
  Installation,
  Panel,
} from '@/types/schema'
import type { WireConductorMarks } from '@/types/wireSegmentDerived'
import { getEffectiveCircuitPhaseState, getInstallationPhases } from './phaseAssignment'

/**
 * Conductor tick marks drawn across a wire (IEC 60617 S00002/S00003, S00446 neutral,
 * S00447 protective earth). Counts follow the cable's conductors: its `G` earth core is the
 * PE mark, and one other core is the neutral when the circuit's phase shape has N. `active`
 * covers phase, switched, signal and DC cores, all drawn as plain oblique strokes.
 */
export type ConductorMarks = WireConductorMarks

export type ConductorMarkGlyph =
  | { kind: 'active'; count: number }
  | { kind: 'neutral' }
  | { kind: 'pe' }

/** More marks than this collapse the plain strokes into one stroke with a count (S00003). */
export const MAX_SEPARATE_CONDUCTOR_MARKS = 4

export function deriveConductorMarks(
  cable: Pick<CableSpec, 'conductors' | 'hasPE'>,
  options: { neutral: boolean; conductorRole?: 'active' | 'PE' }
): ConductorMarks | undefined {
  const total = Math.max(0, Math.floor(cable.conductors || 0))
  if (total === 0) return undefined
  const pe = cable.hasPE ? 1 : 0
  const cores = total - pe
  const neutral = options.neutral && cores >= 2 ? 1 : 0
  // A separately drawn PE leg carries only the earth core; its active leg carries the rest.
  if (options.conductorRole === 'PE') return pe ? { active: 0, neutral: 0, pe: 1 } : undefined
  if (options.conductorRole === 'active')
    return cores > 0 ? { active: cores - neutral, neutral, pe: 0 } : undefined
  return { active: cores - neutral, neutral, pe }
}

/** Separate strokes up to {@link MAX_SEPARATE_CONDUCTOR_MARKS}; `compact` always groups plain strokes. */
export function conductorMarkGlyphs(marks: ConductorMarks, compact = false): ConductorMarkGlyph[] {
  const total = marks.active + marks.neutral + marks.pe
  const group = compact || total > MAX_SEPARATE_CONDUCTOR_MARKS
  const glyphs: ConductorMarkGlyph[] =
    group && marks.active > 1
      ? [{ kind: 'active', count: marks.active }]
      : Array.from({ length: marks.active }, () => ({ kind: 'active' as const, count: 1 }))
  if (marks.neutral) glyphs.push({ kind: 'neutral' })
  if (marks.pe) glyphs.push({ kind: 'pe' })
  return glyphs
}

export function circuitIdFromWireAnchor(anchor: string | undefined): string | undefined {
  return anchor ? /^circuit:([^:]+):/.exec(anchor)?.[1] : undefined
}

function findCircuit(panels: readonly Panel[], circuitId: string): Circuit | undefined {
  for (const panel of panels) {
    const circuit =
      panel.circuits.find((candidate) => candidate.id === circuitId) ??
      panel.protections
        .flatMap((protection) => protection.circuits ?? [])
        .find((candidate) => candidate.id === circuitId) ??
      findCircuit(panel.subPanels ?? [], circuitId)
    if (circuit) return circuit
  }
  return undefined
}

/**
 * Whether the wire's phase shape includes a neutral: the circuit's effective phase selection
 * when it has one (L1+N, L1+L2+L3, ...), otherwise the installation voltage system
 * (3N~ and 1N~ carry N; 3~ and 2~ do not).
 */
export function resolveNeutralPresent({
  domain,
  circuitId,
  panels,
  installation,
}: {
  domain?: ElectricalDomain
  circuitId?: string
  panels: readonly Panel[]
  installation?: Installation
}): boolean {
  if (domain === 'DC') return false
  const system = installation?.nominalVoltage?.system
  const circuit = circuitId ? findCircuit(panels, circuitId) : undefined
  const assignment = circuit
    ? getEffectiveCircuitPhaseState(circuit, [...panels], system, installation).assignment
    : undefined
  if (assignment && assignment.kind !== 'inherit' && assignment.kind !== 'dc' && assignment.phases.length)
    return assignment.phases.includes('N')
  return getInstallationPhases(system).includes('N')
}

export function resolveConductorMarks(input: {
  cable: Pick<CableSpec, 'conductors' | 'hasPE'>
  domain?: ElectricalDomain
  circuitId?: string
  panels: readonly Panel[]
  installation?: Installation
  conductorRole?: 'active' | 'PE'
}): ConductorMarks | undefined {
  return deriveConductorMarks(input.cable, {
    neutral: resolveNeutralPresent(input),
    conductorRole: input.conductorRole,
  })
}

export const CONDUCTOR_MARK_SPACING = 4.5
/** Clearance kept between a mark group and the ends of the wire piece it sits on. */
export const CONDUCTOR_MARK_END_MARGIN = 7
const SLASH_HALF_DX = 2.2
const SLASH_HALF_DY = 4
const FLAG_HALF_LENGTH = 2.6
const COUNT_FONT_SIZE = 7
const COUNT_CHAR_WIDTH = 4.2

export interface ConductorMarkShapes {
  lines: number[][]
  dots: Array<{ x: number; y: number; radius: number }>
  /**
   * Counts, anchored just beyond a stroke's upper (−y) end. Renderers draw the text upright and
   * extend its box away from the wire from that anchor, so it never covers a stroke.
   */
  texts: Array<{ x: number; y: number; text: string; fontSize: number; width: number }>
  /** Extent along the wire, centred on 0. */
  length: number
}

/**
 * Shapes in a wire-local frame: the wire runs along +x through the origin, strokes lean
 * like `/`. The neutral dot and earth bar sit on the stroke's +y end (the wire's bottom:
 * below a horizontal wire, right of a vertical one drawn at −90°); counts sit on the −y end.
 */
export function conductorMarkShapes(
  glyphs: readonly ConductorMarkGlyph[],
  spacing = CONDUCTOR_MARK_SPACING
): ConductorMarkShapes {
  const lines: number[][] = []
  const dots: ConductorMarkShapes['dots'] = []
  const texts: ConductorMarkShapes['texts'] = []
  // A counted stroke gets extra room so its upright count clears the next stroke.
  const gaps = glyphs.slice(1).map((_, index) => {
    const previous = glyphs[index]!
    return spacing + (previous.kind === 'active' && previous.count > 1 ? 3 : 0)
  })
  const strokesSpan = gaps.reduce((sum, gap) => sum + gap, 0)
  const slashLength = Math.hypot(SLASH_HALF_DX, SLASH_HALF_DY)
  // Unit vector perpendicular to the stroke, for the earth bar.
  const barX = SLASH_HALF_DY / slashLength
  const barY = SLASH_HALF_DX / slashLength
  let x = -strokesSpan / 2
  let countOverhang = 0
  glyphs.forEach((glyph, index) => {
    if (index > 0) x += gaps[index - 1]!
    const endX = x + SLASH_HALF_DX
    const endY = -SLASH_HALF_DY
    const flagX = x - SLASH_HALF_DX
    const flagY = SLASH_HALF_DY
    lines.push([flagX, flagY, endX, endY])
    if (glyph.kind === 'neutral') dots.push({ x: flagX, y: flagY, radius: 1.3 })
    if (glyph.kind === 'pe')
      lines.push([
        flagX - barX * FLAG_HALF_LENGTH,
        flagY - barY * FLAG_HALF_LENGTH,
        flagX + barX * FLAG_HALF_LENGTH,
        flagY + barY * FLAG_HALF_LENGTH,
      ])
    if (glyph.kind === 'active' && glyph.count > 1) {
      const text = String(glyph.count)
      const width = text.length * COUNT_CHAR_WIDTH
      texts.push({ x: endX, y: endY - 1.5, text, fontSize: COUNT_FONT_SIZE, width })
      // Upright text spans up to its width (horizontal wire) or height (vertical wire) along it.
      countOverhang = Math.max(countOverhang, Math.max(width, COUNT_FONT_SIZE) / 2 - SLASH_HALF_DX)
    }
  })
  return { lines, dots, texts, length: strokesSpan + 2 * (SLASH_HALF_DX + Math.max(0, countOverhang)) }
}

/**
 * Centre for a mark group of `length` inside `[min, max]` that clears every obstacle
 * interval, as close to `preferred` as possible. Undefined when no free gap fits.
 */
export function placeAlongAxis({
  min,
  max,
  length,
  obstacles,
  preferred,
}: {
  min: number
  max: number
  length: number
  obstacles: ReadonlyArray<readonly [number, number]>
  preferred: number
}): number | undefined {
  const blocked = obstacles
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const)
    .filter(([a, b]) => b > min && a < max)
    .sort((left, right) => left[0] - right[0])
  const gaps: Array<[number, number]> = []
  let cursor = min
  for (const [a, b] of blocked) {
    if (a > cursor) gaps.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  if (cursor < max) gaps.push([cursor, max])
  let best: number | undefined
  for (const [low, high] of gaps) {
    if (high - low < length) continue
    const centre = Math.min(Math.max(preferred, low + length / 2), high - length / 2)
    if (best === undefined || Math.abs(centre - preferred) < Math.abs(best - preferred)) best = centre
  }
  return best
}

/**
 * Straight wire a cable needs to show its marks with end clearance. Assumes a neutral so the
 * reserve covers either phase shape; the N mark is as long as a plain stroke.
 */
export function conductorMarkWireLength(cable: Pick<CableSpec, 'conductors' | 'hasPE'>): number {
  const marks = deriveConductorMarks(cable, { neutral: true })
  if (!marks) return 0
  return conductorMarkShapes(conductorMarkGlyphs(marks)).length + 2 + 2 * CONDUCTOR_MARK_END_MARGIN
}

/** Place the full mark group, or its compact form when only that fits. */
export function layoutConductorMarks(
  marks: ConductorMarks,
  axis: { min: number; max: number; obstacles: ReadonlyArray<readonly [number, number]>; preferred: number }
): { centre: number; shapes: ConductorMarkShapes } | undefined {
  for (const compact of [false, true]) {
    const shapes = conductorMarkShapes(conductorMarkGlyphs(marks, compact))
    const centre = placeAlongAxis({ ...axis, length: shapes.length + 2 })
    if (centre !== undefined) return { centre, shapes }
  }
  return undefined
}

/** The marks one drawn leg carries when a cable's earth core is drawn as its own leg. */
export function conductorMarksForRole(
  marks: ConductorMarks,
  role: 'active' | 'PE' | undefined
): ConductorMarks | undefined {
  if (role === 'PE') return marks.pe ? { active: 0, neutral: 0, pe: 1 } : undefined
  if (role === 'active') return marks.active + marks.neutral ? { ...marks, pe: 0 } : undefined
  return marks
}

/**
 * Marks on a routed `[x0, y0, x1, y1, …]` connection: on a straight leg, clear of ports, bends
 * and a caption of `captionWidth` at the polyline midpoint, as close to that midpoint as fits.
 */
export function layoutPolylineConductorMarks(
  points: readonly number[],
  marks: ConductorMarks,
  captionWidth = 0
): { x: number; y: number; rotation: number; shapes: ConductorMarkShapes } | undefined {
  const legs: Array<{ x0: number; y0: number; dx: number; dy: number; length: number; start: number }> = []
  let total = 0
  for (let index = 2; index + 1 < points.length; index += 2) {
    const x0 = points[index - 2]!
    const y0 = points[index - 1]!
    const dx = points[index]! - x0
    const dy = points[index + 1]! - y0
    const length = Math.hypot(dx, dy)
    if (length > 0) legs.push({ x0, y0, dx, dy, length, start: total })
    total += length
  }
  const middle = total / 2
  const obstacles: Array<[number, number]> = captionWidth > 0
    ? [[middle - captionWidth - 8, middle + captionWidth + 8]]
    : []
  let best: { leg: (typeof legs)[number]; centre: number; shapes: ConductorMarkShapes } | undefined
  for (const leg of legs) {
    const startMargin = leg.start === 0 ? 12 : 6
    const endMargin = leg.start + leg.length >= total - 1e-6 ? 12 : 6
    const placed = layoutConductorMarks(marks, {
      min: leg.start + startMargin,
      max: leg.start + leg.length - endMargin,
      obstacles,
      preferred: middle,
    })
    if (placed && (!best || Math.abs(placed.centre - middle) < Math.abs(best.centre - middle)))
      best = { leg, ...placed }
  }
  if (!best) return undefined
  const { leg, centre, shapes } = best
  const t = (centre - leg.start) / leg.length
  let rotation = (Math.atan2(leg.dy, leg.dx) * 180) / Math.PI
  // Keep strokes leaning the same way whichever direction the leg was routed.
  // [−90, 90): vertical legs read at −90° like one-wire, so the flags sit on their right.
  if (rotation >= 90) rotation -= 180
  else if (rotation < -90) rotation += 180
  return { x: leg.x0 + leg.dx * t, y: leg.y0 + leg.dy * t, rotation, shapes }
}
