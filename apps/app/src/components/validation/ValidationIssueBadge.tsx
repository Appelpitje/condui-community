import type { ReactNode } from 'react'

/** A row's shortcut remains an actual control only when that row has a destination. */
export function ValidationIssueBadge({ interactive, children, onActivate }: {
  interactive: boolean
  children: ReactNode
  onActivate: (source?: 'keyboard') => void
}) {
  const className = 'text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600'
  return (
    <span role="presentation" onClick={(event) => event.stopPropagation()}>
      {interactive ? (
        <button
          type="button"
          className={`${className} cursor-pointer`}
          onClick={(event) => onActivate(event.detail === 0 ? 'keyboard' : undefined)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          }}
        >
          {children}
        </button>
      ) : <span className={className}>{children}</span>}
    </span>
  )
}
