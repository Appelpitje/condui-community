import { z } from 'zod'
import {
  applyEnsureJunctionAssetForEdition,
  checkEnsureJunctionAssetForEdition,
} from '@/lib/junction/junctionCommandHooks'
import { CommandError, defineProjectCommand } from '../types'

export const junctionEnsureAssetInputSchema = z.strictObject({
  occurrenceId: z.string().min(1).max(200),
})

export const junctionEnsureAsset = defineProjectCommand({
  id: 'junction.ensureAsset',
  version: 1,
  input: junctionEnsureAssetInputSchema,
  check(project, input) {
    return checkEnsureJunctionAssetForEdition(project, input.occurrenceId)
  },
  apply(draft, input) {
    try {
      const before = new Map(
        (draft.disciplines.electrical?.junctionAssets ?? []).map((asset) => [
          asset.id,
          JSON.stringify(asset),
        ])
      )
      const result = applyEnsureJunctionAssetForEdition(draft, input.occurrenceId)
      const assets = draft.disciplines.electrical?.junctionAssets ?? []
      return {
        created: assets
          .filter((asset) => !before.has(asset.id))
          .map((asset) => ({ kind: 'junctionAsset' as const, id: asset.id })),
        changed: assets
          .filter((asset) => before.has(asset.id) && before.get(asset.id) !== JSON.stringify(asset))
          .map((asset) => ({ kind: 'junctionAsset' as const, id: asset.id })),
        removed: [...before.keys()]
          .filter((id) => !assets.some((asset) => asset.id === id))
          .map((id) => ({ kind: 'junctionAsset' as const, id })),
        related: [],
        select: result.assetId ? [{ kind: 'junctionAsset' as const, id: result.assetId }] : [],
      }
    } catch (error) {
      throw new CommandError(
        'apply_failed',
        error instanceof Error ? error.message : 'Could not link the junction asset.',
        {
          commandId: 'junction.ensureAsset',
          cause: error,
        }
      )
    }
  },
})
