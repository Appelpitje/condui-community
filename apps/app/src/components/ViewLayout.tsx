import type { DockablePanelOption } from '@/components/panels/DockablePanelShell'
import { useEffect } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { DetachableViewport, ViewportWindows } from './viewport/DetachableViewport'
import { ViewportGrid } from './viewport/ViewportGrid'
import { ViewportPanel } from './viewport/ViewportPanel'
import { JunctionEditorHost } from '@/components/junctionEditor/junctionEditorHostedFeatures'
import type { EditorCapabilities } from '@/lib/viewerMode'
import type { CanvasType } from '@/types/ui'
import type { PopupComments } from './viewport/PopupEditorShell'

export default function ViewLayout({
  capabilities,
  compact = false,
  compactOrientation = 'portrait',
  onCompactAuxPanelVisibilityChange,
  popupComments,
  popupPanelOptions,
  ...insets
}: {
  leftInsetPx?: number
  rightInsetPx?: number
  bottomInsetPx?: number
  resizePreviewActive?: boolean
  capabilities?: EditorCapabilities
  compact?: boolean
  compactOrientation?: 'portrait' | 'landscape'
  onCompactAuxPanelVisibilityChange?: (visible: boolean) => void
  popupComments?: PopupComments
  popupPanelOptions?: DockablePanelOption[]
}) {
  const projectId = useProjectStore((s) => s.currentProject?.project.id ?? null)
  const layout = useUIStore((s) => s.viewportLayout)
  useEffect(() => {
    useUIStore.getState().setLastInteractedCanvas(null)
  }, [projectId])
  useEffect(() => {
    const compactAllowed =
      compactOrientation === 'portrait'
        ? layout.preset === 'stacked' && layout.panels.length >= 2
        : layout.preset === 'sideBySide' && layout.panels.length >= 2
    const panels = compact && !compactAllowed ? layout.panels.slice(0, 1) : layout.panels
    useUIStore.getState().setRenderedCanvases(panels.map((panel) => panel.canvas))
  }, [layout, compact, compactOrientation])
  useEffect(() => () => useUIStore.getState().setRenderedCanvases(null), [])
  const renderPanel = (index: number, type: CanvasType) => (
    <ViewportPanel
      panelIndex={index}
      type={type}
      capabilities={capabilities}
      compact={compact}
      compactOrientation={compactOrientation}
      onCompactAuxPanelVisibilityChange={onCompactAuxPanelVisibilityChange}
    />
  )
  return (
    <ViewportWindows
      key={projectId}
      renderPanel={renderPanel}
      capabilities={capabilities}
      popupComments={popupComments}
      popupPanelOptions={popupPanelOptions}
    >
      <ViewportGrid
        {...insets}
        compact={compact}
        compactOrientation={compactOrientation}
        renderPanel={(panelIndex, canvas) => (
          <DetachableViewport
            panelIndex={panelIndex}
            canvas={canvas}
            capabilities={capabilities}
            renderPanel={renderPanel}
          />
        )}
      >
        <JunctionEditorHost />
      </ViewportGrid>
    </ViewportWindows>
  )
}
