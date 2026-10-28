const Busboy = require('busboy')
const { gzipSync } = require('zlib')
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')
const { convertCadBuffer } = require('./_cad-views.cjs')

const MAX_UPLOAD_BYTES = Number(process.env.DXF_CONVERT_MAX_UPLOAD_BYTES || 20 * 1024 * 1024)
const MAX_CROP_AXIS = Number(process.env.DXF_CONVERT_MAX_CROP_AXIS || 100000)

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
    let fileName = 'upload.dxf'
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

async function convertDxfToSvg(fileBuffer) {
  const converted = await convertCadBuffer(fileBuffer, 'dxf')
  if (converted.views.length === 0) {
    throw new Error('DXF drawing has no visible model-space content.')
  }
  return { ...converted, svgContent: converted.views[0].svgContent }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseDxfPairs(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const pairs = []
  for (let i = 0; i < lines.length - 1; i += 2) {
    pairs.push({ code: lines[i].trim(), value: lines[i + 1].trim() })
  }
  return pairs
}

function numberValue(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function pointFromEntity(entity, xCode = '10', yCode = '20') {
  const x = numberValue(entity[xCode])
  const y = numberValue(entity[yCode])
  return x == null || y == null ? null : { x, y }
}

function addBounds(bounds, point) {
  bounds.minX = Math.min(bounds.minX, point.x)
  bounds.minY = Math.min(bounds.minY, point.y)
  bounds.maxX = Math.max(bounds.maxX, point.x)
  bounds.maxY = Math.max(bounds.maxY, point.y)
}

function collectEntity(pairs, startIndex) {
  const type = pairs[startIndex].value
  const values = {}
  const repeated = {}
  let i = startIndex + 1
  for (; i < pairs.length; i += 1) {
    const pair = pairs[i]
    if (pair.code === '0') break
    values[pair.code] = pair.value
    if (!repeated[pair.code]) repeated[pair.code] = []
    repeated[pair.code].push(pair.value)
  }
  return { type, values, repeated, nextIndex: i }
}

function polarPoint(center, radius, angleDeg) {
  const radians = (angleDeg * Math.PI) / 180
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius,
  }
}

function parseMTextHeight(content, fallbackSize) {
  const match = String(content).match(/\\H([0-9.]+)x?;/i)
  const parsed = match ? Number(match[1]) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSize
}

function cleanDxfText(content) {
  return String(content)
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .trim()
}

function convertDxfTextToSvg(text) {
  const pairs = parseDxfPairs(text)
  const elements = []
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const warnings = []
  let currentPolyline = null
  let parsedEntities = 0
  let insunits = null

  for (let pairIndex = 0; pairIndex < pairs.length - 1; pairIndex += 1) {
    if (pairs[pairIndex].code === '9' && pairs[pairIndex].value === '$INSUNITS') {
      insunits = numberValue(pairs[pairIndex + 1].value)
      break
    }
  }

  const finishPolyline = () => {
    if (!currentPolyline || currentPolyline.points.length < 2) {
      currentPolyline = null
      return
    }
    const pointList = currentPolyline.points.map((point) => `${point.x},${point.y}`).join(' ')
    const tag = currentPolyline.closed ? 'polygon' : 'polyline'
    elements.push(`<${tag} points="${pointList}" fill="none" stroke="#111827" stroke-width="1" vector-effect="non-scaling-stroke"/>`)
    parsedEntities += 1
    currentPolyline = null
  }

  for (let i = 0; i < pairs.length;) {
    const pair = pairs[i]
    if (pair.code !== '0') {
      i += 1
      continue
    }

    const { type, values, repeated, nextIndex } = collectEntity(pairs, i)
    if (type !== 'VERTEX' && type !== 'SEQEND') finishPolyline()

    if (type === 'LINE') {
      const p1 = pointFromEntity(values, '10', '20')
      const p2 = pointFromEntity(values, '11', '21')
      if (p1 && p2) {
        addBounds(bounds, p1)
        addBounds(bounds, p2)
        elements.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#111827" stroke-width="1" vector-effect="non-scaling-stroke"/>`)
        parsedEntities += 1
      }
    } else if (type === 'CIRCLE') {
      const center = pointFromEntity(values)
      const radius = numberValue(values['40'])
      if (center && radius != null && radius > 0) {
        addBounds(bounds, { x: center.x - radius, y: center.y - radius })
        addBounds(bounds, { x: center.x + radius, y: center.y + radius })
        elements.push(`<circle cx="${center.x}" cy="${center.y}" r="${radius}" fill="none" stroke="#111827" stroke-width="1" vector-effect="non-scaling-stroke"/>`)
        parsedEntities += 1
      }
    } else if (type === 'ARC') {
      const center = pointFromEntity(values)
      const radius = numberValue(values['40'])
      const start = numberValue(values['50'])
      const end = numberValue(values['51'])
      if (center && radius != null && radius > 0 && start != null && end != null) {
        const p1 = polarPoint(center, radius, start)
        const p2 = polarPoint(center, radius, end)
        const delta = ((end - start) % 360 + 360) % 360
        const largeArc = delta > 180 ? 1 : 0
        addBounds(bounds, { x: center.x - radius, y: center.y - radius })
        addBounds(bounds, { x: center.x + radius, y: center.y + radius })
        elements.push(`<path d="M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArc} 1 ${p2.x} ${p2.y}" fill="none" stroke="#111827" stroke-width="1" vector-effect="non-scaling-stroke"/>`)
        parsedEntities += 1
      }
    } else if (type === 'LWPOLYLINE') {
      const xs = repeated['10'] || []
      const ys = repeated['20'] || []
      const points = []
      for (let pointIndex = 0; pointIndex < Math.min(xs.length, ys.length); pointIndex += 1) {
        const x = numberValue(xs[pointIndex])
        const y = numberValue(ys[pointIndex])
        if (x == null || y == null) continue
        const point = { x, y }
        points.push(point)
        addBounds(bounds, point)
      }
      if (points.length >= 2) {
        const closed = (Number(values['70']) & 1) === 1
        const pointList = points.map((point) => `${point.x},${point.y}`).join(' ')
        const tag = closed ? 'polygon' : 'polyline'
        elements.push(`<${tag} points="${pointList}" fill="none" stroke="#111827" stroke-width="1" vector-effect="non-scaling-stroke"/>`)
        parsedEntities += 1
      }
    } else if (type === 'POLYLINE') {
      currentPolyline = { points: [], closed: (Number(values['70']) & 1) === 1 }
    } else if (type === 'VERTEX' && currentPolyline) {
      const point = pointFromEntity(values)
      if (point) {
        currentPolyline.points.push(point)
        addBounds(bounds, point)
      }
    } else if (type === 'SEQEND') {
      finishPolyline()
    } else if (type === 'TEXT' || type === 'MTEXT') {
      const point = pointFromEntity(values)
      const content = values['1'] || values['3']
      const cleaned = content ? cleanDxfText(content) : ''
      const size = type === 'MTEXT'
        ? parseMTextHeight(content || '', numberValue(values['40']) || 12)
        : numberValue(values['40']) || 12
      if (point && cleaned) {
        addBounds(bounds, point)
        elements.push(`<text transform="translate(${point.x} ${point.y}) scale(1 -1)" x="0" y="0" font-size="${size}" font-family="Arial, sans-serif" fill="#111827">${escapeXml(cleaned)}</text>`)
        parsedEntities += 1
      }
    }

    i = Math.max(nextIndex, i + 1)
  }
  finishPolyline()

  if (!parsedEntities || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
    throw new Error('No supported DXF entities were found.')
  }

  const padding = Math.max(10, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.01)
  const minX = bounds.minX - padding
  const minY = bounds.minY - padding
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2)
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2)
  warnings.push('DXF converted with built-in fallback parser; unsupported CAD entities may be omitted.')
  return {
    svgContent: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}"><g transform="scale(1 -1) translate(0 ${-(bounds.minY + bounds.maxY)})">${elements.join('')}</g></svg>`,
    cadMetadata: { insunits },
    warnings,
  }
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
    return errorResponse(400, 'MISSING_FILE', 'Missing DXF upload in multipart body.')
  }

  const warnings = []
  if (fileMimeType && !fileMimeType.includes('dxf') && fileMimeType !== 'application/octet-stream') {
    warnings.push(`Uploaded MIME type is "${fileMimeType}", continuing as DXF.`)
  }
  const { crop, warning: cropWarning } = parseAndValidateCrop(fields.crop)
  if (cropWarning) warnings.push(cropWarning)

  try {
    let cadMetadata = undefined
    let svgContent
    let convertedViews = []
    try {
      const converted = await convertDxfToSvg(fileBuffer)
      svgContent = converted.svgContent
      cadMetadata = converted.cadMetadata
      convertedViews = converted.views
      warnings.push(...converted.warnings)
    } catch (conversionError) {
      const fallback = convertDxfTextToSvg(fileBuffer.toString('utf8'))
      svgContent = fallback.svgContent
      cadMetadata = fallback.cadMetadata
      const message = conversionError instanceof Error ? conversionError.message : 'DXF reader failed.'
      warnings.push(`DXF reader unavailable: ${message}`, ...fallback.warnings)
    }
    let { width, height } = parseSvgDimensions(svgContent)
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
    const views = !crop && convertedViews.length > 0
      ? convertedViews.map(view => ({
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
      cadMetadata,
      sourceName: fileName || 'upload.dxf',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DXF conversion failed.'
    return errorResponse(422, 'DXF_CONVERSION_FAILED', message, warnings)
  }
}
