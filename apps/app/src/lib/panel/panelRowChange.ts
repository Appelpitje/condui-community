/**
 * Apply panel row count change: add/remove rows on the side opposite the feed.
 * When reducing rows, relocates modules in removed rows (adjacent row → first empty → overflow).
 */
import type { Panel, PanelGridSlot } from '@/types/schema'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { resolveModuleWidthCols } from '@/lib/panel/panelGridLayout'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import {
  MIN_PANEL_GRID_MODULE_WIDTH,
  PANEL_GRID_OVERFLOW_GAP_MODULES,
  PANEL_GRID_UNITS_PER_MODULE,
  panelGridUnitsToModules,
  panelModulesToGridUnits,
} from '@/lib/panel/panelGridUnits'

const cellKey = (r: number, c: number) => `${r},${c}`

function buildOccupancy(
  slots: PanelGridSlot[],
  widthOf: (s: PanelGridSlot) => number
): Set<string> {
  const used = new Set<string>()
  for (const s of slots) {
    const w = panelModulesToGridUnits(widthOf(s))
    const col = panelModulesToGridUnits(s.col)
    for (let i = 0; i < w; i++) used.add(cellKey(s.row, col + i))
  }
  return used
}

function isFree(used: Set<string>, row: number, col: number, width: number): boolean {
  for (let i = 0; i < width; i++) {
    if (used.has(cellKey(row, col + i))) return false
  }
  return true
}

function findOnRow(
  used: Set<string>,
  row: number,
  startCol: number,
  width: number,
  cols: number
): number | null {
  for (let c = startCol; c <= cols - width; c++) {
    if (isFree(used, row, c, width)) return c
  }
  return null
}

function findOverflowSlot(
  used: Set<string>,
  rows: number,
  panelCols: number,
  width: number,
  feedFromTop: boolean
): { row: number; col: number } {
  const overflowStartCol = panelCols + PANEL_GRID_OVERFLOW_GAP_MODULES * PANEL_GRID_UNITS_PER_MODULE
  const rowOrder = rowsInFeedOrder(rows, feedFromTop)
  for (const row of rowOrder) {
    for (let col = overflowStartCol; col < overflowStartCol + panelCols; col++) {
      if (isFree(used, row, col, width)) {
        return { row, col }
      }
    }
  }

  // There is no practical limit to the overflow band. Keep going to the right
  // so every evicted module still gets a distinct persisted position.
  const row = rowOrder[0] ?? 0
  let col = overflowStartCol
  while (!isFree(used, row, col, width)) col += width
  return { row, col }
}

/** Rows in feed order: first row to fill (near feed), then next, ... */
function rowsInFeedOrder(newRows: number, feedFromTop: boolean): number[] {
  const out: number[] = []
  if (feedFromTop) {
    for (let r = 0; r < newRows; r++) out.push(r)
  } else {
    for (let r = newRows - 1; r >= 0; r--) out.push(r)
  }
  return out
}

export interface ApplyPanelRowChangeResult {
  slots: PanelGridSlot[]
}

/**
 * Compute new main-panel slots when row count changes from current to newRows.
 * - Add rows: opposite feed side; if feed from bottom, shift existing slot rows up.
 * - Remove rows: remove from opposite feed side; renumber kept slots; relocate evicted (adjacent row → first empty → overflow).
 */
export function applyPanelRowChange(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null,
  newRows: number
): ApplyPanelRowChangeResult {
  const grid = panel.gridView ?? {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  const oldRows = grid.rows
  const cols = grid.columns ?? DEFAULT_PANEL_GRID_COLUMNS
  const colUnits = panelModulesToGridUnits(cols)
  const feedFromTop = grid.feedFromTop ?? false
  const slots = grid.slots ?? []

  const widthOf = (s: PanelGridSlot) =>
    Math.max(MIN_PANEL_GRID_MODULE_WIDTH, resolveModuleWidthCols(s.module, project, s))

  if (newRows === oldRows) {
    return { slots: [...slots] }
  }

  if (newRows > oldRows) {
    // Adding rows on the opposite side of the feed: no removal, only renumber when feed from bottom.
    if (feedFromTop) {
      // Add at bottom: no slot changes
      return { slots: [...slots] }
    }
    // Feed from bottom: add at top → shift all slot rows by (newRows - oldRows)
    const shift = newRows - oldRows
    const newSlots: PanelGridSlot[] = slots.map((s) => ({
      ...s,
      row: s.row + shift,
    }))
    return { slots: newSlots }
  }

  // Reducing rows: remove from opposite side of feed
  const removedCount = oldRows - newRows

  // Which row indices are kept (before renumbering)?
  // Feed from top: keep 0..newRows-1; removed = newRows..oldRows-1
  // Feed from bottom: keep (oldRows-newRows)..(oldRows-1); removed = 0..(oldRows-newRows-1)
  const keptSlots: PanelGridSlot[] = []
  const evicted: PanelGridSlot[] = []

  if (feedFromTop) {
    for (const s of slots) {
      if (s.row < newRows) {
        keptSlots.push({ ...s })
      } else {
        evicted.push({ ...s })
      }
    }
    // Kept rows stay 0..newRows-1; no renumbering
  } else {
    const firstKeptRow = removedCount
    for (const s of slots) {
      if (s.row >= firstKeptRow) {
        keptSlots.push({ ...s, row: s.row - removedCount })
      } else {
        evicted.push({ ...s })
      }
    }
  }

  if (evicted.length === 0) {
    return { slots: keptSlots }
  }

  // Adjacent row: the row next to the removed zone (last kept row when feed from top, first kept row when feed from bottom)
  const adjacentRow = feedFromTop ? newRows - 1 : 0
  const rowOrder = rowsInFeedOrder(newRows, feedFromTop)

  const used = buildOccupancy(keptSlots, widthOf)
  const newSlots = [...keptSlots]

  for (const s of evicted) {
    const w = panelModulesToGridUnits(widthOf(s))
    const preferredCol = panelModulesToGridUnits(s.col)
    let placed = false

    // 1) Try adjacent row, same col (if fits)
    if (preferredCol + w <= colUnits && isFree(used, adjacentRow, preferredCol, w)) {
      newSlots.push({ ...s, row: adjacentRow, col: s.col })
      for (let i = 0; i < w; i++) used.add(cellKey(adjacentRow, preferredCol + i))
      placed = true
    }

    // 2) Try adjacent row, any col
    if (!placed) {
      const c = findOnRow(used, adjacentRow, 0, w, colUnits)
      if (c != null) {
        newSlots.push({ ...s, row: adjacentRow, col: panelGridUnitsToModules(c) })
        for (let i = 0; i < w; i++) used.add(cellKey(adjacentRow, c + i))
        placed = true
      }
    }

    // 3) First empty row (in feed order) with a gap that fits
    if (!placed) {
      for (const r of rowOrder) {
        const c = findOnRow(used, r, 0, w, colUnits)
        if (c != null) {
          newSlots.push({ ...s, row: r, col: panelGridUnitsToModules(c) })
          for (let i = 0; i < w; i++) used.add(cellKey(r, c + i))
          placed = true
          break
        }
      }
    }

    // 4) No space remains in the panel: persist an explicit overflow position.
    if (!placed) {
      const overflow = findOverflowSlot(used, newRows, colUnits, w, feedFromTop)
      newSlots.push({ ...s, row: overflow.row, col: panelGridUnitsToModules(overflow.col) })
      for (let i = 0; i < w; i++) used.add(cellKey(overflow.row, overflow.col + i))
    }
  }

  return { slots: newSlots }
}

/**
 * Compute new main-panel slots when the column count changes.
 * Shrinking never pulls existing overflow back into the panel; it only ejects
 * slots that no longer fit into the configured frame.
 */
export function applyPanelColumnChange(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null,
  newColumns: number
): ApplyPanelRowChangeResult {
  const grid = panel.gridView ?? {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  const oldColumns = grid.columns ?? DEFAULT_PANEL_GRID_COLUMNS
  const rows = Math.max(1, grid.rows ?? DEFAULT_PANEL_GRID_ROWS)
  const feedFromTop = grid.feedFromTop ?? false
  const slots = grid.slots ?? []

  const oldColUnits = panelModulesToGridUnits(oldColumns)
  const newColUnits = panelModulesToGridUnits(newColumns)
  const widthOf = (s: PanelGridSlot) =>
    Math.max(MIN_PANEL_GRID_MODULE_WIDTH, resolveModuleWidthCols(s.module, project, s))

  if (newColumns > oldColumns) {
    const minimumOverflowCol =
      newColUnits + PANEL_GRID_OVERFLOW_GAP_MODULES * PANEL_GRID_UNITS_PER_MODULE
    const columnDelta = newColUnits - oldColUnits
    return {
      slots: slots.map((slot) => {
        const col = panelModulesToGridUnits(slot.col)
        const width = panelModulesToGridUnits(widthOf(slot))
        const wasRightOverflow = col >= 0 && col + width > oldColUnits
        if (!wasRightOverflow) return { ...slot }
        return {
          ...slot,
          col: panelGridUnitsToModules(Math.max(col + columnDelta, minimumOverflowCol)),
        }
      }),
    }
  }

  if (newColumns === oldColumns) return { slots: [...slots] }

  const fitsPanel = (s: PanelGridSlot) => {
    const width = panelModulesToGridUnits(widthOf(s))
    const col = panelModulesToGridUnits(s.col)
    return s.row >= 0 && s.row < rows && col >= 0 && col + width <= newColUnits
  }
  const keptSlots = slots.filter(fitsPanel).map((s) => ({ ...s }))
  const evicted = slots.filter((s) => !fitsPanel(s))
  if (evicted.length === 0) return { slots: keptSlots }

  const used = buildOccupancy(keptSlots, widthOf)
  const newSlots = [...keptSlots]
  for (const slot of evicted) {
    const width = panelModulesToGridUnits(widthOf(slot))
    const overflow = findOverflowSlot(used, rows, newColUnits, width, feedFromTop)
    newSlots.push({ ...slot, row: overflow.row, col: panelGridUnitsToModules(overflow.col) })
    for (let i = 0; i < width; i++) used.add(cellKey(overflow.row, overflow.col + i))
  }

  return { slots: newSlots }
}
