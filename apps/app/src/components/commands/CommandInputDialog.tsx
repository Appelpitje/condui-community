import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogStore } from '@/stores/dialogStore'
import type { CommandInputField } from '@/lib/commands/ui/types'

/** Draft values stay local; submit publishes exactly one project command. */
export function CommandInputDialog({
  fields,
  onSubmit,
}: {
  fields: CommandInputField[]
  onSubmit: (values: Record<string, string>) => boolean
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.value]))
  )
  const [failed, setFailed] = useState(false)
  const controlClass =
    'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white'
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (onSubmit(values)) useDialogStore.getState().closeDialog()
        else setFailed(true)
      }}
      className="space-y-4"
      data-testid="command-input-dialog"
    >
      {fields.map((field, index) => (
        <div key={field.name}>
          <label
            htmlFor={`${prefix}-${field.name}`}
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t(field.labelKey)}
          </label>
          {field.options ? (
            <select
              id={`${prefix}-${field.name}`}
              value={values[field.name]}
              autoFocus={index === 0}
              className={controlClass}
              onChange={(event) => {
                setValues((previous) => ({ ...previous, [field.name]: event.target.value }))
                setFailed(false)
              }}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.labelKey ? t(option.labelKey) : option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${prefix}-${field.name}`}
              type={field.type ?? 'text'}
              value={values[field.name]}
              required
              autoFocus={index === 0}
              min={field.min}
              max={field.max}
              step={field.step ?? (field.type === 'number' ? 1 : undefined)}
              className={controlClass}
              onChange={(event) => {
                setValues((previous) => ({ ...previous, [field.name]: event.target.value }))
                setFailed(false)
              }}
            />
          )}
        </div>
      ))}
      {failed && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('commandPalette.unavailable')}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <button
          type="button"
          onClick={() => useDialogStore.getState().closeDialog()}
          className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="rounded-md bg-sky-600 px-4 py-2 text-white hover:bg-sky-700"
        >
          {t('commandPalette.apply')}
        </button>
      </div>
    </form>
  )
}
