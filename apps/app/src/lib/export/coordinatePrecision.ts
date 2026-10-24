import { logger } from '@/lib/logger'
/**
 * Improve coordinate precision in SVG export
 * Uses higher precision for coordinates to prevent misalignment
 */

/**
 * Format coordinate with appropriate precision
 * Uses 2 decimal places (sufficient for mm precision)
 * 
 * @param value Coordinate value
 * @returns Formatted coordinate string
 */
export function formatCoordinate(value: number): string {
  // Use 2 decimal places (sufficient for mm precision)
  return value.toFixed(2)
}

/**
 * Apply coordinate precision to SVG attributes
 * 
 * @param svgString SVG string to fix
 * @returns Fixed SVG string with precise coordinates
 */
export function applyCoordinatePrecision(svgString: string): string {
  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
  
  // Check for parsing errors
  const parserError = svgDoc.querySelector('parsererror')
  if (parserError) {
    logger.warn('[Export] Failed to parse SVG for coordinate precision fix:', parserError.textContent)
    return svgString
  }
  
  const svgElement = svgDoc.documentElement
  
  // Fix viewBox precision
  const viewBox = svgElement.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.split(/\s+/).map(part => {
      const num = parseFloat(part)
      return isNaN(num) ? part : formatCoordinate(num)
    })
    svgElement.setAttribute('viewBox', parts.join(' '))
  }
  
  // Fix width and height precision
  const width = svgElement.getAttribute('width')
  if (width) {
    const num = parseFloat(width)
    if (!isNaN(num)) {
      svgElement.setAttribute('width', formatCoordinate(num))
    }
  }
  
  const height = svgElement.getAttribute('height')
  if (height) {
    const num = parseFloat(height)
    if (!isNaN(num)) {
      svgElement.setAttribute('height', formatCoordinate(num))
    }
  }
  
  // Fix coordinate attributes on all elements
  const allElements = svgDoc.querySelectorAll('*')
  allElements.forEach(element => {
    // Fix common coordinate attributes
    const coordAttrs = ['x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'width', 'height']
    
    coordAttrs.forEach(attr => {
      const value = element.getAttribute(attr)
      if (value) {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          element.setAttribute(attr, formatCoordinate(num))
        }
      }
    })
    
    // Fix transform attributes (matrix, translate, scale, etc.)
    const transform = element.getAttribute('transform')
    if (transform) {
      // Match complete SVG numbers, including the near-zero scientific notation
      // produced by quarter-turn rotations. Splitting an exponent corrupts the matrix.
      const fixedTransform = transform.replace(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, (match) => {
        const num = parseFloat(match)
        return isNaN(num) ? match : formatCoordinate(num)
      })
      element.setAttribute('transform', fixedTransform)
    }
  })
  
  return new XMLSerializer().serializeToString(svgDoc)
}
