import type { PanelModuleSpecRow } from '@/lib/panel/getModuleDisplayInfo'

/** Fit every protection specification, including the inset frame, inside its center band. */
export function getPanelModuleSpecLayout(
  rows: PanelModuleSpecRow[],
  width: number,
  height: number,
  measureText: (text: string, fontSize: number) => number,
) {
  const preferredSize = 7.5
  const framePaddingX = 2
  const framePaddingY = 1
  const gap = 1
  const availableWidth = Math.max(1, width)
  const availableHeight = Math.max(1, height)
  const measurements = rows.map((row) => ({
    ...row,
    width: measureText(row.text, preferredSize) + (row.frame ? framePaddingX * 2 : 0),
    height: preferredSize + (row.frame ? framePaddingY * 2 : 0),
  }))
  const naturalHeight = measurements.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * gap
  const scale = Math.min(1, availableWidth / Math.max(1, ...measurements.map((row) => row.width)), availableHeight / Math.max(1, naturalHeight))
  let y = (availableHeight - naturalHeight * scale) / 2
  return measurements.map((row) => {
    const result = {
      text: row.text,
      frame: row.frame === true,
      x: (availableWidth - row.width * scale) / 2,
      y,
      width: row.width * scale,
      height: row.height * scale,
      fontSize: preferredSize * scale,
      paddingX: row.frame ? framePaddingX * scale : 0,
      paddingY: row.frame ? framePaddingY * scale : 0,
    }
    y += (row.height + gap) * scale
    return result
  })
}
