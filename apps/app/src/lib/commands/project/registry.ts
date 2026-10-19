import { CommandError, type CommandInvocation, type ProjectCommandDefinition } from './types'
import { commandAliasSchema, hasCreatedReferences } from './batchReferences'

export interface ParsedInvocation {
  command: ProjectCommandDefinition
  input: unknown
  as?: string
  deferred?: boolean
}

export class ProjectCommandRegistry {
  private readonly commands = new Map<string, ProjectCommandDefinition>()

  register(command: ProjectCommandDefinition): this {
    if (this.commands.has(command.id)) {
      throw new Error(`Project command "${command.id}" is already registered`)
    }
    this.commands.set(command.id, command)
    return this
  }

  get(id: string): ProjectCommandDefinition | undefined {
    return this.commands.get(id)
  }

  list(): ProjectCommandDefinition[] {
    return [...this.commands.values()]
  }

  parseOne(invocation: CommandInvocation): ParsedInvocation {
    const parsed = this.parse([invocation])[0]!
    if (parsed.deferred) throw new CommandError('invalid_input', 'A preview cannot resolve batch-local created references')
    return parsed
  }

  /** Parses direct inputs up front; reference-bearing inputs parse after prior results inside the transaction. */
  parse(batch: readonly CommandInvocation[]): ParsedInvocation[] {
    const aliases = new Set<string>()
    return batch.map((invocation, index) => {
      if (invocation.as !== undefined) {
        if (!commandAliasSchema.safeParse(invocation.as).success || aliases.has(invocation.as))
          throw new CommandError('invalid_input', 'Command aliases must be valid and unique within a batch', { index, commandId: invocation.id, reason: 'invalid_batch_alias' })
        aliases.add(invocation.as)
      }
      const command = this.commands.get(invocation.id)
      if (!command) {
        throw new CommandError('unknown_command', `Unknown command "${invocation.id}"`, {
          index,
          commandId: invocation.id,
        })
      }
      if (invocation.version != null && invocation.version !== command.version) {
        throw new CommandError(
          'unsupported_version',
          `Command "${command.id}" is version ${command.version}, not ${invocation.version}`,
          { index, commandId: command.id }
        )
      }
      if (hasCreatedReferences(invocation.input))
        return { command, input: invocation.input, as: invocation.as, deferred: true }
      const parsed = command.input.safeParse(invocation.input)
      if (!parsed.success) {
        throw new CommandError('invalid_input', `Invalid input for "${command.id}"`, {
          index,
          commandId: command.id,
          cause: parsed.error.issues,
        })
      }
      return { command, input: parsed.data, ...(invocation.as ? { as: invocation.as } : {}) }
    })
  }
}
