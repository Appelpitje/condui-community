import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Group, Layer, Stage } from 'react-konva'
import { useTranslation } from 'react-i18next'
import type { LabelScheme, Panel, ProtectionDevice } from '@/types/schema'
import { CanvasOverlayScaleProvider } from '@/contexts/CanvasOverlayScaleContext'
import { EendraadWireSegmentsContext } from '@/contexts/EendraadWireSegmentsContext'
import {
  getCachedEendraadLayout,
  getCachedEendraadWireSegments,
  getCachedLayoutTree,
} from '@/lib/layout/eendraadDerivedLayout'
import { builtInLabelScheme } from '@/lib/eendraad/labelScheme'
import { getPanelDiagramId } from '@/lib/layout/bottomUpLayout'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { useSettingsStore } from '@/stores/settingsStore'
import { WireSegments } from '../WireSegment'
import RenderNode from './RenderNode'
import { OneWireRenderProjectContext } from './oneWireRenderProject'
import { getLabelSchemeSampleProject, labelSchemePreviewProject } from './labelSchemePreviewProject'

const NO_LAYOUT_OVERRIDES = new Map()
const MARGIN = 16
/** Room around the circuits for labels drawn outside their nodes. */
const FRAME_CONTENT_PADDING = 48
const PANEL_GAP = 24

/** Right and bottom edge of everything drawn inside a panel node. */
function descendantBounds(node: LayoutNode): { right: number; bottom: number } | null {
  let right = -Infinity
  let bottom = -Infinity
  const visit = (current: LayoutNode) => {
    for (const child of current.children) {
      right = Math.max(right, child.bounds.x + child.bounds.width)
      bottom = Math.max(bottom, child.bounds.y + child.bounds.height)
      visit(child)
    }
  }
  visit(node)
  return Number.isFinite(right) ? { right, bottom } : null
}

function flattenPanels(panels: readonly Panel[]): Panel[] {
  return panels.flatMap((panel) => [panel, ...flattenPanels(panel.subPanels ?? [])])
}

interface LabelSchemePreviewProps {
  scheme: LabelScheme
  panelNumberingEnabled: boolean
  hideFeederLetters: boolean
  advancedPanelLabels: boolean
  accessProjectId: string | null
}

/** Read-only one-wire of a small fixed project, labelled with the draft scheme. */
export function LabelSchemePreview({
  scheme,
  panelNumberingEnabled,
  hideFeederLetters,
  advancedPanelLabels,
  accessProjectId,
}: LabelSchemePreviewProps) {
  const { t, i18n } = useTranslation()
  const isDark = useSettingsStore((state) => state.theme.mode === 'dark')
  const containerRef = useRef<HTMLDivElement>(null)
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    // The parent owns the viewport size; canvas content never sizes the dialog.
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const project = useMemo(
    () =>
      labelSchemePreviewProject(getLabelSchemeSampleProject(i18n.language), scheme, {
        panelNumberingEnabled,
        hideFeederLetters,
      }),
    [i18n.language, scheme, panelNumberingEnabled, hideFeederLetters]
  )
  const referenceDrawing = useMemo(() => {
    // Numbered labels reserve room in this fixed sample. Editing the scheme must never
    // reflow its symbols, resize its frames or change the camera fit.
    const reference = labelSchemePreviewProject(
      getLabelSchemeSampleProject(i18n.language),
      builtInLabelScheme('panel-dot-circuit'),
      {
        panelNumberingEnabled: true,
        hideFeederLetters,
      }
    )
    const layout = getCachedEendraadLayout(reference, NO_LAYOUT_OVERRIDES, {
      infoBlockLogo: false,
      compactSubPanelFeed: true,
    })
    const layoutTree = getCachedLayoutTree(layout)
    const wireSegments = getCachedEendraadWireSegments(reference, layoutTree)
    // Frames shrink to their circuits (the title block is hidden) and stack top to bottom, so the
    // drawing can use the dialog's full width.
    let cursorY = 0
    let width = 0
    const panels = []
    for (const panelLayout of layout.panels) {
      const diagramId = getPanelDiagramId(panelLayout)
      const node = layoutTree.panels.find((candidate) => candidate.diagramId === diagramId)
      if (!node) continue
      const { frame } = panelLayout
      const content = descendantBounds(node)
      const trimmed = content
        ? {
            ...frame,
            width: Math.min(frame.width, content.right + FRAME_CONTENT_PADDING - frame.x),
            height: Math.min(frame.height, content.bottom + FRAME_CONTENT_PADDING - frame.y),
          }
        : frame
      const offset = { x: -frame.x, y: cursorY - frame.y }
      cursorY += trimmed.height + PANEL_GAP
      width = Math.max(width, trimmed.width)
      panels.push({
        diagramId,
        offset,
        panelLayout: { ...panelLayout, frame: trimmed },
        node: { ...node, bounds: trimmed },
      })
    }
    return {
      panels,
      wireSegments,
      bounds: { width: Math.max(1, width), height: Math.max(1, cursorY - PANEL_GAP) },
    }
  }, [i18n.language, hideFeederLetters])

  const drawing = useMemo(() => {
    const layout = getCachedEendraadLayout(project, NO_LAYOUT_OVERRIDES, {
      infoBlockLogo: false,
      compactSubPanelFeed: true,
    })
    const tree = getCachedLayoutTree(layout)
    return {
      ...referenceDrawing,
      panels: referenceDrawing.panels.map((fixed) => {
        const currentPanel = tree.panels.find((node) => node.diagramId === fixed.diagramId)
        const currentNodes = new Map<string, LayoutNode>()
        const index = (node: LayoutNode) => {
          currentNodes.set(node.id, node)
          node.children.forEach(index)
        }
        if (currentPanel) index(currentPanel)
        const relabel = (node: LayoutNode): LayoutNode => {
          const current = currentNodes.get(node.id)
          return {
            ...node,
            domainRef: current?.domainRef ?? node.domainRef,
            visual:
              node.visual?.type === 'label' && current?.visual?.type === 'label'
                ? { ...node.visual, text: current.visual.text }
                : node.visual,
            children: node.children.map(relabel),
          }
        }
        return { ...fixed, node: relabel(fixed.node) }
      }),
    }
  }, [project, referenceDrawing])

  const lookups = useMemo(() => {
    const panels = flattenPanels(getProjectElectricalPanels(project))
    const protections = new Map<string, ProtectionDevice>()
    for (const panel of panels)
      for (const protection of panel.protections) protections.set(protection.id, protection)
    const panelsById = new Map(panels.map((panel) => [panel.id, panel]))
    return {
      getProtectionById: (id: string) => protections.get(id),
      getPanelById: (id: string) => panelsById.get(id),
    }
  }, [project])

  const renderProject = useMemo(
    () => ({ project, accessProjectId, hideInfoBlock: true }),
    [project, accessProjectId]
  )
  const { bounds } = drawing
  const scale =
    width > MARGIN * 2 && height > MARGIN * 2
      ? Math.min((width - MARGIN * 2) / bounds.width, (height - MARGIN * 2) / bounds.height)
      : 0

  return (
    <div
      ref={containerRef}
      data-testid="label-scheme-preview"
      className={`relative h-full w-full overflow-hidden rounded-md border ${
        isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-white'
      }`}
    >
      {scale > 0 ? (
        <OneWireRenderProjectContext.Provider value={renderProject}>
          <EendraadWireSegmentsContext.Provider value={drawing.wireSegments}>
            <CanvasOverlayScaleProvider containerRef={containerRef}>
              <Stage className="absolute inset-0" width={width} height={height} listening={false}>
                <Layer
                  listening={false}
                  x={Math.max(MARGIN, (width - bounds.width * scale) / 2)}
                  y={Math.max(MARGIN, (height - bounds.height * scale) / 2)}
                  scaleX={scale}
                  scaleY={scale}
                >
                  {drawing.panels.map(({ diagramId, offset, panelLayout, node }) => (
                    <Group key={diagramId} x={offset.x} y={offset.y}>
                      <WireSegments
                        panelId={panelLayout.panel.id}
                        diagramId={diagramId}
                        wireSegments={drawing.wireSegments}
                      />
                      <RenderNode
                        node={node}
                        translate={t}
                        advancedPanelLabels={advancedPanelLabels}
                        panelLayout={panelLayout}
                        getProtectionById={lookups.getProtectionById}
                        getPanelById={lookups.getPanelById}
                      />
                    </Group>
                  ))}
                </Layer>
              </Stage>
            </CanvasOverlayScaleProvider>
          </EendraadWireSegmentsContext.Provider>
        </OneWireRenderProjectContext.Provider>
      ) : null}
    </div>
  )
}
