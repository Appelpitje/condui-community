import type { symbolCategories } from '@/lib/symbols'

export type SymbolCategoryKey = keyof typeof symbolCategories

/** Major library categories offered as icon shortcuts above the symbol list. */
export const LIBRARY_JUMP_CATEGORIES: ReadonlyArray<{ category: SymbolCategoryKey; iconPath: string }> = [
  { category: 'protection', iconPath: '/symbols/protection/mcb.svg' },
  { category: 'outlets', iconPath: '/symbols/outlets/socket_gnd_child.svg' },
  { category: 'switches', iconPath: '/symbols/switches/switch_1p_icon.svg' },
  { category: 'lighting', iconPath: '/symbols/lighting/light_point.svg' },
  { category: 'appliances', iconPath: '/symbols/appliances/washer.svg' },
  { category: 'hvac', iconPath: '/symbols/hvac/furnace_heatpump.svg' },
  { category: 'domotica', iconPath: '/symbols/domotica/domotica_icon.svg' },
  { category: 'energyConversion', iconPath: '/symbols/energy-conversion/inverter.svg' },
]

/**
 * Next category filter after a modifier-click on a category shortcut.
 * `only` shows just that category (or clears when it already is the sole filter);
 * `add` toggles it within the current filter.
 */
export function nextLibraryCategoryFilter(
  current: ReadonlySet<string>,
  category: string,
  mode: 'only' | 'add'
): Set<string> {
  if (mode === 'add') {
    const next = new Set(current)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    return next
  }
  return current.size === 1 && current.has(category) ? new Set() : new Set([category])
}

/** The jump category that owns the list position: the last major category at or above `category`. */
export function resolveJumpCategory(categoryOrder: readonly string[], category: string | null): string | null {
  if (!category) return null
  const jumpKeys = new Set<string>(LIBRARY_JUMP_CATEGORIES.map((entry) => entry.category))
  const index = categoryOrder.indexOf(category)
  return (
    categoryOrder
      .slice(0, index + 1)
      .reverse()
      .find((key) => jumpKeys.has(key)) ?? null
  )
}
