/** High-resolution milliseconds for throttling, falling back to `Date.now()` without `performance`. */
export function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}
