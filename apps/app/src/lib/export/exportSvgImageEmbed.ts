import { logger } from '@/lib/logger'
import { exportRasterScale } from './exportRasterLimits'
/**
 * Embed non-data URL <image> refs in export SVG so svg2pdf does not XHR blob:/file URLs.
 */

const DATA_IMAGE_RE = /^data:image\//i

function getImageHref(imageEl: Element): string | null {
  return (
    imageEl.getAttribute('href') ??
    imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    imageEl.getAttribute('xlink:href')
  )
}

function serializeDocument(doc: Document): string {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(doc)
  }
  return doc.documentElement.outerHTML
}

function loadImageAsPngDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const naturalWidth = img.naturalWidth || img.width
      const naturalHeight = img.naturalHeight || img.height
      if (!naturalWidth || !naturalHeight) {
        reject(new Error(`Image has no dimensions: ${src}`))
        return
      }
      const scale = exportRasterScale(naturalWidth, naturalHeight)
      const width = Math.max(1, Math.round(naturalWidth * scale))
      const height = Math.max(1, Math.round(naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Could not create canvas for image embed'))
        return
      }
      context.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error(`Failed to load image for export embed: ${src}`))
    img.src = src
  })
}

function setImageHref(imageEl: Element, dataUrl: string): void {
  imageEl.setAttribute('href', dataUrl)
  imageEl.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
  imageEl.removeAttribute('xlink:href')
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const SVG_DATA_IMAGE_RE = /^\s*data:image\/svg\+xml/i
const INLINED_IMAGE_GEOMETRY_ATTRS = new Set(['x', 'y', 'width', 'height', 'preserveAspectRatio'])

export function decodeSvgDataUrl(href: string): string | null {
  const comma = href.indexOf(',')
  if (comma < 0) return null
  const header = href.slice(0, comma)
  const body = href.slice(comma + 1)
  try {
    if (/;base64$/i.test(header)) {
      const binary = atob(body.replace(/\s/g, ''))
      return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
    }
    return decodeURIComponent(body)
  } catch {
    return null
  }
}

/** Give every id in an inlined SVG a unique prefix and rewrite its internal references. */
function prefixSvgIds(root: Element, prefix: string): void {
  const renamed = new Map<string, string>()
  for (const el of [root, ...Array.from(root.querySelectorAll('[id]'))]) {
    const id = el.getAttribute('id')
    if (!id) continue
    renamed.set(id, `${prefix}${id}`)
    el.setAttribute('id', `${prefix}${id}`)
  }
  if (renamed.size === 0) return

  const rewrite = (value: string) =>
    value.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (match, quote: string, id: string) =>
      renamed.has(id) ? `url(${quote}#${renamed.get(id)}${quote})` : match
    )
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.localName === 'href' && attr.value.startsWith('#')) {
        const target = renamed.get(attr.value.slice(1))
        if (target) el.setAttributeNS(attr.namespaceURI, attr.name, `#${target}`)
      } else if (attr.value.includes('url(')) {
        el.setAttributeNS(attr.namespaceURI, attr.name, rewrite(attr.value))
      }
    }
    if (el.localName === 'style' && el.textContent) el.textContent = rewrite(el.textContent)
  }
}

/**
 * Replace `<image href="data:image/svg+xml,...">` with the equivalent nested `<svg>`,
 * as svg2pdf itself renders SVG images. svg2pdf recognises data URLs with a
 * backtracking regex over the whole URL; for multi-megabyte CAD plans that regex
 * fails (Safari) or overflows (Chrome), and svg2pdf then requests the data URL with
 * XMLHttpRequest, which fails the page.
 */
function inlineSvgDataImages(doc: Document): void {
  let index = 0
  for (const imageEl of Array.from(doc.querySelectorAll('image'))) {
    const href = getImageHref(imageEl)
    if (!href || !SVG_DATA_IMAGE_RE.test(href)) continue
    const svgText = decodeSvgDataUrl(href)
    if (!svgText) continue
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const nested = parsed.documentElement
    if (!nested || parsed.querySelector('parsererror') || nested.localName !== 'svg') continue

    const preserveAspectRatio = imageEl.getAttribute('preserveAspectRatio')
    if (
      !preserveAspectRatio ||
      !preserveAspectRatio.includes('defer') ||
      !nested.getAttribute('preserveAspectRatio')
    ) {
      nested.setAttribute('preserveAspectRatio', preserveAspectRatio || 'xMidYMid meet')
    }
    for (const name of ['x', 'y', 'width', 'height']) {
      nested.setAttribute(name, imageEl.getAttribute(name) ?? '0')
    }
    prefixSvgIds(nested, `inlined-image-${index++}-`)

    // Transform, opacity, clipping and styling of the <image> apply to a wrapper group.
    const wrapper = doc.createElementNS(SVG_NS, 'g')
    for (const attr of Array.from(imageEl.attributes)) {
      if (attr.localName === 'href' || INLINED_IMAGE_GEOMETRY_ATTRS.has(attr.name)) continue
      if (attr.namespaceURI === XLINK_NS) continue
      wrapper.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
    }
    wrapper.appendChild(doc.importNode(nested, true))
    imageEl.parentNode?.replaceChild(wrapper, imageEl)
  }
}

/**
 * Inline SVG images as nested SVG, then rasterize remaining external/blob image refs
 * to embedded PNG data URLs. svg2pdf fetches non-data hrefs via XMLHttpRequest, which
 * fails for blob URLs.
 */
export async function embedExternalImagesInExportSvg(svgString: string): Promise<string> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) return svgString

  if (doc.querySelectorAll('image').length === 0) return svgString
  inlineSvgDataImages(doc)
  const images = Array.from(doc.querySelectorAll('image'))

  await Promise.all(
    images.map(async (imageEl) => {
      const href = getImageHref(imageEl)
      if (!href || DATA_IMAGE_RE.test(href)) return

      try {
        const dataUrl = await loadImageAsPngDataUrl(href)
        setImageHref(imageEl, dataUrl)
      } catch (error) {
        logger.warn('[Export] Dropping unloadable SVG image for PDF compose:', href, error)
        imageEl.parentNode?.removeChild(imageEl)
      }
    }),
  )

  return serializeDocument(doc)
}
