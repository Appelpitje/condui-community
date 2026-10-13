import { nanoid } from 'nanoid'
import type { ProjectV2 } from '@/types/projectV2'
import { publishDomainEvents } from '@/lib/domainEvents'
import type { ProjectCommandRegistry } from './registry'
import { projectRevisionToken } from './revision'
import { applyCommandBatch } from './transaction'
import {
  CommandError,
  type BatchOutcome,
  type CommandEnv,
  type CommandInvocation,
  type ExecuteOptions,
  type PreviewOutcome,
  type ProjectCommandSession,
} from './types'

export interface HeadlessProjectSession extends ProjectCommandSession {
  readonly project: ProjectV2
}

export function createDefaultCommandEnv(language = 'nl-BE'): CommandEnv {
  return {
    // Same format as `generateId()`; drawn directly so `withIdSource` cannot recurse.
    newId: () => nanoid(16),
    now: () => new Date().toISOString(),
    language,
  }
}

/**
 * Runs project commands against an in-memory project: Node tests, scripts and (later) the
 * hosted drafting engine. Keeps a bounded snapshot history for `session.undo`/`session.redo`.
 */
export function createHeadlessProjectSession(
  initial: ProjectV2,
  options: { registry: ProjectCommandRegistry; env?: CommandEnv; historyLimit?: number }
): HeadlessProjectSession {
  const env = options.env ?? createDefaultCommandEnv()
  const historyLimit = options.historyLimit ?? 100
  let project = initial
  let undoStack: ProjectV2[] = []
  let redoStack: ProjectV2[] = []
  let historyGroup: string | undefined

  const assertRevision = (expected: string | undefined) => {
    if (expected != null && expected !== projectRevisionToken(project)) {
      throw new CommandError('stale_revision', 'The project changed since this was prepared')
    }
  }

  return {
    get project() {
      return project
    },
    get revision() {
      return projectRevisionToken(project)
    },

    execute(batch: CommandInvocation[], executeOptions?: ExecuteOptions): BatchOutcome {
      const parsed = options.registry.parse(batch)
      assertRevision(executeOptions?.expectedRevision)
      const { project: next, results, events } = applyCommandBatch(project, parsed, env)
      if (next === project) {
        return { revision: projectRevisionToken(project), changed: false, results }
      }
      if (!executeOptions?.historyGroup || executeOptions.historyGroup !== historyGroup) {
        undoStack = [...undoStack, project].slice(-historyLimit)
      }
      historyGroup = executeOptions?.historyGroup
      redoStack = []
      project = next
      publishDomainEvents(events)
      return { revision: projectRevisionToken(project), changed: true, results }
    },

    preview(invocation: CommandInvocation): PreviewOutcome {
      const { command, input } = options.registry.parseOne(invocation)
      return { revision: projectRevisionToken(project), check: command.check(project, input) }
    },

    undo() {
      historyGroup = undefined
      const previous = undoStack.at(-1)
      if (!previous) return false
      undoStack = undoStack.slice(0, -1)
      redoStack = [...redoStack, project]
      project = previous
      return true
    },

    redo() {
      historyGroup = undefined
      const next = redoStack.at(-1)
      if (!next) return false
      redoStack = redoStack.slice(0, -1)
      undoStack = [...undoStack, project].slice(-historyLimit)
      project = next
      return true
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  }
}
