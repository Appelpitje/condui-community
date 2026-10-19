import type { Draft } from 'immer'
import type { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'

/**
 * Project commands: every change to a project as a named, typed, headless operation.
 * See docs/adr/0003-editor-command-layer.md. Nothing under `lib/commands/project/` may reach
 * React, the DOM, browser i18n, analytics or the Zustand stores (`npm run commands:boundary`).
 * React-free locale catalogs are allowed through `getDomainTranslator(env.language)`.
 */

export type EntityKind =
  | 'project'
  | 'installation'
  | 'floor'
  | 'panel'
  | 'circuit'
  | 'protection'
  | 'endpoint'
  | 'trunkDevice'
  | 'placement'
  | 'wall'
  | 'door'
  | 'window'
  | 'stair'
  | 'note'
  | 'frame'
  | 'wireRoute'
  | 'wireRun'
  | 'ground'
  | 'graphicElement'
  | 'auxiliaryEnclosure'
  | 'junctionAsset'
  | 'document'
  | 'site'
  | 'element'

export interface EntityRef {
  kind: EntityKind
  id: string
}

/** Ids and persisted timestamps come only from here, so runs are reproducible. */
export interface CommandEnv {
  newId(): string
  /** ISO timestamp. */
  now(): string
  /** Locale for any persisted, domain-generated labels. */
  language: string
}

export type CommandCheck<TPreview = undefined> =
  | { ok: true; preview?: TPreview }
  | { ok: false; code: string; message: string; details?: unknown }

export interface CommandResult {
  /** Batch-local name supplied by the caller, when present. */
  as?: string
  created: EntityRef[]
  changed: EntityRef[]
  removed: EntityRef[]
  /** Entities the change belongs to without changing themselves, such as an owning circuit. */
  related?: EntityRef[]
  /** Suggested follow-up selection; only UI adapters apply it. */
  select?: EntityRef[]
}

export interface ProjectCommandDefinition<
  TSchema extends z.ZodType = z.ZodType,
  TPreview = unknown,
> {
  /** Stable `domain.verb` id. Internal and experimental until ADR 0003 Phase 2 ends. */
  id: string
  version: number
  input: TSchema
  /** Read-only. Runs again inside the transaction, immediately before `apply`. */
  check(project: ProjectV2, input: z.output<TSchema>): CommandCheck<TPreview>
  /** Synchronous; changes the draft only and keeps domain invariants. */
  apply(draft: Draft<ProjectV2>, input: z.output<TSchema>, env: CommandEnv): CommandResult
}

export function defineProjectCommand<TSchema extends z.ZodType, TPreview = undefined>(
  definition: ProjectCommandDefinition<TSchema, TPreview>
): ProjectCommandDefinition<TSchema, TPreview> {
  return definition
}

/** One requested command run, as a script, agent or UI adapter sends it. */
export interface CommandInvocation {
  id: string
  /** Later commands in this atomic batch can refer to this command's created entities. */
  as?: string
  /** Defaults to the command's current version. */
  version?: number
  input: unknown
}

export type CommandErrorCode =
  | 'unknown_command'
  | 'unsupported_version'
  | 'invalid_input'
  | 'stale_revision'
  | 'no_project'
  | 'check_failed'
  | 'apply_failed'

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
    readonly details?: {
      /** Index of the failing invocation within its batch. */
      index?: number
      commandId?: string
      /** The command's own check code, for `check_failed`. */
      reason?: string
      cause?: unknown
    }
  ) {
    super(message)
    this.name = 'CommandError'
  }
}

export interface BatchOutcome {
  /** Revision token of the project after the batch (unchanged for a no-op). */
  revision: string
  changed: boolean
  results: CommandResult[]
}

export interface PreviewOutcome<TPreview = unknown> {
  /** Pass back as `expectedRevision` so a stale confirmation is rejected. */
  revision: string
  check: CommandCheck<TPreview>
}

export interface ExecuteOptions {
  /** Reject the batch when the project changed since this revision was observed. */
  expectedRevision?: string
  /** Short diagnostic label for the session action log; defaults to the command ids. */
  label?: string
  /** Origin recorded for each command committed by the live editor executor. */
  source?: string
  /** Coalesce consecutive successful commits from one field-editing session into one undo step. */
  historyGroup?: string
}

/** A place commands run: the live editor, an assistant draft or a headless project. */
export interface ProjectCommandSession {
  readonly revision: string
  execute(batch: CommandInvocation[], options?: ExecuteOptions): BatchOutcome
  preview(invocation: CommandInvocation): PreviewOutcome
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
}
