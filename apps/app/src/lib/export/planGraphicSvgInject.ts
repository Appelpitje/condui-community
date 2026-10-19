/**
 * Inject catalog plan graphic SVGs into the exported sitplan SVG (vector, preserves rotation).
 */

import Konva from 'konva'
import {
  getPlanGraphicElementAsset,
  PLAN_GRAPHIC_ELEMENT_KONVA_NAME,
  PLAN_GRAPHIC_EXPORT_ATTR_ASSET_ID,
  PLAN_GRAPHIC_EXPORT_ATTR_HEIGHT,
  PLAN_GRAPHIC_EXPORT_ATTR_WIDTH,
} from '@/lib/plan/graphicElements'
import { PLAN_GRAPHIC_SCENE_STROKE_WIDTH } from '@/lib/plan/planGraphicColors'
import {
  fetchPlanGraphicCatalogSvgText,
  getPlanGraphicExportStrokeColor,
  parsePlanGraphicCatalogSvg,
  themePlanGraphicCatalogSvg,
  type PlanGraphicCatalogShape,
  type ParsedPlanGraphicCatalogSvg,
} from '@/lib/plan/planGraphicCatalogSvg'
import type { ExportTheme } from './types'
import type { SceneBounds } from './types'
import type { PlanGraphicElementKind } from '@/types/schema'

export type PlanGraphicExportDescriptor = {
  siblingIndex: number
  x: number
  y: number
  rotationDeg: number
  width: number
  height: number
  svgPath: string
  kind: PlanGraphicElementKind
  strokeColor: string
}

function readGraphicSize(group: Konva.Group): { width: number; height: number } | null {
  const width = group.getAttr(PLAN_GRAPHIC_EXPORT_ATTR_WIDTH) as number | undefined
  const height = group.getAttr(PLAN_GRAPHIC_EXPORT_ATTR_HEIGHT) as number | undefined
  if (width && height && width > 0 && height > 0) {
    return { width, height }
  }
  return null
}

type ViewBox = ParsedPlanGraphicCatalogSvg['viewBox']

const SVG_NS = 'http://www.w3.org/2000/svg'

function mapViewBoxX(x: number, viewBox: ViewBox, targetWidth: number): number {
  return ((x - viewBox.x) / viewBox.width) * targetWidth
}

function mapViewBoxY(y: number, viewBox: ViewBox, targetHeight: number): number {
  return ((y - viewBox.y) / viewBox.height) * targetHeight
}

function mapViewBoxLength(length: number, viewBoxSize: number, targetSize: number): number {
  return (length / viewBoxSize) * targetSize
}

function applyUniformStroke(el: SVGElement): void {
  el.setAttribute('stroke-width', String(PLAN_GRAPHIC_SCENE_STROKE_WIDTH))
  el.setAttribute('vector-effect', 'non-scaling-stroke')
}

/** Rects/lines in element space (no scale transform) so stroke stays uniform when squashed. */
function appendBakedCatalogShape(
  doc: Document,
  parent: SVGGElement,
  shape: PlanGraphicCatalogShape,
  viewBox: ViewBox,
  targetWidth: number,
  targetHeight: number
): void {
  const stroke = shape.stroke
  const fill = 'fill' in shape ? (shape.fill ?? 'none') : 'none'

  if (shape.kind === 'rect') {
    const rect = doc.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(mapViewBoxX(shape.x, viewBox, targetWidth)))
    rect.setAttribute('y', String(mapViewBoxY(shape.y, viewBox, targetHeight)))
    rect.setAttribute('width', String(mapViewBoxLength(shape.width, viewBox.width, targetWidth)))
    rect.setAttribute('height', String(mapViewBoxLength(shape.height, viewBox.height, targetHeight)))
    if (shape.cornerRadius) {
      const rx = mapViewBoxLength(shape.cornerRadius, viewBox.width, targetWidth)
      const ry = mapViewBoxLength(shape.cornerRadius, viewBox.height, targetHeight)
      rect.setAttribute('rx', String(Math.min(rx, ry)))
      rect.setAttribute('ry', String(Math.min(rx, ry)))
    }
    rect.setAttribute('fill', fill)
    rect.setAttribute('stroke', stroke)
    applyUniformStroke(rect)
    parent.appendChild(rect)
    return
  }

  if (shape.kind === 'line') {
    const line = doc.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(mapViewBoxX(shape.points[0]!, viewBox, targetWidth)))
    line.setAttribute('y1', String(mapViewBoxY(shape.points[1]!, viewBox, targetHeight)))
    line.setAttribute('x2', String(mapViewBoxX(shape.points[2]!, viewBox, targetWidth)))
    line.setAttribute('y2', String(mapViewBoxY(shape.points[3]!, viewBox, targetHeight)))
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', stroke)
    line.setAttribute('stroke-linecap', shape.lineCap ?? 'round')
    line.setAttribute('stroke-linejoin', shape.lineJoin ?? 'round')
    applyUniformStroke(line)
    parent.appendChild(line)
  }
}

/** Paths stay in catalog space under scale(); non-scaling-stroke keeps weight uniform. */
function appendScaledPathGroup(
  doc: Document,
  parent: SVGGElement,
  pathShapes: Extract<PlanGraphicCatalogShape, { kind: 'path' }>[],
  viewBox: ViewBox,
  scaleX: number,
  scaleY: number,
  offsetX = 0,
  offsetY = 0
): void {
  if (pathShapes.length === 0) return

  const scaled = doc.createElementNS(SVG_NS, 'g')
  scaled.setAttribute(
    'transform',
    `translate(${offsetX} ${offsetY}) scale(${scaleX} ${scaleY}) translate(${-viewBox.x} ${-viewBox.y})`
  )

  for (const shape of pathShapes) {
    const path = doc.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', shape.data)
    path.setAttribute('fill', shape.fill ?? 'none')
    path.setAttribute('stroke', shape.stroke)
    path.setAttribute('stroke-linecap', shape.lineCap ?? 'round')
    path.setAttribute('stroke-linejoin', shape.lineJoin ?? 'round')
    applyUniformStroke(path)
    scaled.appendChild(path)
  }

  parent.appendChild(scaled)
}

function appendScaledCatalogPaths(
  doc: Document,
  parent: SVGGElement,
  shapes: PlanGraphicCatalogShape[],
  viewBox: ViewBox,
  scaleX: number,
  scaleY: number,
  preserveLastPathAspectRatio: boolean
): void {
  const pathShapes = shapes.filter((s): s is Extract<PlanGraphicCatalogShape, { kind: 'path' }> => s.kind === 'path')
  if (pathShapes.length === 0) return

  const lastPath = preserveLastPathAspectRatio ? pathShapes.at(-1) : undefined
  const regularPaths = lastPath ? pathShapes.slice(0, -1) : pathShapes
  appendScaledPathGroup(doc, parent, regularPaths, viewBox, scaleX, scaleY)

  if (lastPath) {
    const pathScale = Math.min(scaleX, scaleY)
    const offsetX = ((scaleX - pathScale) * viewBox.width) / 2
    appendScaledPathGroup(doc, parent, [lastPath], viewBox, pathScale, pathScale, offsetX)
  }
}

function appendCatalogShapes(
  doc: Document,
  parent: SVGGElement,
  parsed: ParsedPlanGraphicCatalogSvg,
  targetWidth: number,
  targetHeight: number,
  scaleX: number,
  scaleY: number,
  preserveLastPathAspectRatio: boolean
): void {
  for (const shape of parsed.shapes) {
    if (shape.kind === 'path') continue
    appendBakedCatalogShape(doc, parent, shape, parsed.viewBox, targetWidth, targetHeight)
  }
  appendScaledCatalogPaths(
    doc,
    parent,
    parsed.shapes,
    parsed.viewBox,
    scaleX,
    scaleY,
    preserveLastPathAspectRatio
  )
}

async function loadParsedCatalog(
  svgPath: string,
  strokeColor: string,
  cache: Map<string, ParsedPlanGraphicCatalogSvg>
): Promise<ParsedPlanGraphicCatalogSvg> {
  const key = `${svgPath}::${strokeColor}`
  let parsed = cache.get(key)
  if (!parsed) {
    const raw = await fetchPlanGraphicCatalogSvgText(svgPath)
    const themed = themePlanGraphicCatalogSvg(raw, strokeColor)
    parsed = parsePlanGraphicCatalogSvg(themed, strokeColor)
    cache.set(key, parsed)
  }
  return parsed
}

function buildGraphicGroupElement(
  doc: Document,
  desc: PlanGraphicExportDescriptor,
  parsed: ParsedPlanGraphicCatalogSvg
): SVGGElement {
  const { viewBox } = parsed
  const vbW = viewBox.width > 0 ? viewBox.width : 1
  const vbH = viewBox.height > 0 ? viewBox.height : 1
  const scaleX = desc.width / vbW
  const scaleY = desc.height / vbH

  const wrapper = doc.createElementNS(SVG_NS, 'g')
  wrapper.setAttribute(
    'transform',
    `translate(${desc.x} ${desc.y}) rotate(${desc.rotationDeg}) translate(${-desc.width / 2} ${-desc.height / 2})`
  )

  const local = doc.createElementNS(SVG_NS, 'g')
  appendCatalogShapes(
    doc,
    local,
    parsed,
    desc.width,
    desc.height,
    scaleX,
    scaleY,
    desc.kind === 'shower'
  )
  wrapper.appendChild(local)
  return wrapper
}

/**
 * Remove plan graphic groups from the Konva clone (keeps z-order slot) and return export descriptors.
 */
export async function collectAndRemovePlanGraphicElementsForExport(
  root: Konva.Group,
  exportTheme: ExportTheme
): Promise<PlanGraphicExportDescriptor[]> {
  const strokeColor = getPlanGraphicExportStrokeColor(exportTheme)
  const graphicRoots = root
    .find((node: Konva.Node) => node.name() === PLAN_GRAPHIC_ELEMENT_KONVA_NAME)
    .slice() as Konva.Group[]

  const siblingIndexOf = (group: Konva.Group): number => {
    const parent = group.getParent()
    if (!parent) return group.index
    const children = (parent as Konva.Group).getChildren()
    const idx = children.indexOf(group)
    return idx >= 0 ? idx : group.index
  }

  // Remove from highest sibling index first so earlier indices stay valid.
  graphicRoots.sort((a, b) => siblingIndexOf(b) - siblingIndexOf(a))

  const descriptors: PlanGraphicExportDescriptor[] = []

  for (const group of graphicRoots) {
    const assetId = group.getAttr(PLAN_GRAPHIC_EXPORT_ATTR_ASSET_ID) as string | undefined
    const asset = assetId ? getPlanGraphicElementAsset(assetId) : undefined
    if (!asset) continue

    const size = readGraphicSize(group)
    if (!size) continue

    const siblingIndex = siblingIndexOf(group)

    descriptors.push({
      siblingIndex,
      x: group.x(),
      y: group.y(),
      rotationDeg: group.rotation(),
      width: size.width,
      height: size.height,
      svgPath: asset.svgPath,
      kind: asset.kind,
      strokeColor,
    })

    group.destroy()
  }

  return descriptors
}

/** Axis-aligned bounds of a rotated plan graphic in scene space. */
export function planGraphicDescriptorBounds(
  desc: PlanGraphicExportDescriptor
): { x: number; y: number; width: number; height: number } {
  const halfW = desc.width / 2
  const halfH = desc.height / 2
  const rad = (desc.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const corners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ].map((p) => ({
    x: desc.x + p.x * cos - p.y * sin,
    y: desc.y + p.x * sin + p.y * cos,
  }))

  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Graphics are removed from the Konva clone before bounds are measured; union their
 * scene-space footprint so export viewBox still includes them (e.g. car below the plan).
 */
export function unionSceneBoundsWithPlanGraphicExports(
  bounds: SceneBounds,
  descriptors: PlanGraphicExportDescriptor[]
): SceneBounds {
  if (descriptors.length === 0) return bounds

  let minX = bounds.x
  let minY = bounds.y
  let maxX = bounds.x + bounds.width
  let maxY = bounds.y + bounds.height

  for (const desc of descriptors) {
    const graphic = planGraphicDescriptorBounds(desc)
    minX = Math.min(minX, graphic.x)
    minY = Math.min(minY, graphic.y)
    maxX = Math.max(maxX, graphic.x + graphic.width)
    maxY = Math.max(maxY, graphic.y + graphic.height)
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    space: 'scene',
  }
}

/**
 * Insert catalog SVG graphics into the exported sitplan SVG at the original z-order slots.
 */
export async function injectPlanGraphicCatalogSvgsIntoExportSvg(
  svgString: string,
  descriptors: PlanGraphicExportDescriptor[]
): Promise<string> {
  if (descriptors.length === 0) return svgString

  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) return svgString

  const svgRoot = doc.documentElement
  const contentRoot =
    (svgRoot.querySelector('g') as SVGGElement | null) ?? svgRoot

  const parseCache = new Map<string, ParsedPlanGraphicCatalogSvg>()

  // Insert highest index first so earlier sibling indices stay valid.
  const sorted = [...descriptors].sort((a, b) => b.siblingIndex - a.siblingIndex)

  for (const desc of sorted) {
    const parsed = await loadParsedCatalog(desc.svgPath, desc.strokeColor, parseCache)
    const graphicG = buildGraphicGroupElement(doc, desc, parsed)
    const ref = contentRoot.children[desc.siblingIndex] ?? null
    if (ref) {
      contentRoot.insertBefore(graphicG, ref)
    } else {
      contentRoot.appendChild(graphicG)
    }
  }

  return new XMLSerializer().serializeToString(doc)
}
