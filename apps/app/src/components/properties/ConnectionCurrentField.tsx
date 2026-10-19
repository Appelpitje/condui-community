import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CustomDropdown from '@/components/common/CustomDropdown'
import { DebouncedTextInput } from '@/components/forms'
import { CONNECTION_CURRENT_PRESETS_A } from '@/lib/electrical/supplyConnection'

export function ConnectionCurrentField({
  value,
  onChange,
  readOnly = false,
}: {
  value: number | undefined
  onChange: (value: number | undefined) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [customMode, setCustomMode] = useState(false)
  const isCustom = customMode || (value != null && !CONNECTION_CURRENT_PRESETS_A.some((rating) => rating === value))
  const label = t('installation.connectionCurrent', 'Connection current (A)')
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
      </label>
      <CustomDropdown
        id={id}
        ariaLabel={label}
        value={isCustom ? 'custom' : value == null ? '' : String(value)}
        options={[
          { value: '', label: t('installation.connectionUnspecified', 'Unspecified') },
          ...CONNECTION_CURRENT_PRESETS_A.map((rating) => ({ value: String(rating), label: `${rating} A` })),
          { value: 'custom', label: t('installation.connectionCustom', 'Custom') },
        ]}
        disabled={readOnly}
        menuPortal
        onChange={(next) => {
          setCustomMode(next === 'custom')
          if (next !== 'custom') onChange(next === '' ? undefined : Number(next))
        }}
      />
      {isCustom && (
        <DebouncedTextInput
          id={`${id}-custom`}
          aria-label={label}
          type="number"
          min={1}
          step={1}
          value={value == null ? '' : String(value)}
          placeholder={t('installation.connectionUnspecified', 'Unspecified')}
          disabled={readOnly}
          onCommit={(draft) => {
            if (draft.trim() === '') {
              setCustomMode(false)
              onChange(undefined)
            } else {
              const current = Number(draft)
              if (Number.isSafeInteger(current) && current > 0) {
                setCustomMode(false)
                onChange(current)
              }
            }
          }}
          className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      )}
    </div>
  )
}
