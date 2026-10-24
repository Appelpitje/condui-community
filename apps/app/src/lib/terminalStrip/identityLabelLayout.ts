import type { SymbolLabelPosition } from '@/types/schema'
import { getSymbolLabelVerticalMetrics } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

export const TERMINAL_STRIP_IDENTITY_LABEL_FONT_SIZE = 6
export const TERMINAL_STRIP_IDENTITY_LABEL_GAP = 1
const TERMINAL_STRIP_MARKER_VIEWBOX_SIZE = 48
const TERMINAL_STRIP_MARKER_PAINT_TOP = 13.4482
const TERMINAL_STRIP_MARKER_PAINT_BOTTOM = 34.6752

export interface TerminalStripMarkerPaintBounds {
  left: number
  right: number
  top: number
  bottom: number
}

/** Painted slash/circle bounds derived from the terminal_strip.svg viewBox. */
export function getTerminalStripMarkerPaintBounds(
  symbolWidth: number,
  symbolHeight: number,
): TerminalStripMarkerPaintBounds {
  const scaleX = symbolWidth / TERMINAL_STRIP_MARKER_VIEWBOX_SIZE
  const scaleY = symbolHeight / TERMINAL_STRIP_MARKER_VIEWBOX_SIZE
  return {
    left: (13.4343 - TERMINAL_STRIP_MARKER_VIEWBOX_SIZE / 2) * scaleX,
    right: (34.7163 - TERMINAL_STRIP_MARKER_VIEWBOX_SIZE / 2) * scaleX,
    top: (TERMINAL_STRIP_MARKER_PAINT_TOP - TERMINAL_STRIP_MARKER_VIEWBOX_SIZE / 2) * scaleY,
    bottom: (TERMINAL_STRIP_MARKER_PAINT_BOTTOM - TERMINAL_STRIP_MARKER_VIEWBOX_SIZE / 2) * scaleY,
  }
}

export function getTerminalStripIdentityLabelWidth(text: string, fontFamily = 'Figtree'): number {
  return measureSymbolLabelTextWidth(text, fontFamily, TERMINAL_STRIP_IDENTITY_LABEL_FONT_SIZE)
}

/**
 * Place the ID just outside the terminal marker's painted slash/circle bounds.
 * The marker geometry is the 48-unit viewBox in public/symbols/junction/terminal_strip.svg.
 */
export function getTerminalStripIdentityLabelOffset(
  position: SymbolLabelPosition,
  symbolWidth: number,
  symbolHeight: number,
): number {
  const halfHeight = symbolHeight / 2
  if (position === 'bottom') {
    const markerBottom = getTerminalStripMarkerPaintBounds(symbolWidth, symbolHeight).bottom
    return markerBottom + TERMINAL_STRIP_IDENTITY_LABEL_GAP - halfHeight
  }
  if (position === 'top') {
    const markerTop = getTerminalStripMarkerPaintBounds(symbolWidth, symbolHeight).top
    const contentHeight = getSymbolLabelVerticalMetrics(
      ['X1'],
      TERMINAL_STRIP_IDENTITY_LABEL_FONT_SIZE + 2,
    ).totalHeight
    return (
      -halfHeight -
      contentHeight +
      TERMINAL_STRIP_IDENTITY_LABEL_FONT_SIZE -
      markerTop +
      TERMINAL_STRIP_IDENTITY_LABEL_GAP
    )
  }
  const marker = getTerminalStripMarkerPaintBounds(symbolWidth, symbolHeight)
  return position === 'right'
    ? marker.right + TERMINAL_STRIP_IDENTITY_LABEL_GAP - symbolWidth / 2
    : -marker.left + TERMINAL_STRIP_IDENTITY_LABEL_GAP - symbolWidth / 2
}

export interface TerminalStripIdentityLabelBounds {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Painted bounds for a terminal-strip identity as rendered by SymbolTextLabels.
 * Coordinates are relative to the symbol center.
 */
export function getTerminalStripIdentityLabelBounds(
  text: string,
  symbolWidth: number,
  symbolHeight: number,
  position: SymbolLabelPosition,
  fontFamily = 'Figtree',
): TerminalStripIdentityLabelBounds {
  const width = getTerminalStripIdentityLabelWidth(text, fontFamily)
  const contentHeight = getSymbolLabelVerticalMetrics(
    [text],
    TERMINAL_STRIP_IDENTITY_LABEL_FONT_SIZE + 2,
  ).totalHeight
  const textHeight = TERMINAL_STRIP_IDENTITY_LABEL_FONT_SIZE
  const halfWidth = symbolWidth / 2
  const halfHeight = symbolHeight / 2

  if (position === 'bottom') {
    const top =
      halfHeight + getTerminalStripIdentityLabelOffset(position, symbolWidth, symbolHeight)
    return { left: -width / 2, right: width / 2, top, bottom: top + textHeight }
  }
  if (position === 'top') {
    const top = -(
      halfHeight +
      getTerminalStripIdentityLabelOffset(position, symbolWidth, symbolHeight) +
      contentHeight
    )
    return { left: -width / 2, right: width / 2, top, bottom: top + textHeight }
  }

  const offset = getTerminalStripIdentityLabelOffset(position, symbolWidth, symbolHeight)
  const left =
    position === 'right' ? halfWidth + offset : -(halfWidth + offset + width)
  const top = -contentHeight / 2
  return { left, right: left + width, top, bottom: top + textHeight }
}
