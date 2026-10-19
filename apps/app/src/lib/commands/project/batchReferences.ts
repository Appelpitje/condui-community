import { z } from 'zod'
import { CommandError, type CommandResult } from './types'

export const commandAliasSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
export const createdReferenceSchema = z.strictObject({
  $created: z.strictObject({
    from: commandAliasSchema,
    kind: z.string().min(1).max(40),
    index: z.number().int().min(0).max(10000).default(0),
  }),
})

/** Walk only JSON containers; native clipboard/File payloads remain untouched. */
function visit(value: unknown, reference: (value: unknown) => unknown, depth = 0, budget = { left: 100000 }): unknown {
  if (--budget.left < 0 || depth > 64)
    throw new CommandError('invalid_input', 'Command input exceeds the reference traversal limit')
  if (Array.isArray(value)) return value.map((item) => visit(item, reference, depth + 1, budget))
  if (!value || typeof value !== 'object') return value
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  if (Object.hasOwn(value, '$created')) return reference(value)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, reference, depth + 1, budget)]))
}

export function hasCreatedReferences(input: unknown): boolean {
  let found = false
  visit(input, (value) => {
    if (!createdReferenceSchema.safeParse(value).success)
      throw new CommandError('invalid_input', 'Invalid $created reference')
    found = true
    return value
  })
  return found
}

/** References select a stable ID, never arbitrary data or paths from a previous result. */
export function resolveCreatedReferences(input: unknown, results: ReadonlyMap<string, CommandResult>): unknown {
  return visit(input, (value) => {
    const { $created: ref } = createdReferenceSchema.parse(value)
    const result = results.get(ref.from)
    if (!result)
      throw new CommandError('invalid_input', `Created reference names an unavailable earlier command: ${ref.from}`, { reason: 'unknown_batch_reference' })
    const entity = result.created.filter(({ kind }) => kind === ref.kind)[ref.index]
    if (!entity)
      throw new CommandError('invalid_input', `Command ${ref.from} did not create ${ref.kind} at index ${ref.index}`, { reason: 'missing_created_reference' })
    return entity.id
  })
}
