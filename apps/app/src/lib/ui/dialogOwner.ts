let activeDocument: Document | null = null

/** Capture interaction before React handlers open a shared app dialog. */
export function registerDialogWindow(ownerWindow: Window): () => void {
  const ownerDocument = ownerWindow.document
  const activate = () => {
    activeDocument = ownerDocument
  }
  for (const event of ['pointerdown', 'keydown', 'focusin']) {
    ownerDocument.addEventListener(event, activate, true)
  }
  return () => {
    for (const event of ['pointerdown', 'keydown', 'focusin']) {
      ownerDocument.removeEventListener(event, activate, true)
    }
    if (activeDocument === ownerDocument) activeDocument = null
  }
}

export function getDialogOwnerDocument(): Document | null {
  if (activeDocument?.defaultView && !activeDocument.defaultView.closed) return activeDocument
  return typeof document === 'undefined' ? null : document
}
