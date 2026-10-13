import { CommandError, type CommandInvocation, type ProjectCommandDefinition } from './types'

export interface ParsedInvocation {
  command: ProjectCommandDefinition
  input: unknown
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
    return this.parse([invocation])[0]!
  }

  /** Resolves ids/versions and parses every input before anything is applied. */
  parse(batch: readonly CommandInvocation[]): ParsedInvocation[] {
    return batch.map((invocation, index) => {
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
      const parsed = command.input.safeParse(invocation.input)
      if (!parsed.success) {
        throw new CommandError('invalid_input', `Invalid input for "${command.id}"`, {
          index,
          commandId: command.id,
          cause: parsed.error.issues,
        })
      }
      return { command, input: parsed.data }
    })
  }
}
