import { CommandRegistry } from '@/lib/commands/ui/registry'
import { createEditorCommands } from './editorCommands'

/**
 * Screen-only editor commands (`ui.*`) and keyboard/palette bindings to session operations.
 * Project changes belong in headless project commands (`lib/commands/project`, ADR 0003);
 * bindings here only work out their input from the UI and run them.
 */
export const editorCommandRegistry = new CommandRegistry()

for (const command of createEditorCommands(editorCommandRegistry)) {
  editorCommandRegistry.register(command)
}
