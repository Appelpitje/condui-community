let timeSource: (() => string) | null = null

/** Persisted mutation timestamps share the command environment, including nested drop callbacks. */
export function projectMutationNow(): string {
  return timeSource ? timeSource() : new Date().toISOString()
}

export function withProjectMutationTime<T>(source: () => string, fn: () => T): T {
  const previous = timeSource
  timeSource = source
  try {
    return fn()
  } finally {
    timeSource = previous
  }
}
