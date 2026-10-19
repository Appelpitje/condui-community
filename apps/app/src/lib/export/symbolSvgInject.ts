/**
 * Keep catalog symbols as vectors in exported SVG/PDF (same approach as sitplan sockets:
 * native vector shapes, not rasterized Konva images).
 *
 * Symbol images are removed from the Konva clone before react-konva-to-svg runs (svgcanvas
 * rasterizes every <image> to PNG). After export we inject themed SVG vectors using the
 * absolute scene transform captured before removal.
 */

import Konva from 'konva'
import {
  SYMBOL_EXPORT_ATTR_SVG_PATH,
  resolveSymbolColorFromImageElement,
  resolveSymbolColorFromImageSrc,
  fetchThemedSymbolSvgText,
  resolveSymbolSvgPathFromImageElement,
  resolveSymbolSvgPathFromImageSrc,
} from '@/lib/symbolImage'
import { THEME_COLORS } from '@/lib/theme/colors'
import { flattenSymbolSvgForExport } from './symbolSvgFlatten'
import { formatCoordinate } from './coordinatePrecision'
import type { ExportTheme } from './types'

const SVG_NS = 'http://www.w3.org/2000/svg'

export type SymbolExportDescriptor = {
  paintOrder: number
  color?: string
  svgPath: string
  /** Scene-space pivot (Konva offset anchor), relative to export root. */
  x: number
  y: number
  rotationDeg: number
  /** Full image-local to scene transform. Preserves Konva offset, parent transforms, and rotation. */
  transformMatrix?: [number, number, number, number, number, number]
  width: number
  height: number
  opacity: number
}

function isHtmlImageElement(value: unknown): value is HTMLImageElement {
  return typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement
}

function isKonvaContainer(node: Konva.Node): node is Konva.Container {
  return typeof (node as Konva.Container).getChildren === 'function'
}

function isKonvaImageNode(node: Konva.Node): node is Konva.Image {
  return node instanceof Konva.Image || node.getClassName?.() === 'Image'
}

function resolveSymbolSvgPathFromImageNode(imageNode: Konva.Image): string | null {
  const attr = imageNode.getAttr(SYMBOL_EXPORT_ATTR_SVG_PATH)
  if (typeof attr === 'string' && attr.startsWith('/')) return attr

  const sourceImage = imageNode.image()
  if (!isHtmlImageElement(sourceImage)) return null
  return resolveSymbolSvgPathFromImageElement(sourceImage)
}

function getNodePoseRelativeToRoot(
  node: Konva.Node,
  root: Konva.Container
): { x: number; y: number; rotationDeg: number } {
  const rootInverse = root.getAbsoluteTransform().copy().invert()
  const position = rootInverse.point(node.getAbsolutePosition())
  const rotationDeg = node.getAbsoluteRotation()
  return {
    x: position.x,
    y: position.y,
    rotationDeg: Math.abs(rotationDeg) < 0.001 ? 0 : rotationDeg,
  }
}

function getSymbolImageExportPose(
  imageNode: Konva.Image,
  root: Konva.Container
): Pick<
  SymbolExportDescriptor,
  'x' | 'y' | 'rotationDeg' | 'transformMatrix' | 'width' | 'height'
> {
  const relativeTransform = root
    .getAbsoluteTransform()
    .copy()
    .invert()
    .multiply(imageNode.getAbsoluteTransform())
    .getMatrix()
  return {
    ...getNodePoseRelativeToRoot(imageNode, root),
    transformMatrix: [
      relativeTransform[0]!,
      relativeTransform[1]!,
      relativeTransform[2]!,
      relativeTransform[3]!,
      relativeTransform[4]!,
      relativeTransform[5]!,
    ],
    width: imageNode.width(),
    height: imageNode.height(),
  }
}

/** Same fallback pattern as planGraphicSvgInject: pivot → rotate → center → viewBox scale. */
export function buildSymbolExportTransform(
  desc: Pick<SymbolExportDescriptor, 'x' | 'y' | 'rotationDeg' | 'width' | 'height'>,
  viewBox: { x: number; y: number; width: number; height: number }
): string {
  const scaleX = desc.width / (viewBox.width || 1)
  const scaleY = desc.height / (viewBox.height || 1)
  const parts = [
    `translate(${formatCoordinate(desc.x)} ${formatCoordinate(desc.y)})`,
    desc.rotationDeg !== 0 ? `rotate(${formatCoordinate(desc.rotationDeg)})` : '',
    `translate(${formatCoordinate(-desc.width / 2)} ${formatCoordinate(-desc.height / 2)})`,
    `scale(${formatCoordinate(scaleX)} ${formatCoordinate(scaleY)})`,
    `translate(${formatCoordinate(-viewBox.x)} ${formatCoordinate(-viewBox.y)})`,
  ].filter(Boolean)
  return parts.join(' ')
}

export function buildSymbolMatrixExportTransform(
  desc: Pick<SymbolExportDescriptor, 'transformMatrix' | 'width' | 'height'>,
  viewBox: { x: number; y: number; width: number; height: number }
): string | null {
  const matrix = desc.transformMatrix
  if (!matrix) return null
  const scaleX = desc.width / (viewBox.width || 1)
  const scaleY = desc.height / (viewBox.height || 1)
  const parts = [
    `matrix(${matrix.map((value) => formatCoordinate(value)).join(' ')})`,
    `scale(${formatCoordinate(scaleX)} ${formatCoordinate(scaleY)})`,
    `translate(${formatCoordinate(-viewBox.x)} ${formatCoordinate(-viewBox.y)})`,
  ]
  return parts.join(' ')
}

function readImageDescriptor(
  imageNode: Konva.Image,
  root: Konva.Container,
  paintOrder: number,
  svgPath: string
): SymbolExportDescriptor {
  imageNode.setAttr(SYMBOL_EXPORT_ATTR_SVG_PATH, svgPath)
  const pose = getSymbolImageExportPose(imageNode, root)
  return {
    paintOrder,
    svgPath,
    color: isHtmlImageElement(imageNode.image())
      ? resolveSymbolColorFromImageElement(imageNode.image() as HTMLImageElement)
      : undefined,
    ...pose,
    opacity: imageNode.opacity() ?? 1,
  }
}

function collectSymbolImageDescriptors(
  node: Konva.Container,
  root: Konva.Container,
  paintOrderRef: { value: number },
  descriptors: SymbolExportDescriptor[],
  toRemove: Konva.Image[]
): void {
  const children = node.getChildren()
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!
    if (isKonvaImageNode(child)) {
      const imageNode = child as Konva.Image
      const svgPath = resolveSymbolSvgPathFromImageNode(imageNode)
      if (!svgPath) continue
      descriptors.push(readImageDescriptor(imageNode, root, paintOrderRef.value++, svgPath))
      toRemove.push(imageNode)
      continue
    }
    if (isKonvaContainer(child)) {
      collectSymbolImageDescriptors(child, root, paintOrderRef, descriptors, toRemove)
    }
  }
}

/**
 * Strip catalog symbol Image nodes from the export clone and return descriptors for SVG injection.
 */
export function collectAndRemoveSymbolImagesForExport(root: Konva.Group): SymbolExportDescriptor[] {
  const descriptors: SymbolExportDescriptor[] = []
  const toRemove: Konva.Image[] = []
  const paintOrderRef = { value: 0 }
  collectSymbolImageDescriptors(root, root, paintOrderRef, descriptors, toRemove)
  toRemove.forEach((imageNode) => imageNode.destroy())
  return descriptors
}

function parseViewBoxFromSvgText(svgText: string): string {
  const match = svgText.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)
  if (match?.[1]) return match[1]

  const widthMatch = svgText.match(/<svg[^>]*\swidth\s*=\s*["']([^"']+)["']/i)
  const heightMatch = svgText.match(/<svg[^>]*\sheight\s*=\s*["']([^"']+)["']/i)
  const width = widthMatch?.[1] ?? '100'
  const height = heightMatch?.[1] ?? '100'
  return `0 0 ${width} ${height}`
}

function parseViewBoxValues(svgText: string): {
  x: number
  y: number
  width: number
  height: number
} {
  const viewBox = parseViewBoxFromSvgText(svgText)
  const parts = viewBox.split(/[\s,]+/).map((value) => Number(value))
  if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
    return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! }
  }
  return { x: 0, y: 0, width: 1, height: 1 }
}

function getExportSymbolStrokeColor(exportTheme: ExportTheme): string {
  return THEME_COLORS[exportTheme === 'dark' ? 'dark' : 'light'].symbolColor
}

function buildSymbolVectorElement(
  doc: Document,
  desc: SymbolExportDescriptor,
  themedSvgText: string,
  strokeColor: string
): SVGGElement {
  const viewBox = parseViewBoxValues(themedSvgText)

  const wrapper = doc.createElementNS(SVG_NS, 'g')
  wrapper.setAttribute(
    'transform',
    buildSymbolMatrixExportTransform(desc, viewBox) ?? buildSymbolExportTransform(desc, viewBox)
  )
  if (desc.opacity < 0.999) {
    wrapper.setAttribute('opacity', String(desc.opacity))
  }

  const flattenedSvgText = flattenSymbolSvgForExport(
    themedSvgText,
    strokeColor,
    `sym${desc.paintOrder}_`
  )
  const parsed = new DOMParser().parseFromString(flattenedSvgText, 'image/svg+xml')
  const sourceRoot = parsed.documentElement
  while (sourceRoot.firstChild) {
    const child = sourceRoot.firstChild
    wrapper.appendChild(doc.importNode(child, true))
    sourceRoot.removeChild(child)
  }

  return wrapper
}

function getSymbolSceneContainer(svgRoot: Element): Element {
  const layerGroup = svgRoot.querySelector(':scope > g')
  if (!layerGroup) return svgRoot
  const layerChildren = Array.from(layerGroup.childNodes).filter(
    (node): node is Element => node.nodeType === 1
  )
  // Konva exports the cloned scene root as a single child <g> under the layer.
  if (layerChildren.length === 1) {
    return layerChildren[0]!
  }
  return layerGroup
}

function serializeDocument(doc: Document): string {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(doc)
  }
  return doc.documentElement.outerHTML
}

function parseKonvaImagePose(
  transform: string,
  x: number,
  y: number,
  width: number,
  height: number
): Pick<SymbolExportDescriptor, 'x' | 'y' | 'rotationDeg' | 'transformMatrix'> {
  const matrixMatch = transform.match(
    /matrix\(([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)\)/
  )
  if (matrixMatch) {
    const a = Number(matrixMatch[1])
    const b = Number(matrixMatch[2])
    const c = Number(matrixMatch[3])
    const d = Number(matrixMatch[4])
    const e = Number(matrixMatch[5])
    const f = Number(matrixMatch[6])
    if (valuesAreFinite(a, b, c, d, e, f)) {
      const rotationDeg = (Math.atan2(b, a) * 180) / Math.PI
      const offsetX = width / 2
      const offsetY = height / 2
      const rad = (rotationDeg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      return {
        x: e + cos * offsetX - sin * offsetY,
        y: f + sin * offsetX + cos * offsetY,
        rotationDeg: Math.abs(rotationDeg) < 0.001 ? 0 : rotationDeg,
        transformMatrix: [a, b, c, d, e, f],
      }
    }
  }

  const rotateMatch = transform.match(
    /rotate\(([-\d.eE+]+)(?:[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+))?\)/
  )
  const rotationDeg = rotateMatch ? Number(rotateMatch[1]) : 0
  const pivotX = rotateMatch?.[2] != null ? Number(rotateMatch[2]) : x + width / 2
  const pivotY = rotateMatch?.[3] != null ? Number(rotateMatch[3]) : y + height / 2

  return {
    x: Number.isFinite(pivotX) ? pivotX : x + width / 2,
    y: Number.isFinite(pivotY) ? pivotY : y + height / 2,
    rotationDeg: Number.isFinite(rotationDeg) ? rotationDeg : 0,
    transformMatrix: undefined,
  }
}

function valuesAreFinite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value))
}

/**
 * Insert catalog symbol SVG vectors into the exported scene SVG.
 */
export async function injectSymbolSvgsIntoExportSvg(
  svgString: string,
  descriptors: SymbolExportDescriptor[],
  exportTheme: ExportTheme
): Promise<string> {
  if (descriptors.length === 0) return svgString

  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) return svgString

  const container = getSymbolSceneContainer(doc.documentElement)
  const isDark = exportTheme === 'dark'
  const strokeColor = getExportSymbolStrokeColor(exportTheme)
  const themedByPath = new Map<string, Promise<string>>()

  const sorted = [...descriptors].sort((a, b) => a.paintOrder - b.paintOrder)

  for (const desc of sorted) {
    const cacheKey = `${desc.svgPath}:${desc.color ?? ''}`
    let themedPromise = themedByPath.get(cacheKey)
    if (!themedPromise) {
      themedPromise = fetchThemedSymbolSvgText(desc.svgPath, isDark, desc.color)
      themedByPath.set(cacheKey, themedPromise)
    }
    const themedSvgText = await themedPromise
    const element = buildSymbolVectorElement(doc, desc, themedSvgText, desc.color ?? strokeColor)
    container.appendChild(element)
  }

  return serializeDocument(doc)
}

/** True when a Konva image should stay vector and must not be rasterized for export. */
export function isCatalogSymbolImageNode(imageNode: Konva.Image): boolean {
  return resolveSymbolSvgPathFromImageNode(imageNode) !== null
}

/** Replace rasterized catalog symbol <image> nodes with inline vectors (fallback path). */
export async function replaceRasterSymbolImagesInExportSvg(
  svgString: string,
  exportTheme: ExportTheme
): Promise<string> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) return svgString

  const images = Array.from(doc.querySelectorAll('image'))
  if (images.length === 0) return svgString

  const isDark = exportTheme === 'dark'
  const strokeColor = getExportSymbolStrokeColor(exportTheme)
  const themedByPath = new Map<string, Promise<string>>()

  for (const imageEl of images) {
    const href =
      imageEl.getAttribute('href') ??
      imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
      imageEl.getAttribute('xlink:href')
    if (!href) continue

    const attrPath = imageEl.getAttribute(SYMBOL_EXPORT_ATTR_SVG_PATH)
    const svgPath =
      typeof attrPath === 'string' && attrPath.startsWith('/')
        ? attrPath
        : resolveSymbolSvgPathFromImageSrc(href)
    if (!svgPath) continue

    const x = Number(imageEl.getAttribute('x') ?? '0')
    const y = Number(imageEl.getAttribute('y') ?? '0')
    const width = Number(imageEl.getAttribute('width') ?? '0')
    const height = Number(imageEl.getAttribute('height') ?? '0')
    const opacity = Number(imageEl.getAttribute('opacity') ?? '1')
    const transform = imageEl.getAttribute('transform') ?? ''
    if (!width || !height) continue

    const color = resolveSymbolColorFromImageSrc(href)
    const cacheKey = `${svgPath}:${color ?? ''}`
    let themedPromise = themedByPath.get(cacheKey)
    if (!themedPromise) {
      themedPromise = fetchThemedSymbolSvgText(svgPath, isDark, color)
      themedByPath.set(cacheKey, themedPromise)
    }
    const themedSvgText = await themedPromise

    const pose = parseKonvaImagePose(transform, x, y, width, height)
    const desc: SymbolExportDescriptor = {
      paintOrder: 0,
      color,
      svgPath,
      ...pose,
      width,
      height,
      opacity,
    }
    const group = buildSymbolVectorElement(doc, desc, themedSvgText, desc.color ?? strokeColor)
    imageEl.parentNode?.replaceChild(group, imageEl)
  }

  return serializeDocument(doc)
}
