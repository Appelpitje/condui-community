const Busboy = require('busboy')
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')
const path = require('node:path')

const MAX_UPLOAD_BYTES = Number(process.env.PDF_CONVERT_MAX_UPLOAD_BYTES || 20 * 1024 * 1024)
const MAX_PAGE_INDEX = Number(process.env.PDF_CONVERT_MAX_PAGE_INDEX || 500)
const MAX_CROP_AXIS = Number(process.env.PDF_CONVERT_MAX_CROP_AXIS || 100000)
const DEFAULT_PREVIEW_SCALE = Number(process.env.PDF_CONVERT_PREVIEW_SCALE || 0.2)
const MAX_PREVIEW_PIXELS = Number(process.env.PDF_CONVERT_MAX_PREVIEW_PIXELS || 2_000_000)

let pdfjsPromise = null
let canvasPromise = null
let svgExtractorPdfJs = null
let svgExtractorDomInitialized = false
const FORCE_FONT_FAMILY = process.env.PDF_CONVERT_FORCE_FONT_FAMILY || 'Arial, sans-serif'

function standardFontDataUrl(packageName) {
  return path.join(path.dirname(require.resolve(`${packageName}/package.json`)), 'standard_fonts').replaceAll('\\', '/') + '/'
}

async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ]).then(([pdfjs, worker]) => {
      bindPdfWorker(pdfjs, worker)
      return pdfjs
    })
  }
  return pdfjsPromise
}

function bindPdfWorker(pdfjs, worker) {
  // Both versions publish globalThis.pdfjsWorker. Bind each Node fake-worker
  // loader to its matching module so the SVG and maintained runtimes can coexist.
  Object.defineProperty(pdfjs.PDFWorker, '_setupFakeWorkerGlobal', {
    value: Promise.resolve(worker.WorkerMessageHandler),
    configurable: true,
  })
}

async function getCanvas() {
  if (!canvasPromise) {
    canvasPromise = import('@napi-rs/canvas')
  }
  return canvasPromise
}

function getPdfJsSvgExtractor() {
  if (svgExtractorPdfJs) return svgExtractorPdfJs
  if (!svgExtractorDomInitialized) {
    const Module = require('module')
    const originalLoad = Module._load
    try {
      // jsdom optionally resolves `canvas`; in our environment the package exists
      // but native binary may not. Return a harmless stub for the SVG extractor path.
      Module._load = function patchedCanvasLoad(request, parent, isMain) {
        if (request === 'canvas') return {}
        return originalLoad.call(this, request, parent, isMain)
      }
      const { JSDOM } = require('jsdom')
      const { window } = new JSDOM('<!doctype html><html><body></body></html>')
      global.window = window
      global.document = window.document
      if (typeof global.XMLSerializer === 'undefined') {
        global.XMLSerializer = window.XMLSerializer
      }
      svgExtractorDomInitialized = true
    } finally {
      Module._load = originalLoad
    }
  }
  // PDF.js 4+ removed SVGGraphics. Keep this pinned compatibility runtime separate
  // from the maintained renderer, and always load documents with isEvalSupported: false
  // below (the upstream mitigation for GHSA-wgrm-67xf-hhpq). Do not re-enable eval.
  svgExtractorPdfJs = require('pdfjs-svg-legacy/build/pdf.js')
  bindPdfWorker(svgExtractorPdfJs, require('pdfjs-svg-legacy/build/pdf.worker.js'))
  return svgExtractorPdfJs
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  }
}

function errorResponse(statusCode, code, message, warnings = []) {
  return jsonResponse(statusCode, {
    svgContent: null,
    width: 0,
    height: 0,
    warnings,
    error: { code, message },
  })
}

function parseBoolean(value, defaultValue = false) {
  if (typeof value !== 'string') return defaultValue
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false
  return defaultValue
}

function sanitizeNumber(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num
}

function parseAndValidateCrop(rawCrop) {
  if (!rawCrop) return { crop: null, warning: null }
  let parsed
  try {
    parsed = typeof rawCrop === 'string' ? JSON.parse(rawCrop) : rawCrop
  } catch {
    return { crop: null, warning: 'Invalid crop JSON. Crop ignored.' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { crop: null, warning: 'Invalid crop shape. Crop ignored.' }
  }
  const x = sanitizeNumber(parsed.x)
  const y = sanitizeNumber(parsed.y)
  const width = sanitizeNumber(parsed.width)
  const height = sanitizeNumber(parsed.height)
  if (x === null || y === null || width === null || height === null) {
    return { crop: null, warning: 'Invalid crop numbers. Crop ignored.' }
  }
  if (
    Math.abs(x) > MAX_CROP_AXIS ||
    Math.abs(y) > MAX_CROP_AXIS ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_CROP_AXIS ||
    height > MAX_CROP_AXIS
  ) {
    return { crop: null, warning: 'Crop values out of allowed range. Crop ignored.' }
  }
  return { crop: { x, y, width, height }, warning: null }
}

function clampCrop(crop, pageWidth, pageHeight) {
  const x = Math.max(0, Math.min(crop.x, Math.max(0, pageWidth - 1)))
  const y = Math.max(0, Math.min(crop.y, Math.max(0, pageHeight - 1)))
  const width = Math.max(1, Math.min(crop.width, pageWidth - x))
  const height = Math.max(1, Math.min(crop.height, pageHeight - y))
  return { x, y, width, height }
}

function cropSvg(svgContent, crop) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  svg.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.width} ${crop.height}`)
  svg.setAttribute('width', String(crop.width))
  svg.setAttribute('height', String(crop.height))
  return new XMLSerializer().serializeToString(svg)
}

function parseSvgDimensions(svgContent) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  const viewBox = svg.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number).filter(Number.isFinite)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }
  const widthAttr = svg.getAttribute('width')
  const heightAttr = svg.getAttribute('height')
  const width = widthAttr ? Number(String(widthAttr).replace(/[^\d.+-]/g, '')) : NaN
  const height = heightAttr ? Number(String(heightAttr).replace(/[^\d.+-]/g, '')) : NaN
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height }
  }
  return { width: 0, height: 0 }
}

const SVG_XLINK_NS = 'http://www.w3.org/1999/xlink'

function collectSvgImageElements(root) {
  const images = []
  const visit = (node) => {
    if (!node || node.nodeType !== 1) return
    const tagName = String(node.localName || node.nodeName || '').toLowerCase()
    if (tagName === 'image') images.push(node)
    for (let i = 0; i < node.childNodes.length; i += 1) {
      visit(node.childNodes[i])
    }
  }
  visit(root)
  return images
}

function getSvgImageHref(element) {
  if (typeof element.getAttribute !== 'function') return null
  const direct = element.getAttribute('href')
  if (direct) return direct
  const xlink = element.getAttributeNS ? element.getAttributeNS(SVG_XLINK_NS, 'href') : null
  if (xlink) return xlink
  if (!element.attributes) return null
  for (let i = 0; i < element.attributes.length; i += 1) {
    const attr = element.attributes[i]
    if (attr?.localName === 'href' && attr.value) return attr.value
  }
  return null
}

function setSvgImageHref(element, value) {
  if (typeof element.setAttribute !== 'function') return
  element.setAttribute('href', value)
  if (typeof element.setAttributeNS === 'function') {
    element.setAttributeNS(SVG_XLINK_NS, 'href', value)
  }
  if (!element.attributes) return
  for (let i = 0; i < element.attributes.length; i += 1) {
    const attr = element.attributes[i]
    if (attr?.localName === 'href') {
      element.setAttribute(attr.name, value)
    }
  }
}

async function inlineSvgEmbeddedImages(svgContent, warnings) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  let hadEmbeddedImages = false
  let hadUnresolvedImages = false

  for (const imageEl of collectSvgImageElements(svg)) {
    const href = getSvgImageHref(imageEl)
    if (!href || href.startsWith('data:image/')) continue
    hadEmbeddedImages = true
    if (!href.startsWith('blob:')) {
      hadUnresolvedImages = true
      continue
    }
    try {
      const response = await fetch(href)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const type = response.headers.get('content-type') || 'image/png'
      setSvgImageHref(imageEl, `data:${type};base64,${buffer.toString('base64')}`)
    } catch (error) {
      hadUnresolvedImages = true
      const message = error instanceof Error ? error.message : 'unknown error'
      warnings.push(`Embedded raster image could not be inlined: ${message}`)
    }
  }

  if (hadEmbeddedImages && hadUnresolvedImages) {
    warnings.push('Some embedded raster images could not be inlined in vector output.')
  }

  return {
    svg: new XMLSerializer().serializeToString(svg),
    hadEmbeddedImages,
    hadUnresolvedImages,
  }
}


function normalizeSvgForImport(svgContent, warnings) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement

  const walkElements = (root, visitor) => {
    if (!root || !root.childNodes) return
    for (let i = 0; i < root.childNodes.length; i += 1) {
      const child = root.childNodes[i]
      if (child?.nodeType === 1) {
        visitor(child)
        walkElements(child, visitor)
      }
    }
  }

  const annotationNodes = []
  walkElements(svg, (node) => {
    const dataAnnotationIdRaw =
      typeof node.getAttribute === 'function' ? node.getAttribute('data-annotation-id') : null
    const annotationIdRaw =
      typeof node.getAttribute === 'function' ? node.getAttribute('annotation-id') : null
    const dataAnnotationId = dataAnnotationIdRaw == null ? '' : String(dataAnnotationIdRaw).trim()
    const annotationId = annotationIdRaw == null ? '' : String(annotationIdRaw).trim()
    const hasAnnotationAttr = dataAnnotationId.length > 0 || annotationId.length > 0
    const className =
      typeof node.getAttribute === 'function' ? String(node.getAttribute('class') || '') : ''
    const looksLikeAnnotationClass = /\bannotation\b/i.test(className)
    if (hasAnnotationAttr || looksLikeAnnotationClass) {
      annotationNodes.push(node)
    }
  })

  let removed = 0
  for (const node of annotationNodes) {
    node.parentNode?.removeChild(node)
    removed += 1
  }
  if (removed > 0) warnings.push(`Omitted ${removed} annotation layer element(s).`)

  const style = doc.createElement('style')
  style.textContent = `text, tspan { font-family: ${FORCE_FONT_FAMILY} !important; }`
  svg.insertBefore(style, svg.firstChild)

  const textLikeNodes = []
  walkElements(svg, (node) => {
    const tagName = String(node.nodeName || '').toLowerCase()
    if (tagName === 'text' || tagName === 'tspan' || tagName === 'svg:text' || tagName === 'svg:tspan') {
      textLikeNodes.push(node)
    }
  })
  for (const node of textLikeNodes) {
    if (typeof node.removeAttribute === 'function') {
      node.removeAttribute('font-family')
      node.removeAttribute('font')
    }
  }

  return new XMLSerializer().serializeToString(svg)
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

async function rebuildDecodedTextLayer(svgContent, fileBuffer, pageIndex, warnings) {
  try {
    const pdfjs = await getPdfJs()
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      stopAtErrors: true,
      isEvalSupported: false,
      standardFontDataUrl: standardFontDataUrl('pdfjs-dist'),
    })
    const docProxy = await loadingTask.promise
    try {
      if (pageIndex >= docProxy.numPages) return svgContent
      const page = await docProxy.getPage(pageIndex + 1)
      const textContent = await page.getTextContent()
      const textItems = Array.isArray(textContent.items) ? textContent.items : []

      const parser = new DOMParser()
      const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml')
      const svg = svgDoc.documentElement


      const walkElements = (root, visitor) => {
        if (!root || !root.childNodes) return
        for (let i = 0; i < root.childNodes.length; i += 1) {
          const child = root.childNodes[i]
          if (child?.nodeType === 1) {
            visitor(child)
            walkElements(child, visitor)
          }
        }
      }

      // Remove text emitted by upstream SVG renderer (can be glyph IDs like E014).
      const oldTexts = []
      walkElements(svg, (node) => {
        const tagName = String(node.nodeName || '').toLowerCase()
        if (tagName === 'text' || tagName === 'tspan' || tagName === 'svg:text' || tagName === 'svg:tspan') {
          oldTexts.push(node)
        }
      })
      for (const node of oldTexts) {
        node.parentNode?.removeChild(node)
      }

      let injectedCount = 0
      let textLayerXml = '<g id="decoded-text-layer" data-eendra="decoded-text">'
      const viewport = page.getViewport({ scale: 1 })
      for (const item of textItems) {
        const str = typeof item?.str === 'string' ? item.str : ''
        if (!str.trim()) continue
        const tr = Array.isArray(item?.transform) ? item.transform : null
        if (!tr || tr.length < 6) continue
        const raw = tr.map((n) => Number(n))
        if (raw.length < 6 || !raw.every(Number.isFinite)) continue
        const [a, b, c, d, e, fRaw] = raw
        const f = viewport.height - fRaw
        if (![a, b, c, d, e, f].every(Number.isFinite)) continue
        const escaped = escapeXml(str)
        textLayerXml += `<text transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})" style="font-family:${FORCE_FONT_FAMILY};font-size:1px;white-space:pre;">${escaped}</text>`
        injectedCount += 1
      }
      textLayerXml += '</g>'

      if (injectedCount > 0) {
        // Append using XML fragment parsing for compatibility with xmldom.
        const fragDoc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${textLayerXml}</svg>`, 'image/svg+xml')
        const layer = fragDoc.documentElement.firstChild
        if (layer) svg.appendChild(layer)
        warnings.push(`Rebuilt SVG text layer with ${injectedCount} decoded text item(s).`)
      }
      return new XMLSerializer().serializeToString(svg)
    } finally {
      try {
        await docProxy.destroy()
      } catch {
        // Ignore cleanup errors.
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown text decode error'
    warnings.push(`Decoded text-layer rebuild skipped: ${message}`)
    return svgContent
  }
}

async function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const headers = event?.headers || {}
    const contentType = headers['content-type'] || headers['Content-Type']
    if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) {
      reject(new Error('Content-Type must be multipart/form-data'))
      return
    }

    const busboy = Busboy({
      headers: { 'content-type': contentType },
      limits: { files: 1, fileSize: MAX_UPLOAD_BYTES, fields: 20 },
    })

    const fields = {}
    let fileBuffer = null
    let fileName = 'upload.pdf'
    let fileMimeType = ''
    let uploadTooLarge = false

    busboy.on('field', (name, value) => {
      fields[name] = value
    })

    busboy.on('file', (_name, file, info) => {
      fileName = info?.filename || fileName
      fileMimeType = info?.mimeType || ''
      const chunks = []
      file.on('limit', () => {
        uploadTooLarge = true
      })
      file.on('data', (chunk) => {
        chunks.push(chunk)
      })
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks)
      })
    })

    busboy.on('error', reject)
    busboy.on('finish', () => {
      if (uploadTooLarge) {
        reject(new Error(`File exceeds max size of ${MAX_UPLOAD_BYTES} bytes`))
        return
      }
      resolve({ fields, fileBuffer, fileName, fileMimeType })
    })

    const body = event?.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8')
    busboy.end(body)
  })
}

async function renderPreviewPngDataUrl(page, scale, warnings) {
  try {
    const { createCanvas } = await getCanvas()
    const viewport = page.getViewport({ scale })
    const width = Math.max(1, Math.ceil(viewport.width))
    const height = Math.max(1, Math.ceil(viewport.height))
    const pixelCount = width * height
    if (pixelCount > MAX_PREVIEW_PIXELS) {
      warnings.push(`Preview skipped: requested preview exceeds max pixels (${MAX_PREVIEW_PIXELS}).`)
      return undefined
    }
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise
    const buffer = canvas.toBuffer('image/png')
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    warnings.push(`Preview generation failed: ${message}`)
    return undefined
  }
}

exports.handler = async (event) => {
  if (event?.httpMethod !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Use POST multipart/form-data.')
  }

  let parsed
  try {
    parsed = await parseMultipart(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse upload payload.'
    const code = message.includes('max size') ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST'
    return errorResponse(code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, code, message)
  }

  const { fields, fileBuffer, fileName, fileMimeType } = parsed
  if (!fileBuffer || fileBuffer.length === 0) {
    return errorResponse(400, 'MISSING_FILE', 'Missing PDF upload in multipart body.')
  }
  if (fileBuffer.length > MAX_UPLOAD_BYTES) {
    return errorResponse(
      413,
      'PAYLOAD_TOO_LARGE',
      `PDF file exceeds max allowed size (${MAX_UPLOAD_BYTES} bytes).`,
    )
  }

  const pageIndex = Number(fields.pageIndex)
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > MAX_PAGE_INDEX) {
    return errorResponse(
      400,
      'INVALID_PAGE_INDEX',
      `pageIndex must be an integer between 0 and ${MAX_PAGE_INDEX}.`,
    )
  }

  const warnings = []
  if (fileMimeType && fileMimeType !== 'application/pdf') {
    warnings.push(`Uploaded MIME type is "${fileMimeType}", continuing as PDF.`)
  }

  const { crop, warning: cropWarning } = parseAndValidateCrop(fields.crop)
  if (cropWarning) warnings.push(cropWarning)

  const includePreviewPng = parseBoolean(fields.includePreviewPng, false)
  const previewScale = sanitizeNumber(fields.previewScale) ?? DEFAULT_PREVIEW_SCALE
  if (!(previewScale > 0 && previewScale <= 2)) {
    warnings.push('Invalid previewScale. Using default preview scale.')
  }
  const effectivePreviewScale =
    previewScale > 0 && previewScale <= 2 ? previewScale : DEFAULT_PREVIEW_SCALE

  let pdfDoc = null
  let vectorDoc = null
  try {
    let extracted
    try {
      const pdfjsLegacy = getPdfJsSvgExtractor()
      const loadingTask = pdfjsLegacy.getDocument({
        data: new Uint8Array(fileBuffer),
        stopAtErrors: true,
        isEvalSupported: false,
        standardFontDataUrl: standardFontDataUrl('pdfjs-svg-legacy'),
      })
      vectorDoc = await loadingTask.promise
      if (pageIndex >= vectorDoc.numPages) {
        return errorResponse(
          400,
          'PAGE_OUT_OF_RANGE',
          `pageIndex ${pageIndex} is out of range for document with ${vectorDoc.numPages} pages.`,
        )
      }
      const page = await vectorDoc.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: 1 })
      const SVGGraphics = pdfjsLegacy.SVGGraphics
      if (!SVGGraphics) {
        return errorResponse(
          500,
          'PDF_EXTRACTOR_RUNTIME_MISSING',
          'Legacy PDF SVG extractor runtime is unavailable on this machine.',
          warnings,
        )
      }
      const opList = await page.getOperatorList({
        intent: 'display',
        renderInteractiveForms: false,
        annotationMode: 0,
      })
      const svgGfx = new SVGGraphics(page.commonObjs, page.objs)
      const svgElement = await svgGfx.getSVG(opList, viewport)
      if (typeof svgElement?.setAttribute === 'function') {
        svgElement.setAttribute('width', String(viewport.width))
        svgElement.setAttribute('height', String(viewport.height))
        if (!svgElement.getAttribute('viewBox')) {
          svgElement.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`)
        }
      }
      extracted = {
        svgContent: new XMLSerializer().serializeToString(svgElement),
        pageCount: vectorDoc.numPages,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load PDF SVG runtime.'
      console.warn('[convert-pdf] legacy SVG extraction failed', message)
      return errorResponse(
        500,
        'PDF_EXTRACTOR_RUNTIME_MISSING',
        'Legacy PDF SVG extractor runtime is unavailable on this machine.',
        warnings,
      )
    }

    let svgContent = extracted.svgContent
    svgContent = normalizeSvgForImport(svgContent, warnings)
    svgContent = await rebuildDecodedTextLayer(svgContent, fileBuffer, pageIndex, warnings)
    const inlined = await inlineSvgEmbeddedImages(svgContent, warnings)
    svgContent = inlined.svg
    let { width, height } = parseSvgDimensions(svgContent)
    if (width <= 0 || height <= 0) {
      warnings.push('SVG dimensions were not explicit; width/height defaulted to 0.')
    }

    if (crop && width > 0 && height > 0) {
      const clampedCrop = clampCrop(crop, width, height)
      svgContent = cropSvg(svgContent, clampedCrop)
      width = clampedCrop.width
      height = clampedCrop.height
    }

    const response = {
      svgContent,
      width,
      height,
      warnings,
      sourceName: fileName || 'upload.pdf',
      pageIndex,
      pageCount: extracted.pageCount ?? 0,
    }

    if (includePreviewPng) {
      try {
        const pdfjs = await getPdfJs()
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(fileBuffer),
          stopAtErrors: true,
          isEvalSupported: false,
          standardFontDataUrl: standardFontDataUrl('pdfjs-dist'),
        })
        pdfDoc = await loadingTask.promise
        if (pageIndex < pdfDoc.numPages) {
          const page = await pdfDoc.getPage(pageIndex + 1)
          const previewPngDataUrl = await renderPreviewPngDataUrl(
            page,
            effectivePreviewScale,
            warnings,
          )
          if (previewPngDataUrl) {
            response.previewPngDataUrl = previewPngDataUrl
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        warnings.push(`Preview generation skipped: ${message}`)
      }
    }

    return jsonResponse(200, response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF conversion failed.'
    if (
      typeof message === 'string' &&
      (message.includes('canvas.node') || message.includes('Could not find any Visual Studio installation'))
    ) {
      return errorResponse(
        500,
        'PDF_EXTRACTOR_RUNTIME_MISSING',
        'PDF conversion canvas runtime is unavailable on this machine.',
        warnings,
      )
    }
    return errorResponse(422, 'PDF_CONVERSION_FAILED', message, warnings)
  } finally {
    if (pdfDoc) {
      try {
        await pdfDoc.destroy()
      } catch {
        // Ignore cleanup errors.
      }
    }
    if (vectorDoc) {
      try {
        await vectorDoc.destroy()
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}
