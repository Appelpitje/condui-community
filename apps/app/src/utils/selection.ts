/**
 * Selection utilities for working with multi-select and entity relationships
 */

import type { Selection } from '@/types/ui'

/** Includes connection/owner metadata: equal ids alone do not identify a selection. */
export function areSelectionsEqual(left: Selection, right: Selection): boolean {
  const equal = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
        a.every((value, index) => equal(value, b[index]))
    }
    const first = a as Record<string, unknown>, second = b as Record<string, unknown>
    return [...new Set([...Object.keys(first), ...Object.keys(second)])]
      .every((key) => equal(first[key], second[key]))
  }
  return equal(left, right)
}

/**
 * Check if an ID is selected
 */
export function isSelected(selection: Selection, id: string): boolean {
  return selection.ids.includes(id)
}

/**
 * Toggle an ID in the selection
 */
export function toggleSelection(selection: Selection, id: string): Selection {
  if (selection.ids.includes(id)) {
    return {
      ...selection,
      ids: selection.ids.filter((sid) => sid !== id),
    }
  }
  return {
    ...selection,
    ids: [...selection.ids, id],
  }
}

/**
 * Add to selection (for Ctrl+Click)
 */
export function addToSelection(selection: Selection, id: string): Selection {
  if (selection.ids.includes(id)) {
    return selection
  }
  return {
    ...selection,
    ids: [...selection.ids, id],
  }
}

/**
 * Remove from selection
 */
export function removeFromSelection(selection: Selection, id: string): Selection {
  return {
    ...selection,
    ids: selection.ids.filter((sid) => sid !== id),
  }
}

/**
 * Select multiple IDs
 */
export function selectMultiple(
  type: Selection['type'],
  ids: string[]
): Selection {
  return { type, ids }
}

/**
 * Clear selection
 */
export function clearSelection(): Selection {
  return { type: null, ids: [] }
}

/**
 * Select single entity
 */
export function selectSingle(
  type: Selection['type'],
  id: string
): Selection {
  return { type, ids: [id] }
}
