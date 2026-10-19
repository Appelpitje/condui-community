export function isKeyboardTypingTarget(target: EventTarget | null): boolean {
  // Popup elements belong to another DOM realm and fail the main window's instanceof checks.
  const element = target as HTMLElement | null
  if (!element || element.nodeType !== 1) return false
  return (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable === true
  )
}
