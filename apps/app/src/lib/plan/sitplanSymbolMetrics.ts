import { clamp } from '@/lib/geometry'
import {
  DEFAULT_SYMBOL_SIZE_CM,
  MAX_SYMBOL_SIZE_CM,
  MIN_SYMBOL_SIZE_CM,
  PLAN_LABEL_FONT_SIZE_AT_FALLBACK,
  PLAN_SYMBOL_FALLBACK_PX,
} from '@/constants/planConstants'

export function resolveSitplanSymbolSizeCm(
  floor: { sitplanSymbolSizeCm?: number } | null | undefined,
  uiDefault = DEFAULT_SYMBOL_SIZE_CM,
): number {
  return clamp(floor?.sitplanSymbolSizeCm ?? uiDefault, MIN_SYMBOL_SIZE_CM, MAX_SYMBOL_SIZE_CM)
}

/** Label scale factor vs symbol size (shared with plan canvas rendering). */
export function getSitplanLabelScaleFactor(symbolSizeCm: number): number {
  const cm = clamp(symbolSizeCm, MIN_SYMBOL_SIZE_CM, MAX_SYMBOL_SIZE_CM)
  if (cm <= DEFAULT_SYMBOL_SIZE_CM) {
    return 0.7 + (1.3 - 0.7) * (cm - MIN_SYMBOL_SIZE_CM) / (DEFAULT_SYMBOL_SIZE_CM - MIN_SYMBOL_SIZE_CM)
  }
  return 1.3 + (2.0 - 1.3) * (cm - DEFAULT_SYMBOL_SIZE_CM) / (MAX_SYMBOL_SIZE_CM - DEFAULT_SYMBOL_SIZE_CM)
}

export function sitplanLabelOffsetBelowSymbolCm(symbolSizeCm: number): number {
  return symbolSizeCm * 4
}

export function sitplanLabelFontSizePx(symbolSizePx: number, symbolSizeCm: number): number {
  return (
    PLAN_LABEL_FONT_SIZE_AT_FALLBACK *
    (symbolSizePx / PLAN_SYMBOL_FALLBACK_PX) *
    getSitplanLabelScaleFactor(symbolSizeCm)
  )
}
