import type { WireSegment } from '@/types/schema'
import { isRouteIndicatorVisibleForSegment, isSupplyWireSegmentForLabel } from '@/lib/wireLabelVisibility'
import {
  computeVerticalWireLabelStackLayout,
  getSupplyWireLabelAnchor,
  measureTextWidth,
  WIRE_LABEL_FONT_SIZE,
} from '@/lib/wireTextLabel'
import {
  CONDUCTOR_MARK_END_MARGIN,
  conductorMarkGlyphs,
  conductorMarkShapes,
  layoutConductorMarks,
  type ConductorMarks,
  type ConductorMarkShapes,
} from './conductorMarks'
import {
  getVerticalRouteIndicatorEndY,
  getVerticalWallRouteSymbolOffsets,
  WALL_ROUTE_SYMBOL_MARGIN,
} from './wireRouteIndicatorGeometry'

/** Clearance from wire ends (junction dots, device symbols) and from neighbouring decorations. */
const END_MARGIN = CONDUCTOR_MARK_END_MARGIN
const DECORATION_GAP = 3
/** A pushed label may run closer to the run ends than the marks, which cross the wire. */
const LABEL_END_MARGIN = 2
/** Smallest clearance from the run ends, used only when nothing else fits. */
const CRAMPED_END_MARGIN = 3
/** Wall-symbol distances from the run ends tried on a cramped run, nearest the default first. */
const CRAMPED_WALL_MARGINS = [WALL_ROUTE_SYMBOL_MARGIN, 7.5, 5.5]
/** Half length of a drawn wall symbol along the wire (6 × its 0.75 scale). */
const WALL_SYMBOL_HALF = 4.5
const CRAMPED_GAP = 1.5
/** Search step along the wire when the label has to move. */
const PUSH_STEP = 0.5

export interface OneWireConductorMarkDecorations {
  /** Cable text drawn beside this piece, exactly as the wire label renders it. */
  cableLabel?: {
    mainText: string
    fireClassText?: string
    wireLengthText?: string
    labelEndPoint: WireSegment['endPoint']
    fontFamily: string
    distanceFromWire: number
    offsetAlongWire: number
  }
  /** Route/tube glyphs drawn on a vertical circuit wire. */
  verticalRoute?: 'inWall' | 'onWall' | 'ground' | 'air'
  verticalTube?: boolean
  /** Route/tube glyphs drawn around a supply wire's label anchor. */
  supplyRouteGlyphs?: boolean
  /** Along-wire position of a phase caption beside this piece. */
  phaseLabelAt?: number
}

export interface OneWireConductorMarkLayout {
  x: number
  y: number
  rotation: number
  shapes: ConductorMarkShapes
  /**
   * How far the cable label moves along the wire to make room for the marks; the canvas
   * label and the export overlay add it to the label's own offset.
   */
  labelShift: number
  /** Distance of the wall-route symbols from the run ends, when the marks pulled them in. */
  wallSymbolMargin?: number
}

/**
 * Where a one-wire piece draws its conductor marks: within its first physical run, clear of
 * the cable label and route symbols, as close to the cable label as space allows. When the
 * run is too short beside the label, the label moves along the wire to make room; the marks
 * are never dropped.
 */
export function layoutOneWireConductorMarks(
  segment: WireSegment,
  decorations: OneWireConductorMarkDecorations
): OneWireConductorMarkLayout | undefined {
  const marks = segment.conductorMarks
  if (!marks || segment.type === 'mainBus' || segment.type === 'secondaryBus') return undefined
  const vertical = segment.startPoint.x === segment.endPoint.x
  const horizontal = segment.startPoint.y === segment.endPoint.y
  if (vertical === horizontal) return undefined

  const startAlong = vertical ? segment.startPoint.y : segment.startPoint.x
  const endAlong = vertical ? getVerticalRouteIndicatorEndY(segment) : segment.endPoint.x
  const min = Math.min(startAlong, endAlong) + END_MARGIN
  const max = Math.max(startAlong, endAlong) - END_MARGIN
  const at = (
    centre: number,
    shapes: ConductorMarkShapes,
    labelShift = 0,
    wallSymbolMargin?: number
  ): OneWireConductorMarkLayout => ({
    ...(vertical
      ? { x: segment.startPoint.x, y: centre, rotation: -90 }
      : { x: centre, y: segment.startPoint.y, rotation: 0 }),
    shapes,
    labelShift,
    ...(wallSymbolMargin !== undefined ? { wallSymbolMargin } : {}),
  })

  const label = cableLabelSpan(segment, decorations, vertical)
  // Route glyphs stay put while the label may move. The export overlay does not know the
  // phase caption, so the label shift never depends on it.
  const { fixed, forLabel } = routeObstacles(segment, decorations, vertical)
  const phase =
    decorations.phaseLabelAt !== undefined ? [padded(decorations.phaseLabelAt + 4, 6)] : []
  const preferred = label?.centre ?? (min + max) / 2

  const labelBlock = label ? [padded(label.centre, label.halfLength)] : []
  const beside =
    layoutConductorMarks(marks, { min, max, obstacles: [...fixed, ...phase, ...labelBlock], preferred }) ??
    (phase.length
      ? layoutConductorMarks(marks, { min, max, obstacles: [...fixed, ...labelBlock], preferred })
      : undefined)
  if (beside) return at(beside.centre, beside.shapes)

  if (label && vertical) {
    const pushed = pushLabelAside(marks, label, {
      min,
      max,
      labelMin: Math.min(startAlong, endAlong) + LABEL_END_MARGIN,
      labelMax: Math.max(startAlong, endAlong) - LABEL_END_MARGIN,
      markObstacles: fixed,
      labelObstacles: forLabel,
    })
    if (pushed) return at(pushed.centre, pushed.shapes, pushed.labelShift)
    // Cramped run: tighter clearances, the label up to the run ends, and the wall symbols
    // pulled towards the ends. The marks never cross a route glyph or the label.
    const walls = decorations.verticalRoute === 'inWall' || decorations.verticalRoute === 'onWall'
    for (const wallMargin of walls ? CRAMPED_WALL_MARGINS : [undefined]) {
      const cramped = routeObstacles(segment, decorations, vertical, { wallMargin, tight: true })
      const squeezed = pushLabelAside(marks, label, {
        min: Math.min(startAlong, endAlong) + CRAMPED_END_MARGIN,
        max: Math.max(startAlong, endAlong) - CRAMPED_END_MARGIN,
        labelMin: Math.min(startAlong, endAlong),
        labelMax: Math.max(startAlong, endAlong),
        markObstacles: cramped.fixed,
        labelObstacles: cramped.forLabel,
      })
      if (squeezed) return at(squeezed.centre, squeezed.shapes, squeezed.labelShift, wallMargin)
    }
  }

  // Too cramped even then: draw them anyway, clear of the route symbols when possible.
  const anywhere = layoutConductorMarks(marks, { min, max, obstacles: fixed, preferred })
  if (anywhere) return at(anywhere.centre, anywhere.shapes)
  const walls = decorations.verticalRoute === 'inWall' || decorations.verticalRoute === 'onWall'
  const innermost = CRAMPED_WALL_MARGINS[CRAMPED_WALL_MARGINS.length - 1]!
  const pulledIn = layoutConductorMarks(marks, {
    min: Math.min(startAlong, endAlong) + CRAMPED_END_MARGIN,
    max: Math.max(startAlong, endAlong) - CRAMPED_END_MARGIN,
    obstacles: routeObstacles(segment, decorations, vertical, { wallMargin: innermost, tight: true })
      .fixed,
    preferred,
  })
  if (pulledIn) return at(pulledIn.centre, pulledIn.shapes, 0, walls ? innermost : undefined)
  const unclear = layoutConductorMarks(marks, { min, max, obstacles: [], preferred })
  if (unclear) return at(unclear.centre, unclear.shapes)
  return at((startAlong + endAlong) / 2, conductorMarkShapes(conductorMarkGlyphs(marks, true)))
}

/** Route and tube glyph flags for a one-wire piece, as the wire renderer draws them. */
export function oneWireConductorMarkRouteDecorations(
  segment: WireSegment,
  ownsSupplyDecoration = true
): Pick<OneWireConductorMarkDecorations, 'verticalRoute' | 'verticalTube' | 'supplyRouteGlyphs'> {
  const visible = isRouteIndicatorVisibleForSegment(segment)
  const route = segment.wireRoute
  const effectiveRoute =
    route === 'ground' || route === 'air'
      ? route
      : route === 'wall'
        ? segment.inWall === true
          ? 'inWall'
          : 'onWall'
        : undefined
  if (isSupplyWireSegmentForLabel(segment))
    return {
      supplyRouteGlyphs: ownsSupplyDecoration && visible && (segment.inTube === true || !!effectiveRoute),
    }
  return visible ? { verticalRoute: effectiveRoute, verticalTube: segment.inTube === true } : {}
}

/**
 * The cable label shift {@link layoutOneWireConductorMarks} applies, for the export overlay
 * that places the label text without drawing the marks.
 */
export function getOneWireConductorMarkLabelShift(
  segment: WireSegment,
  cableLabel: NonNullable<OneWireConductorMarkDecorations['cableLabel']>
): number {
  if (!segment.conductorMarks) return 0
  return (
    layoutOneWireConductorMarks(segment, {
      cableLabel,
      ...oneWireConductorMarkRouteDecorations(segment),
    })?.labelShift ?? 0
  )
}

function padded(centre: number, halfLength: number, gap = DECORATION_GAP): [number, number] {
  return [centre - halfLength - gap, centre + halfLength + gap]
}

/** The label's extent along the wire, as the wire label draws it. */
function cableLabelSpan(
  segment: WireSegment,
  decorations: OneWireConductorMarkDecorations,
  vertical: boolean
): { centre: number; halfLength: number } | undefined {
  const label = decorations.cableLabel
  if (!label) return undefined
  if (vertical) {
    const stack = computeVerticalWireLabelStackLayout({
      mainText: label.mainText,
      fireClassText: label.fireClassText,
      wireLengthText: label.wireLengthText,
      startPoint: segment.startPoint,
      endPoint: label.labelEndPoint,
      fontFamily: label.fontFamily,
      align: 'center',
      distanceFromWire: label.distanceFromWire,
      offsetAlongWire: label.offsetAlongWire,
    })
    if (!stack) return undefined
    const width = Math.max(
      stack.main.textWidth,
      stack.fireClass?.textWidth ?? 0,
      stack.wireLength?.textWidth ?? 0
    )
    return { centre: stack.anchorY, halfLength: width / 2 }
  }
  const anchor = getSupplyWireLabelAnchor(segment) ?? {
    x: (segment.startPoint.x + segment.endPoint.x) / 2,
    y: segment.startPoint.y,
  }
  const width = Math.max(
    ...[label.mainText, label.fireClassText, label.wireLengthText]
      .filter((text): text is string => !!text?.trim())
      .map((text) => measureTextWidth(text, label.fontFamily, WIRE_LABEL_FONT_SIZE))
  )
  return { centre: anchor.x, halfLength: width / 2 }
}

/**
 * Route and supply glyphs the marks must clear (`fixed`), and the subset that also reaches
 * the label beside the wire (`forLabel`): wall symbols sit on the other side of the wire,
 * and tube and air circles are too small to reach it, but the ground symbol is wide.
 */
function routeObstacles(
  segment: WireSegment,
  decorations: OneWireConductorMarkDecorations,
  vertical: boolean,
  { wallMargin, tight = false }: { wallMargin?: number; tight?: boolean } = {}
): { fixed: Array<[number, number]>; forLabel: Array<[number, number]> } {
  const gap = tight ? CRAMPED_GAP : DECORATION_GAP
  const fixed: Array<[number, number]> = []
  const forLabel: Array<[number, number]> = []
  if (vertical && (decorations.verticalRoute || decorations.verticalTube)) {
    const routeDeltaY = getVerticalRouteIndicatorEndY(segment) - segment.startPoint.y
    const originY = segment.startPoint.y - 10
    const centreY = originY + routeDeltaY / 2 + 10
    if (decorations.verticalRoute === 'inWall' || decorations.verticalRoute === 'onWall') {
      for (const offset of getVerticalWallRouteSymbolOffsets(routeDeltaY, wallMargin))
        fixed.push(padded(originY + offset, tight ? WALL_SYMBOL_HALF : 6, gap))
      if (decorations.verticalTube) fixed.push(padded(centreY, 3))
    } else {
      // Ground and tube stack ±7 around the centre when both are present.
      const glyphs = padded(
        centreY,
        decorations.verticalRoute === 'ground' && decorations.verticalTube ? 13 : 7
      )
      fixed.push(glyphs)
      if (decorations.verticalRoute === 'ground') forLabel.push(glyphs)
    }
  }
  if (decorations.supplyRouteGlyphs) {
    const anchor = getSupplyWireLabelAnchor(segment)
    const glyphs = padded(anchor ? anchor.x : (segment.startPoint.y + segment.endPoint.y) / 2, 18)
    fixed.push(glyphs)
    forLabel.push(glyphs)
  }
  return { fixed, forLabel }
}

function clearOf(
  low: number,
  high: number,
  obstacles: ReadonlyArray<readonly [number, number]>
): boolean {
  return obstacles.every(([a, b]) => high <= Math.min(a, b) || low >= Math.max(a, b))
}

/**
 * Marks and label side by side in the run: the marks clear of every route glyph, the label
 * clear of the glyphs that reach it, and the label as close to where it was drawn as possible.
 */
function pushLabelAside(
  marks: ConductorMarks,
  label: { centre: number; halfLength: number },
  axis: {
    min: number
    max: number
    labelMin: number
    labelMax: number
    markObstacles: ReadonlyArray<readonly [number, number]>
    labelObstacles: ReadonlyArray<readonly [number, number]>
  }
): { centre: number; shapes: ConductorMarkShapes; labelShift: number } | undefined {
  const labelHalf = label.halfLength + DECORATION_GAP
  for (const compact of [false, true]) {
    const shapes = conductorMarkShapes(conductorMarkGlyphs(marks, compact))
    const marksHalf = (shapes.length + 2) / 2
    let best: { centre: number; shapes: ConductorMarkShapes; labelShift: number } | undefined
    for (let centre = axis.min + marksHalf; centre <= axis.max - marksHalf; centre += PUSH_STEP) {
      if (!clearOf(centre - marksHalf, centre + marksHalf, axis.markObstacles)) continue
      // The label just before (−1) or just after (+1) the marks along the axis.
      for (const side of [-1, 1] as const) {
        const labelCentre = centre + side * (marksHalf + labelHalf)
        if (labelCentre - label.halfLength < axis.labelMin) continue
        if (labelCentre + label.halfLength > axis.labelMax) continue
        if (!clearOf(labelCentre - labelHalf, labelCentre + labelHalf, axis.labelObstacles)) continue
        const labelShift = labelCentre - label.centre
        if (!best || Math.abs(labelShift) < Math.abs(best.labelShift))
          best = { centre, shapes, labelShift }
      }
    }
    if (best) return best
  }
  return undefined
}
