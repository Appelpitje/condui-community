import { LabelPreviewText } from './LabelPreviewText'
import { useCallback, useState } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Rect, Line } from 'react-konva'
import { useUIStore } from '@/stores/uiStore'
import { useClearHover, useSetHover, useSetSelection } from '@/editions/community/communityHooks'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCanvasFontFamily, useEffectiveCanvasZoom } from '@/editions/community/communityHooks'
import {
  EENDRAAD_PANEL_SYMBOL_WIDTH,
  EENDRAAD_PANEL_SYMBOL_HEIGHT,
  EENDRAAD_PANEL_OUTLINE_WIDTH,
  EENDRAAD_PANEL_OUTLINE_HEIGHT,
  PANEL_MAX_CIRCUIT_LINES,
  getEendraadPanelBodyGeometry,
  getEendraadPanelCircuitLineMetrics,
  getRectSelectionOutlineProps,
  getRectHoverOutlineProps,
  getRectHitAreaProps,
  getSymbolColor,
} from './canvasSymbols'
import type { Point } from '@/types/ui'
import type { SymbolLabelDisplayConfig } from '@/types/schema'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: {
    button?: number
    shiftKey?: boolean
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
  }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

interface PanelSymbolProps {
  position: Point
  panelName: string
  subPanelId?: string // If set, symbol is selectable and links to this sub-panel
  circuitCount?: number // Number of circuits in this sub-panel
  symbolLabelDisplay?: SymbolLabelDisplayConfig
  maxLabelWidth?: number
  showName?: boolean
  labelPosition?: 'right' | 'top'
  onDragStart?: (altKey: boolean, evt: MouseEvent) => boolean
  onDragMove?: (position: Point) => void
  onDragEnd?: (position: Point) => boolean | void
  getCanvasPositionFromEvent?: (event: unknown) => Point | null
}

export function PanelSymbol({
  position,
  panelName,
  subPanelId,
  circuitCount = 0,
  maxLabelWidth,
  showName = true,
  labelPosition = 'right',
  onDragStart,
  onDragMove,
  onDragEnd,
  getCanvasPositionFromEvent,
}: PanelSymbolProps) {
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const setSelection = useSetSelection()
  const setHover = useSetHover()
  const clearHover = useClearHover()
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const [isHovered, setIsHovered] = useState(false)
  const isDark = theme?.mode === 'dark'
  const symbolColor = getSymbolColor(isDark)

  // Configuration for circuit indicator lines (from canvasSymbols.ts)
  const lineCount = Math.min(circuitCount, PANEL_MAX_CIRCUIT_LINES)
  const circuitLineMetrics = getEendraadPanelCircuitLineMetrics()
  const panelBodyGeometry = getEendraadPanelBodyGeometry()

  // Selection / hover state (global hover drives frame highlight on eendraad and sitplan)
  const isSelected = useUIStore(
    (s) => !!subPanelId && s.selection.type === 'panel' && s.selection.ids.includes(subPanelId)
  )
  const isHoveredFromBreadcrumb = useUIStore(
    (s) => !!subPanelId && s.hover.type === 'panel' && s.hover.ids.includes(subPanelId)
  )
  const isHoveredAny = isHovered || isHoveredFromBreadcrumb
  const isPanelNameVisible = showName

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true)
    if (subPanelId) setHover({ type: 'panel', ids: [subPanelId] })
  }, [subPanelId, setHover])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
    if (subPanelId) clearHover()
  }, [subPanelId, clearHover])

  const handleClick = useCallback(
    (event: unknown) => {
      if (!subPanelId) return
      const e = event as EendraadPointerEvent
      const eendraWindow = window as WindowWithEendraTapSuppression
      if (eendraWindow.__eendraSuppressNextElementTap) {
        eendraWindow.__eendraSuppressNextElementTap = false
        return
      }
      e.cancelBubble = true

      if (e.evt.button != null && e.evt.button !== 0) return

      if (e.evt.shiftKey) {
        // Shift + Click: Add to selection
        const { selection } = useUIStore.getState()
        if (selection.type === 'panel' && !selection.ids.includes(subPanelId)) {
          setSelection({ type: 'panel', ids: [...selection.ids, subPanelId] })
        } else if (selection.type !== 'panel') {
          setSelection({ type: 'panel', ids: [subPanelId] })
        }
      } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
        // Alt/Ctrl + Click: Remove from selection
        const { selection } = useUIStore.getState()
        if (selection.type === 'panel' && selection.ids.includes(subPanelId)) {
          const newIds = selection.ids.filter((id) => id !== subPanelId)
          if (newIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ type: 'panel', ids: newIds })
          }
        }
      } else {
        // Normal click: Select this panel
        setSelection({ type: 'panel', ids: [subPanelId] })
      }
    },
    [subPanelId, setSelection]
  )

  const isInteractive = !!subPanelId

  // Position panel so it sits on the wire (offsetY positions the center)
  const offsetY = EENDRAAD_PANEL_SYMBOL_HEIGHT / 4

  return (
    <Group
      name={subPanelId ? `panel-attachment-${subPanelId}` : undefined}
      x={position.x}
      y={position.y}
      draggable={isInteractive && isSelected && !!onDragEnd}
      onDragStart={
        isInteractive && isSelected && onDragStart
          ? (event) => {
              const evt = event.evt as MouseEvent
              if (onDragStart(!!evt.altKey, evt)) {
                event.target.stopDrag()
                event.target.position(position)
              }
            }
          : undefined
      }
      onDragMove={
        isInteractive && isSelected && onDragMove
          ? (event) =>
              onDragMove(
                getCanvasPositionFromEvent?.(event) ?? {
                  x: event.target.x(),
                  y: event.target.y(),
                }
              )
          : undefined
      }
      onDragEnd={
        isInteractive && isSelected && onDragEnd
          ? (event) => {
              const accepted = onDragEnd(
                getCanvasPositionFromEvent?.(event) ?? {
                  x: event.target.x(),
                  y: event.target.y(),
                }
              )
              event.target.position(position)
              return accepted
            }
          : undefined
      }
      onClick={isInteractive ? handleClick : undefined}
      onTap={isInteractive ? handleClick : undefined}
      onMouseEnter={isInteractive ? handleMouseEnter : undefined}
      onMouseLeave={isInteractive ? handleMouseLeave : undefined}
    >
      {/* Invisible hit area for hover/click detection */}
      {isInteractive && (
        <Rect
          {...getRectHitAreaProps(
            EENDRAAD_PANEL_OUTLINE_WIDTH,
            EENDRAAD_PANEL_OUTLINE_HEIGHT,
            offsetY
          )}
        />
      )}

      <Rect {...panelBodyGeometry} fill="transparent" stroke={symbolColor} listening={false} />

      {/* Hover highlight */}
      {isHoveredAny && !isSelected && (
        <Rect
          {...getRectHoverOutlineProps(
            canvasZoom,
            EENDRAAD_PANEL_OUTLINE_WIDTH,
            EENDRAAD_PANEL_OUTLINE_HEIGHT,
            offsetY
          )}
        />
      )}
      {/* Selection outline */}
      {isSelected && (
        <Rect
          {...getRectSelectionOutlineProps(
            canvasZoom,
            EENDRAAD_PANEL_OUTLINE_WIDTH,
            EENDRAAD_PANEL_OUTLINE_HEIGHT,
            offsetY
          )}
        />
      )}

      {/* Circuit indicator lines */}
      {lineCount > 0 &&
        Array.from({ length: lineCount }).map((_, i) => {
          // Calculate X position for each line, spread equally across lineSpacing
          const xOffset =
            lineCount === 1 ? 0 : (i / (lineCount - 1) - 0.5) * circuitLineMetrics.lineSpacing

          return (
            <Line
              key={`circuit-line-${i}`}
              points={[
                xOffset,
                circuitLineMetrics.lineStartY,
                xOffset,
                circuitLineMetrics.lineEndY,
              ]}
              stroke={symbolColor}
              strokeWidth={circuitLineMetrics.strokeWidth}
              listening={false}
            />
          )
        })}

      {panelName && isPanelNameVisible && (
        <LabelPreviewText section="panels" maximumWidth={maxLabelWidth}
          x={
            labelPosition === 'top'
              ? -(maxLabelWidth ?? 120) / 2
              : EENDRAAD_PANEL_SYMBOL_WIDTH / 2 + 5
          }
          y={labelPosition === 'top' ? -EENDRAAD_PANEL_SYMBOL_HEIGHT / 2 - 13 : -3}
          width={maxLabelWidth}
          text={panelName}
          fontSize={11}
          lineHeight={1.1}
          wrap={maxLabelWidth != null ? 'char' : 'none'}
          fontFamily={fontFamily}
          fill={symbolColor}
          align={labelPosition === 'top' ? 'center' : 'left'}
          listening={false}
        />
      )}
    </Group>
  )
}
