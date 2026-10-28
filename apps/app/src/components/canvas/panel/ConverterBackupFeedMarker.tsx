import { useArtworkValue } from '../shared/useArtworkValue'

import { useEffect } from 'react'

import {
  Group,
  Rect,
  Line,
  Image as KonvaImage,
} from 'react-konva'

import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'

import { useThemeColors } from '@/lib/theme/hooks'

import { getConverterBackupFeedMarkerGeometry, type PanelSceneSurface } from '@/lib/panel/panelScene'

import type { ProjectState } from '@/stores/projectStore'

import { getSymbolById } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import {
  CONVERTER_ARTWORK_PATHS,
  getConverterArtworkLayout,
  getConverterCornerPosition,
  getConverterDomainCorner,
  isDirectionalConverterSymbol,
  SUPPLY_ASSEMBLY_CONNECTION_DOMAINS,
} from '@/lib/converterArtwork'

export function ConverterBackupFeedMarker({
  surface,
  debugMode,
}: {
  surface: PanelSceneSurface
  debugMode: boolean
}) {
  const colors = useThemeColors()
  const themeMode = useSettingsStore((state) => state.theme.mode)
  const getTrunkDeviceById = useProjectStore((state: ProjectState) => state.getTrunkDeviceById)
  const converterId = surface.converterBackupSourceFeed?.converterId
  const converter = converterId ? getTrunkDeviceById(converterId)?.device : undefined
  const symbolPath = getSymbolById(converter?.symbol ?? 'inverter')?.svgPath
  const isDirectional = isDirectionalConverterSymbol(converter?.symbol)
  const [symbolImage, setSymbolImage] = useArtworkValue<HTMLImageElement | null>([symbolPath, themeMode], null, !symbolPath)
  const [baseImage, setBaseImage] = useArtworkValue<HTMLImageElement | null>([isDirectional, themeMode], null, !isDirectional)
  const [diagonalImage, setDiagonalImage] = useArtworkValue<HTMLImageElement | null>([isDirectional, themeMode], null, !isDirectional)
  const [acImage, setAcImage] = useArtworkValue<HTMLImageElement | null>([isDirectional, themeMode], null, !isDirectional)
  const [dcImage, setDcImage] = useArtworkValue<HTMLImageElement | null>([isDirectional, themeMode], null, !isDirectional)
  const geometry = getConverterBackupFeedMarkerGeometry(surface)

  useEffect(() => {
    if (!symbolPath) return
    loadProcessedSymbol(symbolPath, themeMode === 'dark')
      .then(setSymbolImage)
      .catch(() => setSymbolImage(null))
  }, [symbolPath, themeMode, setSymbolImage])

  useEffect(() => {
    if (!isDirectional) return
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.base, themeMode === 'dark')
      .then(setBaseImage)
      .catch(() => setBaseImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.diagonal, themeMode === 'dark')
      .then(setDiagonalImage)
      .catch(() => setDiagonalImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.AC, themeMode === 'dark')
      .then(setAcImage)
      .catch(() => setAcImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.DC, themeMode === 'dark')
      .then(setDcImage)
      .catch(() => setDcImage(null))
  }, [isDirectional, themeMode, setBaseImage, setDiagonalImage, setAcImage, setDcImage])

  if (!geometry) return null
  const half = geometry.symbolSize / 2
  return (
    <Group name={`virtual-converter-feed-${surface.panel?.id ?? surface.id}`} listening={false}>
      {geometry.wirePaths.map((points, index) => (
        <Line
          key={`virtual-converter-feed-wire-${index}`}
          points={points}
          stroke={colors.supplyWire}
          strokeWidth={1.5}
          lineCap="square"
          lineJoin="round"
          listening={false}
        />
      ))}
      {isDirectional && baseImage && diagonalImage ? (
        (() => {
          const size = geometry.symbolSize
          const iconSize = size * 0.27
          const layout = getConverterArtworkLayout(
            converter?.symbol === 'inverter' ? 'DC' : 'AC',
            converter?.symbol === 'inverter' ? 'AC' : 'DC',
            SUPPLY_ASSEMBLY_CONNECTION_DOMAINS
          )
          const domainPosition = (domain: 'AC' | 'DC') => {
            const corner = getConverterDomainCorner(layout, domain)
            if (!corner) return undefined
            const point = getConverterCornerPosition(corner, size, size, size * 0.12, iconSize)
            return { x: size / 2 + point.x, y: size / 2 + point.y }
          }
          const acPosition = domainPosition('AC')
          const dcPosition = domainPosition('DC')
          return (
            <>
              <KonvaImage
                image={baseImage}
                x={geometry.sourceX}
                y={geometry.sourceY}
                width={size}
                height={size}
                offsetX={half}
                offsetY={half}
                listening={false}
              />
              <KonvaImage
                image={diagonalImage}
                x={geometry.sourceX}
                y={geometry.sourceY}
                width={size}
                height={size}
                offsetX={half}
                offsetY={half}
                scaleX={layout.diagonal === 'top-left-to-bottom-right' ? -1 : 1}
                listening={false}
              />
              {acImage && acPosition && (
                <KonvaImage
                  image={acImage}
                  x={geometry.sourceX + acPosition.x - iconSize / 2}
                  y={geometry.sourceY + acPosition.y - iconSize / 2}
                  width={iconSize}
                  height={iconSize}
                  listening={false}
                />
              )}
              {dcImage && dcPosition && (
                <KonvaImage
                  image={dcImage}
                  x={geometry.sourceX + dcPosition.x - iconSize / 2}
                  y={geometry.sourceY + dcPosition.y - iconSize / 2}
                  width={iconSize}
                  height={iconSize}
                  listening={false}
                />
              )}
            </>
          )
        })()
      ) : symbolImage ? (
        <KonvaImage
          image={symbolImage}
          x={geometry.sourceX - half}
          y={geometry.sourceY - half}
          width={geometry.symbolSize}
          height={geometry.symbolSize}
          listening={false}
        />
      ) : (
        <>
          <Rect
            x={geometry.sourceX - half}
            y={geometry.sourceY - half}
            width={geometry.symbolSize}
            height={geometry.symbolSize}
            stroke={colors.supplyWire}
            strokeWidth={1.5}
            listening={false}
          />
          <Line
            points={[
              geometry.sourceX - half,
              geometry.sourceY + half,
              geometry.sourceX + half,
              geometry.sourceY - half,
            ]}
            stroke={colors.supplyWire}
            strokeWidth={1.5}
            listening={false}
          />
        </>
      )}
      {debugMode && (
        <Rect
          x={geometry.sourceX - half - 4}
          y={geometry.sourceY - half - 4}
          width={geometry.symbolSize + 8}
          height={geometry.symbolSize + 8}
          stroke="#06b6d4"
          strokeWidth={1}
          dash={[4, 3]}
          listening={false}
        />
      )}
    </Group>
  )
}
