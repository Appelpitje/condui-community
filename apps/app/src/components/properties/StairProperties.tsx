import { updateStairProperties } from '@/handlers/properties/editGeneralProperties'
import { useTranslation } from 'react-i18next'
import { useUIStore, type UIState } from '@/stores/uiStore'
import CustomDropdown from '@/components/common/CustomDropdown'
import { DebouncedNumberInput } from '@/components/forms'
import { resolvePlanCanvasPxPerMeter, usePlanGrid } from '@/hooks/plan'
import {
  isSpiralStair,
  stairCanvasUnitsToCentimeters,
  stairCentimetersToCanvasUnits,
} from '@/lib/plan/stairPlanScale'
import type { Floor, Stair, StairCornerMode } from '@/types/schema'
import { StairUpArrowDirectionPicker } from './StairUpArrowDirectionPicker'

interface StairPropertiesProps {
  stair: Stair
  floor: Floor
  selectedPointIndices?: number[]
}

export function StairProperties({ stair, floor, selectedPointIndices = [] }: StairPropertiesProps) {
  const { t } = useTranslation()
  const planView = useUIStore((s: UIState) => s.planView)
  const gridSize = usePlanGrid(floor, planView, true)
  const canvasPxPerMeter = resolvePlanCanvasPxPerMeter(
    floor,
    planView.gridSize,
    gridSize,
  )
  const widthCm = stairCanvasUnitsToCentimeters(stair.width, canvasPxPerMeter)
  const stepDepthCm = stairCanvasUnitsToCentimeters(stair.stepDepth, canvasPxPerMeter)
  const validSelectedPointIndices = Array.from(
    new Set(
      selectedPointIndices.filter(
        (pointIndex) => Number.isInteger(pointIndex) && pointIndex >= 0 && pointIndex < stair.points.length,
      ),
    ),
  ).sort((a, b) => a - b)
  const overrideKeys = validSelectedPointIndices.map((pointIndex) => String(pointIndex))
  const effectiveModes = overrideKeys.map(
    (overrideKey) => stair.cornerModeOverrides?.[overrideKey] ?? stair.cornerMode,
  )
  const hasMixedPointModes =
    effectiveModes.length > 1 && effectiveModes.some((mode) => mode !== effectiveModes[0])
  const effectivePointMode: StairCornerMode | '' =
    effectiveModes.length === 0 ? '' : hasMixedPointModes ? '' : effectiveModes[0]!
  const overrideCount = Object.keys(stair.cornerModeOverrides ?? {}).length
  const spiralStair = isSpiralStair(stair)
  const spiralSweepDegrees = stair.spiralSweepDegrees ?? 360

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          {t('stairs.width', 'Stair width')} ({t('plan.cm', 'cm')})
        </label>
        <DebouncedNumberInput
          type="number"
          min={10}
          step={1}
          value={Math.round(widthCm * 10) / 10}
          minValue={10}
          fallbackValue={Math.round(widthCm * 10) / 10}
          onCommit={(nextWidth) =>
            updateStairProperties(stair.id, {
              width: stairCentimetersToCanvasUnits(nextWidth, canvasPxPerMeter),
            })
          }
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          {t('stairs.stepDepth', 'Step depth')} ({t('plan.cm', 'cm')})
        </label>
        <DebouncedNumberInput
          type="number"
          min={4}
          step={1}
          value={Math.round(stepDepthCm * 10) / 10}
          minValue={4}
          fallbackValue={Math.round(stepDepthCm * 10) / 10}
          onCommit={(nextStepDepth) =>
            updateStairProperties(stair.id, {
              stepDepth: stairCentimetersToCanvasUnits(nextStepDepth, canvasPxPerMeter),
            })
          }
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>
      {spiralStair && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('stairs.spiralSweepDegrees', 'Spiral sweep')} (°)
          </label>
          <DebouncedNumberInput
            type="number"
            min={90}
            max={360}
            step={15}
            value={Math.round(spiralSweepDegrees)}
            minValue={90}
            maxValue={360}
            fallbackValue={360}
            onCommit={(nextSweep) =>
              updateStairProperties(stair.id, {
                spiralSweepDegrees: Math.max(90, Math.min(360, Math.round(nextSweep))),
              })
            }
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
      )}
      {!spiralStair && (
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          {t('stairs.cornerStyle', 'Corner style')}
        </label>
        <CustomDropdown
          value={stair.cornerStyle}
          onChange={(nextValue) => updateStairProperties(stair.id, { cornerStyle: nextValue as Stair['cornerStyle'] })}
          options={[
            { value: 'round', label: t('stairs.cornerStyleRound', 'Round') },
            { value: 'sharp', label: t('stairs.cornerStyleSharp', 'Sharp') },
          ]}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>
      )}
      {!spiralStair && (
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          {t('stairs.defaultPointBehavior', 'Default point behavior')}
        </label>
        <CustomDropdown
          value={stair.cornerMode}
          onChange={(nextValue) => updateStairProperties(stair.id, { cornerMode: nextValue as StairCornerMode })}
          options={[
            { value: 'turn', label: t('stairs.pointBehaviorTurn', 'Turning steps') },
            { value: 'platform', label: t('stairs.pointBehaviorPlatform', 'Platform') },
          ]}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        {overrideCount > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {t('stairs.pointOverrideCount', '{{count}} point(s) override this behavior.', {
              count: overrideCount,
            })}
          </p>
        )}
      </div>
      )}
      <StairUpArrowDirectionPicker
        stair={stair}
        spiralStair={spiralStair}
        onChange={(patch) => updateStairProperties(stair.id, patch)}
      />
      {!spiralStair && overrideKeys.length > 0 && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-500/50 dark:bg-amber-400/10">
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t(
              validSelectedPointIndices.length > 1
                ? 'stairs.selectedPointsOverride'
                : 'stairs.selectedPointOverride',
              validSelectedPointIndices.length > 1 ? 'Selected point overrides' : 'Selected point override',
            )}
          </label>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {t(
              'stairs.selectedPointOverrideHelp',
              'Per-point override. Use platform to create a landing and suppress steps on the adjacent sections.',
            )}
          </p>
          <CustomDropdown
            value={effectivePointMode}
            onChange={(nextValue) => {
              if (!nextValue) return
              const next = { ...(stair.cornerModeOverrides ?? {}) }
              for (const overrideKey of overrideKeys) {
                next[overrideKey] = nextValue as StairCornerMode
              }
              updateStairProperties(stair.id, { cornerModeOverrides: next })
            }}
            options={[
              ...(hasMixedPointModes
                ? [{ value: '', label: t('stairs.mixedPointModes', 'Mixed values') }]
                : []),
              { value: 'turn', label: t('stairs.pointBehaviorTurn', 'Turning steps') },
              { value: 'platform', label: t('stairs.pointBehaviorPlatform', 'Platform') },
            ]}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={() => {
              const next = { ...(stair.cornerModeOverrides ?? {}) }
              for (const overrideKey of overrideKeys) {
                delete next[overrideKey]
              }
              updateStairProperties(stair.id, {
                cornerModeOverrides: Object.keys(next).length > 0 ? next : undefined,
              })
            }}
            className="text-xs text-sky-600 hover:underline dark:text-sky-400"
          >
            {t('stairs.clearPointOverride', 'Use stair default')}
          </button>
        </div>
      )}
    </div>
  )
}
