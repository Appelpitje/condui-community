/** Suppress the synthetic Konva element tap after an owned touch interaction. */
export function suppressNextCanvasElementTap(targetWindow: Window): void {
  const tapWindow = targetWindow as Window & { __eendraSuppressNextElementTap?: boolean }
  tapWindow.__eendraSuppressNextElementTap = true
}
