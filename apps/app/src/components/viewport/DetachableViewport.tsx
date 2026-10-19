import type { DockablePanelOption } from '@/components/panels/DockablePanelShell'
/* eslint react-refresh/only-export-components: off -- Window controller and pane wrapper share one context. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ViewportContext } from './ViewportContext'
import { ViewportUIProvider, getViewportPanelUI } from './ViewportUIStore'
import { ViewportGrid } from './ViewportGrid'
import { ViewportWindowProvider, createViewportWindowStore } from './ViewportWindowStore'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import type { CanvasType } from '@/types/ui'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { PopupEditorShell, type PopupComments } from './PopupEditorShell'
import { registerDialogWindow } from '@/lib/ui/dialogOwner'
import { closeDialogForDocument } from '@/stores/dialogStore'

const OpenWindowContext = createContext<(canvas: CanvasType, panelIndex: number) => void>(() => {})
type PopupSession = ReturnType<typeof createViewportWindowStore> & {
  id: number
  getWindow: () => Window
}

/** The window sessions live above the main grid, so changing that grid never owns their lifetime. */
export function ViewportWindows({
  children,
  renderPanel,
  capabilities,
  popupComments,
  popupPanelOptions,
}: {
  children: ReactNode
  renderPanel: (panelIndex: number, canvas: CanvasType) => ReactNode
  capabilities?: EditorCapabilities
  popupComments?: PopupComments
  popupPanelOptions?: DockablePanelOption[]
}) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<PopupSession[]>([])
  const [blocked, setBlocked] = useState(false)
  const opened = useRef(new Set<Window>())
  const nextId = useRef(0)
  const openWindow = useCallback((canvas: CanvasType, panelIndex: number) => {
    const popup = window.open('/detached-canvas.html', '', 'popup,width=1200,height=800')
    if (!popup) {
      setBlocked(true)
      return
    }
    setBlocked(false)
    opened.current.add(popup)
    const id = ++nextId.current
    const session = createViewportWindowStore(
      canvas,
      getViewportPanelUI(document, panelIndex)?.getState()
    )
    popup.addEventListener(
      'load',
      () => {
        if (!opened.current.has(popup) || popup.closed) return
        popup.document.title = `Condui · ${id}`
        setSessions((current) => [...current, { ...session, id, getWindow: () => popup }])
        popup.focus()
      },
      { once: true }
    )
  }, [])
  const closeSession = useCallback((session: PopupSession) => {
    const popup = session.getWindow()
    opened.current.delete(popup)
    setSessions((current) => current.filter((item) => item.id !== session.id))
    if (!popup.closed) popup.close()
  }, [])
  useEffect(() => {
    const windows = opened.current
    const closeAll = () => {
      for (const popup of windows) popup.close()
      windows.clear()
    }
    window.addEventListener('pagehide', closeAll)
    return () => {
      window.removeEventListener('pagehide', closeAll)
      closeAll()
    }
  }, [])
  return (
    <OpenWindowContext.Provider value={openWindow}>
      {children}
      {blocked && (
        <div
          role="status"
          className="absolute bottom-16 right-4 z-[70] max-w-xs rounded bg-gray-900 p-3 text-sm text-white"
          onClick={() => setBlocked(false)}
        >
          {t('canvas.popupBlocked')}
        </div>
      )}
      {sessions.map((session) => (
        <PopupWorkspace
          key={session.id}
          session={session}
          closeSession={closeSession}
          renderPanel={renderPanel}
          capabilities={capabilities}
          popupComments={popupComments}
          popupPanelOptions={popupPanelOptions}
        />
      ))}
    </OpenWindowContext.Provider>
  )
}

function PopupWorkspace({
  session,
  closeSession,
  renderPanel,
  capabilities,
  popupComments,
  popupPanelOptions,
}: {
  session: PopupSession
  closeSession: (session: PopupSession) => void
  renderPanel: (panelIndex: number, canvas: CanvasType) => ReactNode
  capabilities?: EditorCapabilities
  popupComments?: PopupComments
  popupPanelOptions?: DockablePanelOption[]
}) {
  const popup = session.getWindow()
  const [container] = useState(() => {
    const element = popup.document.createElement('div')
    element.className = 'relative h-full w-full'
    return element
  })
  useEffect(() => session.connect(), [session])
  useLayoutEffect(() => {
    const unregisterDialogs = registerDialogWindow(popup)
    popup.document.body.appendChild(container)
    const syncTheme = () => {
      for (const attr of ['class', 'style', 'lang', 'dir']) {
        const value = document.documentElement.getAttribute(attr)
        if (value === null) popup.document.documentElement.removeAttribute(attr)
        else popup.document.documentElement.setAttribute(attr, value)
      }
      popup.document.body.className = document.body.className
    }
    const syncStyles = () => {
      popup.document.head.querySelectorAll('[data-detached-style]').forEach((node) => node.remove())
      document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        const clone = node.cloneNode(true) as HTMLElement
        clone.setAttribute('data-detached-style', '')
        if (node instanceof HTMLLinkElement) (clone as HTMLLinkElement).href = node.href
        popup.document.head.appendChild(clone)
      })
    }
    syncTheme()
    syncStyles()
    const themeObserver = new MutationObserver(syncTheme)
    themeObserver.observe(document.documentElement, { attributes: true })
    const styleObserver = new MutationObserver(syncStyles)
    styleObserver.observe(document.head, { childList: true, subtree: true, characterData: true })
    const onClose = () => closeSession(session)
    popup.addEventListener('pagehide', onClose)
    const closedCheck = window.setInterval(() => {
      if (popup.closed) onClose()
    }, 500)
    return () => {
      closeDialogForDocument(popup.document)
      unregisterDialogs()
      themeObserver.disconnect()
      styleObserver.disconnect()
      window.clearInterval(closedCheck)
      popup.removeEventListener('pagehide', onClose)
      container.remove()
    }
  }, [popup, container, closeSession, session])
  const context = useMemo(
    () => ({
      panelIndex: 0,
      getOwnerWindow: session.getWindow,
      detached: true,
      toggleDetached: () => closeSession(session),
    }),
    [closeSession, session]
  )
  return createPortal(
    <ViewportWindowProvider store={session.store}>
      <PopupShortcuts capabilities={capabilities} getWindow={session.getWindow} />
      <ViewportContext.Provider value={context}>
        <PopupEditorShell
          capabilities={capabilities}
          comments={popupComments}
          panelOptions={popupPanelOptions}
        >
          <ViewportGrid
            renderPanel={(index, type) => (
              <ViewportContext.Provider value={{ ...context, panelIndex: index }}>
                <ViewportUIProvider>{renderPanel(index, type)}</ViewportUIProvider>
              </ViewportContext.Provider>
            )}
          />
        </PopupEditorShell>
      </ViewportContext.Provider>
    </ViewportWindowProvider>,
    container
  )
}

function PopupShortcuts({
  capabilities,
  getWindow,
}: {
  capabilities?: EditorCapabilities
  getWindow: () => Window
}) {
  useKeyboardShortcuts({ targetWindow: getWindow(), capabilities })
  return null
}

/** Opening a second view leaves this canvas usable in the main window. */
export function DetachableViewport({
  panelIndex,
  canvas,
  renderPanel,
}: {
  panelIndex: number
  canvas: CanvasType
  renderPanel: (panelIndex: number, canvas: CanvasType) => ReactNode
  capabilities?: EditorCapabilities
}) {
  const openWindow = useContext(OpenWindowContext)
  const context = useMemo(
    () => ({
      panelIndex,
      getOwnerWindow: () => window,
      detached: false,
      toggleDetached: () => openWindow(canvas, panelIndex),
    }),
    [panelIndex, canvas, openWindow]
  )
  return (
    <ViewportContext.Provider value={context}>
      <ViewportUIProvider>{renderPanel(panelIndex, canvas)}</ViewportUIProvider>
    </ViewportContext.Provider>
  )
}
