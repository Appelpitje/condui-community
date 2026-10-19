import { useEffect } from 'react'
import { ensureRoomPlanSupport, useRoomPlanSupport } from '@/lib/native/roomPlanSupport'
import { useTranslation } from 'react-i18next'
import { FloatingControl } from '../canvas/FloatingControls'
import { canOpenRoomPlanScan, openRoomPlanScan } from '@/handlers/plan/roomPlanScan'
import { useUIStore } from '@/stores/uiStore'

export default function RoomPlanScanControl({ enabled = true }: { enabled?: boolean }) {
  const { t } = useTranslation()
  useUIStore((state) => state.activeFloorId)
  const supported = useRoomPlanSupport((state) => state.supported)
  useEffect(() => { void ensureRoomPlanSupport() }, [])

  if (supported !== true || !enabled) return null

  return (
    <>
      <FloatingControl
        icon={
          <svg
            className="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M8 12h8m-4-4v8"
            />
          </svg>
        }
        label={t('nativeRoomScan.start')}
        variant="tool"
        side="left"
        primary
        active
        disabled={!canOpenRoomPlanScan()}
        onClick={() => { openRoomPlanScan() }}
      />
    </>
  )
}
