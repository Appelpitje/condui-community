/** Base symbol geometry shared by the canvases and headless plan logic (bounds, auto-orientation). */

/** One-wire and plan symbol size in canvas units (symbol image dimensions). */
export const SYMBOL_SIZE = 20

/** Horizontal distance between repeated socket symbols, in one-wire units. */
export const MULTI_SOCKET_OFFSET = 10

/** Panel symbol dimensions (respects the 88.2:48 aspect ratio of the SVG). */
export const PANEL_SYMBOL_WIDTH = 22
export const PANEL_SYMBOL_HEIGHT = 12

/** One-wire panels need a little more visual weight than ordinary endpoint symbols. */
export const EENDRAAD_PANEL_SYMBOL_SCALE = 1.25
export const EENDRAAD_PANEL_SYMBOL_WIDTH = PANEL_SYMBOL_WIDTH * EENDRAAD_PANEL_SYMBOL_SCALE
export const EENDRAAD_PANEL_SYMBOL_HEIGHT = PANEL_SYMBOL_HEIGHT * EENDRAAD_PANEL_SYMBOL_SCALE

/** Extra visual scale for panels and junction panels on the plan so they stand out. */
export const PLAN_PANEL_VISUAL_SCALE = 1.6
