import { updateDoorProperties, updateWindowProperties } from '@/handlers/properties/editGeneralProperties'
import { useTranslation } from 'react-i18next'
import { DebouncedNumberInput } from '@/components/forms'
import CustomDropdown from '@/components/common/CustomDropdown'
import { InsertDoorIcon, SectionalGateIcon } from '@/components/icons/UiIcons'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { usePlanGrid, resolvePlanCanvasPxPerMeter } from '@/hooks/plan'
import type { Door, Window, Floor } from '@/types/schema'
import { clamp } from '@/lib/geometry'

interface OpeningPropertiesProps {
  opening: Door | Window
  kind: 'door' | 'window'
  floor: Floor | null
}

export function OpeningProperties({ opening, kind, floor }: OpeningPropertiesProps) {
  const { t } = useTranslation()
  const planView = useUIStore((s: UIState) => s.planView)
  const gridSize = usePlanGrid(floor, planView, true)

  const canvasPxPerMeter = resolvePlanCanvasPxPerMeter(
    floor,
    planView.gridSize,
    gridSize,
  )
  const widthCm = (opening.width / canvasPxPerMeter) * 100

  const handleWidthCommit = (value: number) => {
    const widthPx = (value / 100) * canvasPxPerMeter
    if (kind === 'door') {
      updateDoorProperties(opening.id, { width: widthPx })
    } else {
      updateWindowProperties(opening.id, { width: widthPx })
    }
  }

  const handleSwingAngleCommit = (value: number) => {
    if (kind !== 'door') return
    const clamped = clamp(value, 1, 100)
    updateDoorProperties(opening.id, { swingAngleDeg: clamped })
  }
  const handleSwingChange = (value: string) => {
    if (kind !== 'door') return
    const swing: Door['swing'] =
      value === 'left' || value === 'right' || value === 'none' || value === 'double'
        ? value
        : 'right'
    updateDoorProperties(opening.id, { swing })
  }

  const handleDirectionChange = (nextValue: string) => {
    if (kind !== 'door') return
    const value = nextValue === 'out' ? 'out' : 'in'
    updateDoorProperties(opening.id, { direction: value })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
        {kind === 'door'
          ? (t('plan.doorProperties', 'Door') as string)
          : (t('plan.windowProperties', 'Window') as string)}
      </h3>
      {kind === 'door' && (
        <div className="grid grid-cols-2 gap-2">
          {(['door', 'gate'] as const).map((preset) => {
            const isGate = (opening as Door).swing === 'none'
            const selected = preset === 'gate' ? isGate : !isGate
            const Icon = preset === 'door' ? InsertDoorIcon : SectionalGateIcon
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (!selected) handleSwingChange(preset === 'gate' ? 'none' : 'right')
                }}
                className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-md border-2 px-2 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900 ${
                  selected
                    ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                    : 'border-gray-300 text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:text-gray-300'
                }`}
              >
                <Icon className="h-8 w-8" />
                {preset === 'door' ? t('plan.doorProperties', 'Door') : t('plan.gatePreset', 'Gate')}
              </button>
            )
          })}
        </div>
      )}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('plan.openingWidth', 'Width')}
          {` (${t('plan.cm', 'cm')})`}
        </label>
        <DebouncedNumberInput
          type="number"
          min={1}
          step={1}
          value={Math.round(widthCm * 10) / 10}
          minValue={1}
          fallbackValue={Math.round(widthCm * 10) / 10}
          onCommit={handleWidthCommit}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
      </div>

      {kind === 'door' && (
        <>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('plan.doorHinge', 'Hinge')}
            </label>
            <CustomDropdown
              value={(opening as Door).swing ?? 'right'}
              onChange={handleSwingChange}
              options={[
                { value: 'left', label: t('plan.doorHingeLeft', 'Left') },
                { value: 'right', label: t('plan.doorHingeRight', 'Right') },
                { value: 'none', label: t('plan.doorHingeNone', 'None') },
                { value: 'double', label: t('plan.doorHingeDouble', 'Double') },
              ]}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('plan.doorOpening', 'Opening')}
            </label>
            <CustomDropdown
              value={(opening as Door).direction ?? 'out'}
              onChange={handleDirectionChange}
              options={[
                { value: 'in', label: t('plan.doorOpeningIn', 'In') },
                { value: 'out', label: t('plan.doorOpeningOut', 'Out') },
              ]}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('plan.doorOpeningAngle', 'Opening angle (deg)')}
            </label>
            <DebouncedNumberInput
              type="number"
              min={1}
              max={180}
              step={1}
              value={
                (opening as Door).swingAngleDeg != null
                  ? (opening as Door).swingAngleDeg!
                  : 35
              }
              minValue={1}
              maxValue={100}
              fallbackValue={(opening as Door).swingAngleDeg ?? 35}
              onCommit={handleSwingAngleCommit}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </>
      )}
    </div>
  )
}
