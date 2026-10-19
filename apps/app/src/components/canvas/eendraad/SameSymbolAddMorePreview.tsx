import type { SameSymbolAddMoreLayoutTarget } from '@/lib/eendraad/sameSymbolAddMore'
import { getBranchDropPreviewUnit } from '@/lib/layout/branchDropInteraction'
import { getMultiplierBadgeWidth, MULTIPLIER_BADGE_HEIGHT } from '@/lib/eendraad/multiplierBadgeGeometry'
import { getEndpointMultiplier } from '@/utils/endpointMultipliers'
import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { LocalSvgCanvasOverlay } from '../shared/LocalSvgCanvasOverlay'
import { useSettingsStore } from '@/stores/settingsStore'

/** Active multiplication feedback belongs at the count badge, separate from hit acquisition. */
export function SameSymbolAddMorePreview({ target, zoom, increment = 1 }: {
  target: SameSymbolAddMoreLayoutTarget; zoom: number; increment?: number
}) {
  const isDark = useSettingsStore((state) => state.theme.mode === 'dark')
  const count = target.target.endpoint ? getEndpointMultiplier(target.target.endpoint)
    : getSupplyDeviceMultiplier(target.target.trunkDevice)
  const unit = getBranchDropPreviewUnit(zoom)
  const text = `+${increment}`
  const width = Math.max(25, text.length * 12) * unit
  const height = 20 * unit
  const x = target.badgePosition.x + getMultiplierBadgeWidth(count) / 2
  const y = target.badgePosition.y + MULTIPLIER_BADGE_HEIGHT / 2
  return <LocalSvgCanvasOverlay name="same-symbol-add-more-preview" items={[{
    id: `multiply-plus-one-${target.nodeId}`, opacity: 1,
    bounds: { x: x - width / 2 - 2, y: y - height / 2 - 2, width: width + 4, height: height + 4 },
    content: <><rect x={x - width / 2} y={y - height / 2} width={width} height={height}
      rx={2 * unit} fill={isDark ? '#1f2937' : '#ffffff'} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
      fontSize={18 * unit} fontWeight="bold" fontFamily="Arial, sans-serif"
      fill="#0284c7">{text}</text></>,
  }]} />
}
