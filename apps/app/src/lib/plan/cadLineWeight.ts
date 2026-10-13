/**
 * Display line weight for DWG/DXF plans.
 *
 * The CAD converter draws every line with `stroke-width: 1px` and `non-scaling-stroke`,
 * measured in the SVG's own coordinate space, which is one CAD unit (usually 1 mm).
 * The plan is shown roughly ten times smaller than that space, so every line became a
 * sub-pixel hairline whose brightness depended on antialiasing: identical lines looked
 * bright or faint depending on where they fell on the pixel grid and whether they overlapped.
 *
 * Draw lines one plan pixel wide instead: a crisp 1 px line at 100% zoom on the canvas,
 * and a normal print weight in vector PDF exports.
 */

const CAD_LINE_WEIGHT_PLAN_PX = 1
const ROOT_SVG_WIDTH_RE = /<svg\b[^>]*?\swidth="([\d.]+)"/

type CadPlanAsset = {
  width: number
  cadReference?: unknown
}

export function withCadDisplayLineWeight(svgContent: string, asset: CadPlanAsset | undefined): string {
  if (!asset?.cadReference || !(asset.width > 0)) return svgContent
  const svgWidth = Number(ROOT_SVG_WIDTH_RE.exec(svgContent.slice(0, 4000))?.[1])
  const end = svgContent.lastIndexOf('</svg>')
  if (!(svgWidth > 0) || end < 0) return svgContent

  const strokePx = (svgWidth / asset.width) * CAD_LINE_WEIGHT_PLAN_PX
  // Same selector as the converter's rule; coming later in the document, this one wins.
  const style =
    '<style>line, path, polyline, polygon, rect, circle, ellipse { ' +
    `stroke-width: ${Number(strokePx.toFixed(3))}px; }</style>`
  return svgContent.slice(0, end) + style + svgContent.slice(end)
}
