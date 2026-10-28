import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Floor } from '@/types/schema'

interface CopyFloorPlanSelectionDialogProps {
  currentFloorId: string | null
  floors: Floor[]
  wallCount: number
  stairCount: number
  openingCount: number
  onConfirm: (targetFloorIds: string[], options: { copyOpenings: boolean }) => void
  onCancel: () => void
}

export default function CopyFloorPlanSelectionDialog({
  currentFloorId,
  floors,
  wallCount,
  stairCount,
  openingCount,
  onConfirm,
  onCancel,
}: CopyFloorPlanSelectionDialogProps) {
  const { t } = useTranslation()
  const availableFloors = useMemo(
    () => floors.filter((floor) => floor.id !== currentFloorId),
    [floors, currentFloorId],
  )
  const [selectedFloorIds, setSelectedFloorIds] = useState<string[]>([])
  const [copyOpenings, setCopyOpenings] = useState(true)

  const effectiveOpeningCount = copyOpenings ? openingCount : 0
  const perFloorCount = wallCount + stairCount + effectiveOpeningCount
  const totalCount = perFloorCount * selectedFloorIds.length

  const toggleFloor = (floorId: string) => {
    setSelectedFloorIds((prev) =>
      prev.includes(floorId) ? prev.filter((id) => id !== floorId) : [...prev, floorId],
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t('contextMenu.copyToFloorDescription', 'Choose target floors for the current floor-plan selection.')}
      </p>

      <ul className="space-y-1 max-h-[min(60vh,calc(100vh-18rem))] overflow-y-auto rounded-md border border-gray-200 dark:border-gray-600 p-1">
        {availableFloors.map((floor) => {
          const selected = selectedFloorIds.includes(floor.id)
          return (
            <li key={floor.id}>
              <label
                className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                  selected
                    ? 'bg-sky-100 dark:bg-sky-900/40 border border-sky-300 dark:border-sky-700 ring-1 ring-sky-200 dark:ring-sky-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleFloor(floor.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 text-sky-600 rounded"
                />
                <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-white">
                  {floor.name}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={copyOpenings}
          onChange={(e) => setCopyOpenings(e.target.checked)}
          className="w-4 h-4 text-sky-600 rounded"
        />
        <span>{t('contextMenu.copyOpeningsAlong', 'Copy openings along')}</span>
      </label>

      <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 space-y-1">
        <div>
          {t(
            'contextMenu.copyToFloorSummaryPerFloor',
            '{{walls}} walls, {{stairs}} stairs, {{openings}} openings per floor',
            {
              walls: wallCount,
              stairs: stairCount,
              openings: effectiveOpeningCount,
            },
          )}
        </div>
        <div>
          {t(
            'contextMenu.copyToFloorSummaryTotal',
            'Copying to {{floors}} floor(s): {{total}} items total',
            {
              floors: selectedFloorIds.length,
              total: totalCount,
            },
          )}
        </div>
      </div>

      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(selectedFloorIds, { copyOpenings })}
          disabled={selectedFloorIds.length === 0}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
        >
          {t('common.ok')}
        </button>
      </div>
    </div>
  )
}
