const Busboy = require('busboy')
const { gzipSync } = require('zlib')
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')
const { convertCadBuffer } = require('./_cad-views.cjs')

const MAX_UPLOAD_BYTES = Number(process.env.DWG_CONVERT_MAX_UPLOAD_BYTES || 20 * 1024 * 1024)
const MAX_CROP_AXIS = Number(process.env.DWG_CONVERT_MAX_CROP_AXIS || 100000)

const LAMBDA_RESPONSE_LIMIT = 6_000_000

function jsonResponse(statusCode, payload) {
  const json = JSON.stringify(payload)
  if (Buffer.byteLength(json) > LAMBDA_RESPONSE_LIMIT) {
    const compressed = gzipSync(json)
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-store',
      },
      body: compressed.toString('base64'),
      isBase64Encoded: true,
    }
  }
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: json,
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
    let fileName = 'upload.dwg'
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
      file.on('data', chunk => {
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

function cropSvg(svgContent, crop) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  svg.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.width} ${crop.height}`)
  svg.setAttribute('width', String(crop.width))
  svg.setAttribute('height', String(crop.height))
  return new XMLSerializer().serializeToString(svg)
}

async function convertDwgToSvg(fileBuffer) {
  const converted = await convertCadBuffer(fileBuffer, 'dwg')
  if (converted.views.length === 0) {
    throw new Error('DWG drawing has no visible model-space content.')
  }
  return { ...converted, svgContent: converted.views[0].svgContent }
}

exports.handler = async event => {
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
    return errorResponse(400, 'MISSING_FILE', 'Missing DWG upload in multipart body.')
  }

  const warnings = []
  if (fileMimeType && !fileMimeType.includes('dwg') && fileMimeType !== 'application/octet-stream') {
    warnings.push(`Uploaded MIME type is "${fileMimeType}", continuing as DWG.`)
  }
  const { crop, warning: cropWarning } = parseAndValidateCrop(fields.crop)
  if (cropWarning) warnings.push(cropWarning)

  try {
    const converted = await convertDwgToSvg(fileBuffer)
    let svgContent = converted.svgContent
    let { width, height } = parseSvgDimensions(svgContent)
    warnings.push(...converted.warnings)
    if (width <= 0 || height <= 0 || Math.max(width / Math.max(height, 1e-9), height / Math.max(width, 1e-9)) > 100) {
      return errorResponse(
        422,
        'DWG_CONVERSION_DEGENERATE',
        `DWG conversion produced unusable SVG dimensions (${width} x ${height}).`,
        warnings,
      )
    }
    if (crop && width > 0 && height > 0) {
      const clamped = clampCrop(crop, width, height)
      svgContent = cropSvg(svgContent, clamped)
      width = clamped.width
      height = clamped.height
    }
    if (width <= 0 || height <= 0) {
      warnings.push('SVG dimensions were not explicit; width/height defaulted to 0.')
    }
    // Crop requests apply to the single legacy SVG; per-viewport views are returned uncropped.
    const views = !crop && Array.isArray(converted.views) && converted.views.length > 0
      ? converted.views.map(view => ({
          id: view.id,
          label: view.label,
          svgContent: view.svgContent,
          layers: view.layers,
          ...parseSvgDimensions(view.svgContent),
        }))
      : undefined
    return jsonResponse(200, {
      svgContent,
      width,
      height,
      ...(views ? { views } : {}),
      warnings,
      cadMetadata: converted.cadMetadata,
      sourceName: fileName || 'upload.dwg',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DWG conversion failed.'
    return errorResponse(422, 'DWG_CONVERSION_FAILED', message, warnings)
  }
}
