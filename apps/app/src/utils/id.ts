import { nanoid } from 'nanoid'

let idSource: (() => string) | null = null

/** Generate a unique ID for persisted editor entities. */
export function generateId(): string {
  return idSource ? idSource() : nanoid(16)
}

/**
 * Runs `fn` with `generateId()` drawing from `source`. Project command executors use it so every
 * id created during a command comes from the command environment (ADR 0003).
 */
export function withIdSource<T>(source: () => string, fn: () => T): T {
  const previous = idSource
  idSource = source
  try {
    return fn()
  } finally {
    idSource = previous
  }
}
