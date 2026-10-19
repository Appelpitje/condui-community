import { getSymbolById } from '@/lib/symbols'
import { useTranslation } from 'react-i18next'
import type { RoomPlanGeometryPreview } from '@/lib/plan/roomPlanImport'
import { resolveScanRoomNames } from '@/lib/plan/roomScanRooms'
import { computeOpeningGeometry } from '@/lib/plan/wallOpeningGeometry'

export default function RoomPlanScanPreview({ preview, roomNames }: { preview: RoomPlanGeometryPreview; roomNames?: Record<string, string> }) {
  const { t } = useTranslation()
  const { floorPlan } = preview
  const names = resolveScanRoomNames(preview.rooms, roomNames, (key) => t(key))
  const points = floorPlan.walls.flatMap((wall) => wall.points)
  const minX = Math.min(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const width = Math.max(...points.map((point) => point.x)) - minX
  const height = Math.max(...points.map((point) => point.y)) - minY
  const thicknessPx = (thickness: number) => thickness * preview.pxPerMeter / 100
  const margin = Math.max(width, height, thicknessPx(floorPlan.masterWallThickness)) * 0.08
  const wallById = new Map(floorPlan.walls.map((wall) => [wall.id, wall]))
  return (
    <svg
      role="img"
      aria-label={t('nativeRoomScan.preview')}
      viewBox={`${minX - margin} ${minY - margin} ${width + 2 * margin} ${height + 2 * margin}`}
      className="h-64 w-full rounded-lg bg-white ring-1 ring-slate-200 sm:h-80"
    >
      {floorPlan.walls.map((wall) => (
        <polyline key={wall.id} points={wall.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none" stroke="#475569" strokeWidth={thicknessPx(wall.thickness ?? floorPlan.masterWallThickness)} />
      ))}
      {[...floorPlan.doors, ...floorPlan.windows].map((opening) => {
        const wall = wallById.get(opening.wallId)
        const geometry = wall ? computeOpeningGeometry(wall.points, opening.position) : null
        if (!wall || !geometry) return null
        const { center, tangent } = geometry
        const x1 = center.x - tangent.x * opening.width / 2
        const y1 = center.y - tangent.y * opening.width / 2
        const x2 = center.x + tangent.x * opening.width / 2
        const y2 = center.y + tangent.y * opening.width / 2
        const thickness = thicknessPx(wall.thickness ?? floorPlan.masterWallThickness)
        const isWindow = floorPlan.windows.includes(opening)
        const isPassage = 'isOpening' in opening && opening.isOpening
        return (
          <g key={opening.id}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth={thickness * 1.05} />
            {!isPassage && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isWindow ? '#0284c7' : '#94a3b8'}
              strokeWidth={thickness * 0.2} strokeDasharray={isWindow ? undefined : `${thickness * 0.4} ${thickness * 0.2}`} />}
          </g>
        )
      })}
      {preview.rooms.map((room) => <text key={room.id} x={room.center.x} y={room.center.y}
        textAnchor="middle" dominantBaseline="middle" fontSize={preview.symbolSizePx * 0.7}
        fill="#0f172a" stroke="white" strokeWidth={preview.symbolSizePx * 0.12} paintOrder="stroke">{names[room.id]}</text>)}
      {preview.placements.map((placement) => {
        const size = preview.symbolSizePx
        return <image key={placement.id} href={getSymbolById(placement.symbolId === 'socket_gnd_child' && placement.quantity === 2 ? 'double_socket_gnd_child' : placement.symbolId)?.svgPath}
          x={placement.pos.x - size / 2} y={placement.pos.y - size / 2} width={size} height={size}
          transform={`rotate(${placement.rotationDeg} ${placement.pos.x} ${placement.pos.y})`} />
      })}
    </svg>
  )
}
