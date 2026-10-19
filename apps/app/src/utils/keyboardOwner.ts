/**
 * Floating editors that sit over the canvases (the junction editor) own the keyboard while the
 * pointer is over them or focus is inside them. The canvases listen for keys on the window in
 * the capture phase and registered first, so they check this and leave those keys alone.
 */
export const KEYBOARD_OWNER_ATTRIBUTE = 'data-keyboard-owner'

export function isKeyboardOwnedByFloatingEditor(): boolean {
  if (typeof document === 'undefined') return false
  for (const element of document.querySelectorAll(`[${KEYBOARD_OWNER_ATTRIBUTE}]`)) {
    if (element.matches(':hover') || element.contains(document.activeElement)) return true
  }
  return false
}
