import { useTranslation } from 'react-i18next'
import type { Scope } from '@/lib/validation/core/types'

export function AffectedCircuitTargets({ scopes, scopeLabel, onSelectScope, isScopeSelected }: {
  scopes: Scope[]
  scopeLabel: (scope: Scope) => string
  onSelectScope: (scope: Scope) => void
  isScopeSelected: (scope: Scope) => boolean
}) {
  const { t } = useTranslation()
  return (
    <details
      className="mb-1.5 text-xs"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary className="cursor-pointer font-medium text-sky-700 dark:text-sky-300">
        {t('circuits.title')}
      </summary>
      <div className="mt-2 flex flex-wrap gap-1">
        {scopes.map((scope) => (
          <button
            key={scope.id}
            type="button"
            data-validation-circuit-target={scope.id}
            onClick={() => onSelectScope(scope)}
            aria-pressed={isScopeSelected(scope)}
            title={t('validation.goToIssue')}
            className="rounded border border-gray-200 px-2 py-1 text-left text-sky-700 hover:border-sky-500 aria-pressed:border-sky-500 aria-pressed:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 dark:border-gray-600 dark:text-sky-300 dark:aria-pressed:bg-sky-950/30"
          >
            {scopeLabel(scope)}
          </button>
        ))}
      </div>
    </details>
  )
}
