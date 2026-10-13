export function normalizePatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...patch }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      next[key] = undefined
      continue
    }
    const previous = current[key]
    if (Array.isArray(value)) {
      const prior = Array.isArray(previous) ? previous : []
      next[key] = value.map((item, index) => {
        if (item === null) return null
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const oldItem = prior[index]
          return normalizePatch(
            oldItem && typeof oldItem === 'object' ? (oldItem as Record<string, unknown>) : {},
            item as Record<string, unknown>
          )
        }
        return item
      })
    } else if (value && typeof value === 'object') {
      next[key] = {
        ...(previous && typeof previous === 'object' && !Array.isArray(previous)
          ? (previous as Record<string, unknown>)
          : {}),
        ...normalizePatch(
          previous && typeof previous === 'object' && !Array.isArray(previous)
            ? (previous as Record<string, unknown>)
            : {},
          value as Record<string, unknown>
        ),
      }
    }
  }
  return next
}

export function patchChanges(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): boolean {
  const equal = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true
    if ((left === undefined && right === null) || (left === null && right === undefined))
      return true
    if (Array.isArray(left) && Array.isArray(right))
      return (
        left.length === right.length && left.every((value, index) => equal(value, right[index]))
      )
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)])
      return [...keys].every((key) =>
        equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
      )
    }
    return false
  }
  return !equal(current, { ...current, ...patch })
}
