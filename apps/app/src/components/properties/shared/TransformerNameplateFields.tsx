import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DebouncedTextInput } from '@/components/forms'
import type { EnergyConversionDeviceProps } from '@/types/schema'
import CustomDropdown from '@/components/common/CustomDropdown'
import { SUPPLY_TRANSFORMER_PRIMARY_PRESETS_V } from '@/lib/electrical/supplyTransformer'

const fields = [
  ['transformerPrimaryVoltageV', 'primaryVoltage', 'Primary voltage (V)', [230, 400, ...SUPPLY_TRANSFORMER_PRIMARY_PRESETS_V, 10000, 11000, 12000, 15000]],
  ['transformerSecondaryVoltageV', 'secondaryVoltage', 'Secondary voltage (V)', [24, 48, 230, 400, 690]],
  ['transformerRatedPowerKva', 'ratedPower', 'Rated power (kVA)', [100, 160, 250, 315, 400, 500, 630, 800, 1000]],
  ['transformerShortCircuitVoltagePercent', 'shortCircuitVoltage', 'Short-circuit voltage uk (%)', []],
] as const

function NameplateNumberField({ label, value, suggestions, disabled, min = 0, max, onChange }: {
  label: string
  value: number | undefined
  suggestions: readonly number[]
  disabled: boolean
  min?: number
  max?: number
  onChange: (value: number | undefined) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [customMode, setCustomMode] = useState(false)
  const isCustom = customMode || (value != null && !suggestions.includes(value))
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      {suggestions.length > 0 && !disabled && (
        <CustomDropdown
          id={id}
          ariaLabel={label}
          value={isCustom ? 'custom' : value == null ? '' : String(value)}
          options={[
            { value: '', label: t('installation.connectionUnspecified', 'Unspecified') },
            ...suggestions.map((number) => ({ value: String(number), label: String(number) })),
            { value: 'custom', label: t('installation.connectionCustom', 'Custom') },
          ]}
          menuPortal
          onChange={(next) => {
            setCustomMode(next === 'custom')
            if (next !== 'custom') onChange(next === '' ? undefined : Number(next))
          }}
        />
      )}
      {(disabled || !suggestions.length || isCustom) && (
        <DebouncedTextInput
          id={suggestions.length && !disabled ? `${id}-custom` : id}
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step="any"
          value={value == null ? '' : String(value)}
          placeholder={t('installation.connectionUnspecified', 'Unspecified')}
          disabled={disabled}
          onCommit={(draft) => {
            if (draft.trim() === '') {
              setCustomMode(false)
              onChange(undefined)
            } else {
              const number = Number(draft)
              if (Number.isFinite(number) && number > min && (max == null || number <= max)) {
                setCustomMode(false)
                onChange(number)
              }
            }
          }}
          className={`${suggestions.length && !disabled ? 'mt-2 ' : ''}w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100`}
        />
      )}
    </div>
  )
}

export function TransformerNameplateFields({ value, onChange, readOnly = false }: {
  value: EnergyConversionDeviceProps
  onChange: (patch: Partial<EnergyConversionDeviceProps>) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const isSupply = value.transformerRole === 'supply'
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {fields.map(([key, label, fallback, suggestions]) => {
        return (
          <NameplateNumberField
            key={key}
            label={t(`endpoints.transformer.${label}`, fallback)}
            value={value[key]}
            suggestions={isSupply && key === 'transformerPrimaryVoltageV' ? suggestions.filter((number) => number > 1000) : suggestions}
            disabled={readOnly || (isSupply && key === 'transformerSecondaryVoltageV')}
            min={isSupply && key === 'transformerPrimaryVoltageV' ? 1000 : 0}
            max={key === 'transformerShortCircuitVoltagePercent' ? 100 : undefined}
            onChange={(number) => onChange({ [key]: number })}
          />
        )
      })}
    </div>
  )
}
