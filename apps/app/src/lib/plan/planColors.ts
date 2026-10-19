import type { CableRouteCategory } from '@/lib/cableRouting/estimateCableRoutes'
import type {
  PlanSymbolColors,
  PlanWireRoute,
  PlanWiringVisibility,
  SymbolKey,
} from '@/types/schema'
import { getSymbolCategory, type SitplanSymbolCategory } from './symbolCategories'

/** Wire colours per circuit group in wire mode (selection stays yellow). */
export const DEFAULT_PLAN_WIRE_COLORS: Record<CableRouteCategory, string> = {
  lighting: '#f97316',
  sockets: '#2563eb',
  // Yellow ochre, so green stays free for earthing (as on the Structural canvas).
  devices: '#c29a2e',
  feeders: '#db2777',
  supply: '#7c3aed',
  // DC and earthing match the Structural canvas.
  dc: '#c54843',
  earthing: '#3d9568',
  other: '#64748b',
}

export const DEFAULT_PLAN_SYMBOL_COLORS: Record<SitplanSymbolCategory, string> = {
  sockets: DEFAULT_PLAN_WIRE_COLORS.sockets,
  lights: DEFAULT_PLAN_WIRE_COLORS.lighting,
  switches: DEFAULT_PLAN_WIRE_COLORS.lighting,
  panels: DEFAULT_PLAN_WIRE_COLORS.feeders,
  fixedAppliances: DEFAULT_PLAN_WIRE_COLORS.devices,
  dc: DEFAULT_PLAN_WIRE_COLORS.dc,
  energyConversion: DEFAULT_PLAN_WIRE_COLORS.supply,
  earthing: DEFAULT_PLAN_WIRE_COLORS.earthing,
  other: DEFAULT_PLAN_WIRE_COLORS.other,
}

export function planCategoryColor(
  category: SitplanSymbolCategory,
  colors?: PlanSymbolColors
): string {
  const value = colors?.[category]
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : DEFAULT_PLAN_SYMBOL_COLORS[category]
}

export function planSymbolColor(
  symbol: SymbolKey | 'earthing' | undefined,
  visibility?: PlanWiringVisibility
): string | undefined {
  if (!visibility?.colorCoded || !symbol) return undefined
  const category = getSymbolCategory(symbol)
  return category ? planCategoryColor(category, visibility.symbolColors) : undefined
}

export function planWireColors(colors?: PlanSymbolColors): Record<CableRouteCategory, string> {
  return {
    ...DEFAULT_PLAN_WIRE_COLORS,
    lighting: planCategoryColor('lights', colors),
    sockets: planCategoryColor('sockets', colors),
    devices: planCategoryColor('fixedAppliances', colors),
    feeders: planCategoryColor('panels', colors),
    dc: planCategoryColor('dc', colors),
    supply: planCategoryColor('energyConversion', colors),
    earthing: planCategoryColor('earthing', colors),
    other: planCategoryColor('other', colors),
  }
}

/** Destination categories also distinguish switches from lamps in mixed lighting runs. */
export function planWireColor(
  route: PlanWireRoute,
  colors?: PlanSymbolColors,
  targetSymbol?: SymbolKey,
  cableCategory?: CableRouteCategory
): string {
  const palette = planWireColors(colors)
  if (cableCategory && ['supply', 'dc', 'earthing'].includes(cableCategory))
    return palette[cableCategory]
  const category = targetSymbol ? getSymbolCategory(targetSymbol) : null
  if (category) return planCategoryColor(category, colors)
  return palette[
    cableCategory ??
      (route.kind === 'lighting-control'
        ? 'lighting'
        : route.kind === 'sockets'
          ? 'sockets'
          : 'other')
  ]
}
