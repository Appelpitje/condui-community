import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useViewportWindowStore } from './ViewportWindowStore'
import { ResizableDivider } from '@/components/layout/ResizableDivider'
import { ViewportResizePreviewProvider } from '@/components/layout/ViewportResizePreviewContext'
import { VIEWPORT_RATIO_MIN, VIEWPORT_RATIO_MAX } from '@/constants/layoutConstants'
import { clamp } from '@/lib/geometry'
import {
  getViewportPanelZones,
  getViewportDividerSpecs,
} from '@/components/layout/viewportGeometry'
import type { CanvasType, ViewportLayout } from '@/types/ui'

export function ViewportGrid({
  leftInsetPx = 0,
  rightInsetPx = 0,
  bottomInsetPx = 0,
  resizePreviewActive = false,
  renderPanel,
  layoutOverride,
  children,
  compact = false,
  compactOrientation = 'portrait',
}: {
  leftInsetPx?: number
  rightInsetPx?: number
  bottomInsetPx?: number
  resizePreviewActive?: boolean
  renderPanel: (panelIndex: number, type: CanvasType) => ReactNode
  layoutOverride?: ViewportLayout
  children?: ReactNode
  compact?: boolean
  compactOrientation?: 'portrait' | 'landscape'
}) {
  const windowLayout = useViewportWindowStore((s) => s.viewportLayout)
  const layout = layoutOverride ?? windowLayout
  const setLayoutPrimaryRatio = useViewportWindowStore((s) => s.setLayoutPrimaryRatio)
  const setLayoutSecondaryRatio = useViewportWindowStore((s) => s.setLayoutSecondaryRatio)
  const [previewRatios, setPreviewRatios] = useState<{ primary: number; secondary: number } | null>(
    null
  )
  const primaryRatio = previewRatios?.primary ?? layout.primaryRatio
  const secondaryRatio = previewRatios?.secondary ?? layout.secondaryRatio
  const layoutForRender = useMemo(() => {
    const sizedLayout = {
      ...layout,
      primaryRatio,
      secondaryRatio,
    }
    if (!compact) return sizedLayout
    const compactPresetAllowed =
      compactOrientation === 'portrait'
        ? sizedLayout.preset === 'stacked' && sizedLayout.panels.length >= 2
        : sizedLayout.preset === 'sideBySide' && sizedLayout.panels.length >= 2
    if (compactPresetAllowed) return sizedLayout
    return {
      preset: 'single' as const,
      panels: [sizedLayout.panels[0] ?? { canvas: 'eendraad' as const }],
      primaryRatio: 1,
      secondaryRatio: 0.5,
      focusReturnLayout: null,
    }
  }, [compact, compactOrientation, layout, primaryRatio, secondaryRatio])
  const panelZones = useMemo(() => getViewportPanelZones(layoutForRender), [layoutForRender])
  const dividerSpecs = useMemo(() => getViewportDividerSpecs(layoutForRender), [layoutForRender])

  useEffect(() => {
    setPreviewRatios(null)
  }, [layout.preset, layout.panels, layout.primaryRatio, layout.secondaryRatio])

  const viewportResizePreviewActive = previewRatios != null || resizePreviewActive

  return (
    <ViewportResizePreviewProvider active={viewportResizePreviewActive}>
      <div className="flex flex-col h-full">
        <div className="relative flex-1 overflow-hidden">
          <div
            className="absolute inset-y-0"
            data-viewport-content
            style={{
              left: `${leftInsetPx}px`,
              right: `${rightInsetPx}px`,
              bottom: `${bottomInsetPx}px`,
            }}
          >
            {panelZones.map((slot) => {
              const r = slot.rect
              return (
                <div
                  key={layoutForRender.focusedPanelIndex ?? slot.panelIndex}
                  className="absolute overflow-hidden"
                  data-viewport-slot={slot.panelIndex}
                  style={{
                    left: `${r.left * 100}%`,
                    top: `${r.top * 100}%`,
                    width: `${r.width * 100}%`,
                    height: `${r.height * 100}%`,
                  }}
                >
                  {renderPanel(slot.panelIndex, slot.type)}
                </div>
              )
            })}
            {children}
            <div className="pointer-events-none absolute inset-0" style={{ zIndex: 41 }}>
              {dividerSpecs.map((spec, i) => (
                <ResizableDivider
                  key={`${spec.ratioKey}-${spec.direction}-${i}`}
                  direction={spec.direction}
                  startRatio={spec.ratioKey === 'primary' ? primaryRatio : secondaryRatio}
                  onDragStart={() => {
                    setPreviewRatios({
                      primary: layout.primaryRatio,
                      secondary: layout.secondaryRatio,
                    })
                  }}
                  onRatioChange={(nextRatio) => {
                    setPreviewRatios((current) => {
                      const base = current ?? {
                        primary: layout.primaryRatio,
                        secondary: layout.secondaryRatio,
                      }
                      if (spec.ratioKey === 'primary') {
                        return {
                          ...base,
                          primary: clamp(nextRatio, VIEWPORT_RATIO_MIN, VIEWPORT_RATIO_MAX),
                        }
                      }
                      return {
                        ...base,
                        secondary: Math.max(
                          VIEWPORT_RATIO_MIN,
                          Math.min(VIEWPORT_RATIO_MAX, nextRatio)
                        ),
                      }
                    })
                  }}
                  onDragEnd={(nextRatio) => {
                    if (spec.ratioKey === 'primary') {
                      setLayoutPrimaryRatio(nextRatio)
                    } else {
                      setLayoutSecondaryRatio(nextRatio)
                    }
                    setPreviewRatios(null)
                  }}
                  ratio={spec.ratio}
                  heightFraction={spec.heightFraction}
                  topFraction={spec.topFraction}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ViewportResizePreviewProvider>
  )
}
