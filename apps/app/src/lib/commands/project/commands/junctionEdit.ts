import {
  checkJunctionEditForEdition,
  applyJunctionEditForEdition,
} from '@/lib/junction/junctionCommandHooks'
import { junctionEditInputSchema, type JunctionEditInput } from '../junctionEditTypes'
import { CommandError, defineProjectCommand } from '../types'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'

export const junctionEdit = defineProjectCommand({
  id: 'junction.edit',
  version: 1,
  input: junctionEditInputSchema,
  check(project, input) {
    return checkJunctionEditForEdition(project, input)
  },
  apply(draft, input, env) {
    try {
      const previousRuns = new Set(selectProjectWireRuns(draft).map((run) => run.id))
      const result = applyJunctionEditForEdition(draft, input, env.now())
      return {
        created: selectProjectWireRuns(draft)
          .filter((run) => !previousRuns.has(run.id))
          .map((run) => ({ kind: 'wireRun' as const, id: run.id })),
        changed: result.changed ? [{ kind: 'junctionAsset' as const, id: input.assetId }] : [],
        removed: [],
        related: [],
        select: [{ kind: 'junctionAsset' as const, id: input.assetId }],
      }
    } catch (error) {
      throw new CommandError(
        'apply_failed',
        error instanceof Error ? error.message : 'Junction edit failed.',
        {
          commandId: 'junction.edit',
          cause: error,
        }
      )
    }
  },
})

export type JunctionEditCommandInput = JunctionEditInput
