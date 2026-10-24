import { useTranslation } from 'react-i18next'
import type { Scope, ValidationCoverageEntry } from '@/lib/validation/core/types'

/** Stable catalog keys for the validator's free-form evidence labels. */
function evidenceKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function IncompleteChecksDetails({
  entries,
  scopeLabel,
  onSelectScope,
  isScopeSelected,
}: {
  entries: ValidationCoverageEntry[]
  scopeLabel: (scope: Scope) => string
  onSelectScope: (scope: Scope) => void
  isScopeSelected: (scope: Scope) => boolean
}) {
  const { t } = useTranslation()
  const groups = new Map<string, { scope: Scope; checks: Map<string, ValidationCoverageEntry> }>()
  for (const entry of entries) {
    const key = `${entry.scope.type}:${entry.scope.id}`
    let group = groups.get(key)
    if (!group) {
      group = { scope: entry.scope, checks: new Map() }
      groups.set(key, group)
    }
    // Identical evidence can be emitted repeatedly; the debug payload keeps every entry.
    const signature = JSON.stringify([entry.ruleId, entry.checkName, entry.status, entry.reason, entry.missingFacts])
    group.checks.set(signature, entry)
  }

  return (
    <details
      className="mb-1.5 text-xs text-gray-600 dark:text-gray-400"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary className="cursor-pointer font-medium text-sky-700 dark:text-sky-300">
        {t('validation.incompleteChecks.showChecks', { total: entries.length })}
      </summary>
      <div className="mt-2 space-y-2">
        {Array.from(groups, ([key, group]) => (
          <div
            key={key}
            data-validation-scope-type={group.scope.type}
            data-validation-scope-id={group.scope.id}
            className={`border-l-2 pl-2 ${isScopeSelected(group.scope)
              ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30'
              : 'border-transparent'}`}
          >
            {group.scope.type === 'subgraph' ? (
              <div className="font-semibold text-gray-800 dark:text-gray-200">{scopeLabel(group.scope)}</div>
            ) : (
              <button
                type="button"
                onClick={() => onSelectScope(group.scope)}
                aria-pressed={isScopeSelected(group.scope)}
                title={t('validation.goToIssue')}
                className="text-left font-semibold text-sky-700 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 dark:text-sky-300"
              >
                {scopeLabel(group.scope)}
              </button>
            )}
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              {Array.from(group.checks, ([signature, entry]) => {
                const check = t(`validation.incompleteChecks.checks.${entry.checkName ?? entry.ruleId}`, {
                  defaultValue: entry.checkName ?? entry.ruleId,
                })
                const information = entry.missingFacts?.length
                  ? entry.missingFacts.map((fact) => t(`validation.incompleteChecks.facts.${evidenceKey(fact)}`, {
                      defaultValue: fact,
                    })).join(', ')
                  : t(`validation.incompleteChecks.reasons.${entry.reason ?? 'unknown'}`, {
                      defaultValue: entry.reason?.replaceAll('-', ' ') ?? t('validation.incompleteChecks.unknown'),
                    })
                return (
                  <li key={signature}>
                    {group.scope.type === 'subgraph' ? (
                      <>
                        <span className="font-medium">{check}</span>
                        {' — '}
                        {t(`validation.incompleteChecks.${entry.status === 'unavailable' ? 'unavailable' : 'missing'}`, { information })}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectScope(group.scope)}
                        title={t('validation.goToIssue')}
                        className="text-left hover:text-sky-700 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 dark:hover:text-sky-300"
                      >
                        <span className="font-medium">{check}</span>
                        {' — '}
                        {t(`validation.incompleteChecks.${entry.status === 'unavailable' ? 'unavailable' : 'missing'}`, { information })}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}
