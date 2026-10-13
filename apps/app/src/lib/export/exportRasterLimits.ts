/** About 300 dpi across an A3 page; more resolution does not show in print. */
export const MAX_EXPORT_RASTER_EDGE = 5000
/** Below Safari's canvas limit on iPhone and iPad (16,777,216 pixels). */
export const MAX_EXPORT_RASTER_PIXELS = 16_000_000

/** Downscale factor (at most 1) that keeps an exported bitmap within print resolution. */
export function exportRasterScale(width: number, height: number): number {
  return Math.min(
    1,
    MAX_EXPORT_RASTER_EDGE / Math.max(width, height),
    Math.sqrt(MAX_EXPORT_RASTER_PIXELS / (width * height))
  )
}
