import { useState, useCallback } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Rect, Text } from 'react-konva'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  useCanvasFontFamily,
  useEffectiveCanvasZoom,
  useIsTypeAndIdSelected,
  useSetSelection,
} from '@/editions/community/communityHooks'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getSupplySourceSummaryLabel } from '@/lib/electrical/supplyConnection'
import { getInstallationSupplyTransformer } from '@/lib/electrical/supplyTransformer'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { SYMBOL_SIZE, getSymbolColor, getTextColor, GROUND_OUTLINE_SIZE, getSelectionOutlineProps, getHoverOutlineProps, getTouchAwareHitAreaProps } from './canvasSymbols'
import { useTouchPrimaryDevice } from '@/editions/community/communityHooks'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { CatalogSymbolImage } from './CatalogSymbolImage'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: { button?: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

interface SupplySymbolProps {
  x: number
  y: number
  panelId?: string
}

export function SupplySymbol({ x, y, panelId }: SupplySymbolProps) {
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  type ProjectStoreState = ReturnType<typeof useProjectStore.getState>
  const installation = useProjectStore((s: ProjectStoreState) =>
    s.currentProject ? getProjectElectricalInstallation(s.currentProject) : undefined
  )
  const setSelection = useSetSelection()
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const touchPrimary = useTouchPrimaryDevice()
  const [isHovered, setIsHovered] = useState(false)
  const isDark = theme?.mode === 'dark'
  const symbolColor = getSymbolColor(isDark)
  const textColor = getTextColor(isDark)
  const isSelectedByType = useIsTypeAndIdSelected('supply', 'supply')
  const selectedSupplyPanelId = useUIStore((state) => state.selection.supplyPanelId)
  const isSelected = isSelectedByType && (!panelId || selectedSupplyPanelId === panelId)

  const voltageLabel = installation?.nominalVoltage
    ? getSupplySourceSummaryLabel(installation)
    : ''
  const voltageLabelWidth = Math.max(120, measureSymbolLabelTextWidth(voltageLabel, fontFamily, 12) + 6)
  
  // Phase indicator for supply/sitplan symbol: 1, 2, or 3
  const system = installation?.nominalVoltage?.system
  const phaseIndicator =
    installation && getInstallationSupplyTransformer(installation) ? '3' :
      system === '1~' || system === '1N~' ? '1' : system === '2~' ? '2' : '3'
  
  const handleClick = useCallback((event: unknown) => {
    const e = event as EendraadPointerEvent
    const eendraWindow = window as WindowWithEendraTapSuppression
    if (eendraWindow.__eendraSuppressNextElementTap) {
      eendraWindow.__eendraSuppressNextElementTap = false
      return
    }
    e.cancelBubble = true
    
    if (e.evt.button != null && e.evt.button !== 0) {
      return
    }
    
    if (e.evt.shiftKey) {
      // Shift + Click: Add to selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'supply' && !selection.ids.includes('supply')) {
        setSelection({
          type: 'supply',
          ids: [...selection.ids, 'supply'],
          supplyPanelId: panelId,
        })
      } else if (selection.type !== 'supply') {
        setSelection({ type: 'supply', ids: ['supply'], supplyPanelId: panelId })
      }
    } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
      // Alt/Ctrl + Click: Remove from selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'supply' && selection.ids.includes('supply')) {
        useUIStore.getState().clearSelection()
      }
    } else {
      // Normal click: Replace selection
      setSelection({ type: 'supply', ids: ['supply'], supplyPanelId: panelId })
    }
  }, [panelId, setSelection])

  // Same placement as TrunkDeviceSymbol (vertical): offsetY = SYMBOL_SIZE/4 so symbol sits on wire
  const offsetY = SYMBOL_SIZE / 2

  return (
    <Group 
      name="supply-supply" 
      x={x} 
      y={y}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      listening={true}
    >
      {/* Invisible hit area - matches outline size for hover detection */}
      <Rect
        {...getTouchAwareHitAreaProps(
          GROUND_OUTLINE_SIZE,
          canvasZoom,
          isSelected,
          touchPrimary,
        )}
      />
      
      <CatalogSymbolImage
        symbolId="mains"
        width={SYMBOL_SIZE}
        height={SYMBOL_SIZE}
        offsetY={offsetY}
        fallbackStroke={symbolColor}
      />
      
      {/* Phase indicator (1 or 3) - top left corner */}
      <Text
        x={-SYMBOL_SIZE / 2 }
        y={-offsetY -4}
        text={phaseIndicator}
        fontSize={10}
        fontFamily={fontFamily}
        fontStyle="bold"
        fill={textColor}
        listening={false}
      />
      
      {voltageLabel && (
        <Text
          x={-SYMBOL_SIZE / 2 - voltageLabelWidth - 6}
          y={-4}
          width={voltageLabelWidth}
          text={voltageLabel}
          align="right"
          fontSize={12}
          fontFamily={fontFamily}
          fill={textColor}
          listening={false}
        />
      )}
      
      {/* Hover highlight (dashed outline on mouse hover) */}
      {isHovered && !isSelected && (
        <Rect {...getHoverOutlineProps(canvasZoom, GROUND_OUTLINE_SIZE)} />
      )}
      {/* Selection highlight */}
      {isSelected && (
        <Rect {...getSelectionOutlineProps(canvasZoom, GROUND_OUTLINE_SIZE)} />
      )}
    </Group>
  )
}
