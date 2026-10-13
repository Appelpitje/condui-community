import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import type { CommandContext, CommandDefinition, CommandKeybinding } from './types'

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>

function modifierMatches(expected: boolean | 'any' | undefined, actual: boolean): boolean {
  if (expected === 'any') return true
  return (expected ?? false) === actual
}

export function keybindingMatches(binding: CommandKeybinding, event: KeyEventLike): boolean {
  const mod = event.ctrlKey || event.metaKey
  if ((binding.mod ?? false) !== mod) return false
  if (!modifierMatches(binding.shift, event.shiftKey)) return false
  if (!modifierMatches(binding.alt, event.altKey)) return false
  if (binding.code && event.code === binding.code) return true
  return binding.key.length === 1
    ? event.key.toLowerCase() === binding.key.toLowerCase()
    : event.key === binding.key
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>()

  register(command: CommandDefinition): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`)
    }
    this.commands.set(command.id, command)
  }

  get(id: string): CommandDefinition | undefined {
    return this.commands.get(id)
  }

  list(): CommandDefinition[] {
    return [...this.commands.values()]
  }

  isEnabled(command: CommandDefinition, ctx: CommandContext): boolean {
    return command.isEnabled?.(ctx) ?? true
  }

  /** Commands the palette may offer in this context, in registration order. */
  listForPalette(ctx: CommandContext): CommandDefinition[] {
    return this.list().filter(
      (command) =>
        command.labelKey != null && (command.palette ?? true) && this.isEnabled(command, ctx)
    )
  }

  /** Runs a command by id. Returns whether it was available and did something. */
  execute(id: string, ctx: CommandContext): boolean {
    const command = this.commands.get(id)
    if (!command || !this.isEnabled(command, ctx)) return false
    return command.run(ctx) !== false
  }

  /**
   * Runs the first enabled command bound to this key event. Returns whether a command
   * handled it; the caller then prevents the browser default.
   */
  handleKeyEvent(event: KeyboardEvent, ctx: CommandContext): boolean {
    const typing = isKeyboardTypingTarget(event.target)
    for (const command of this.commands.values()) {
      const bound = command.keybindings?.some(
        (binding) => (binding.whileTyping || !typing) && keybindingMatches(binding, event)
      )
      if (!bound || !this.isEnabled(command, ctx)) continue
      if (command.run(ctx) !== false) return true
    }
    return false
  }
}
