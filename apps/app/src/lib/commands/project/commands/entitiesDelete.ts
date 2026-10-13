import { z } from 'zod'
import { current } from 'immer'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand } from '../types'
import {
  deletionInventory,
  deleteEntitiesInProject,
  entityDeletionChanges,
  previewEntityDeletion,
  type EntityDeletionPreview,
} from '@/lib/eendraad/entityDeletion'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { getAllEndpoints } from '@/lib/eendraad/projectElectricalDomain'
import { queryOneWireNotes, querySitplanNotes } from '@/lib/projectV2/annotations'
import { resolvePlanPlacementDeletion } from '@/lib/plan/placementMutations'

const id = z.string().min(1)
const deletionRefSchema = z.union([
  z.object({ kind: z.literal('placement'), id, retainOwner: z.boolean().optional() }).strict(),
  z
    .object({
      kind: z.enum([
        'endpoint',
        'protection',
        'circuit',
        'trunkDevice',
        'panel',
        'frame',
        'wall',
        'door',
        'window',
        'stair',
        'graphicElement',
      ]),
      id,
    })
    .strict(),
  z
    .object({ kind: z.literal('note'), id, scope: z.enum(['oneWire', 'sitplan']).optional() })
    .strict(),
  z
    .object({ kind: z.literal('ground'), id, scope: z.enum(['all', 'installation', 'panel']) })
    .strict(),
])
const inputSchema = z
  .object({ refs: z.array(deletionRefSchema).min(1), preserveLinkedPanels: z.boolean().optional() })
  .strict()

/** One deletion gesture across canvases, with an exact dependent-removal preview. */
export const entitiesDelete = defineProjectCommand<typeof inputSchema, EntityDeletionPreview>({
  id: 'entities.delete',
  version: 1,
  input: inputSchema,
  check(project, input) {
    const inventory = deletionInventory(project),
      panels = getProjectElectricalPanels(project)
    for (const ref of input.refs) {
      if (ref.kind === 'ground') {
        if (ref.scope !== 'panel' && !['installation', 'ground', 'all'].includes(ref.id))
          return { ok: false, code: 'ground_not_found', message: 'Earthing location not found' }
        if (
          !getProjectElectricalInstallation(project) ||
          (ref.scope === 'panel' && findPanelById(panels, ref.id)?.isMain !== false)
        )
          return { ok: false, code: 'ground_not_found', message: 'Earthing location not found' }
      } else if (ref.kind === 'note') {
        const notes =
          ref.scope === 'oneWire'
            ? queryOneWireNotes(project)
            : ref.scope === 'sitplan'
              ? querySitplanNotes(project)
              : [...queryOneWireNotes(project), ...querySitplanNotes(project)]
        if (!notes.some((note) => note.id === ref.id))
          return { ok: false, code: 'note_not_found', message: 'Note not found in this view' }
      } else if (!inventory.has(`${ref.kind}:${ref.id}`))
        return { ok: false, code: `${ref.kind}_not_found`, message: `${ref.kind} not found` }
      else if (ref.kind === 'endpoint') {
        const endpoint = panels
          .flatMap((panel) => getAllEndpoints(panel))
          .find((candidate) => candidate.id === ref.id)
        if (endpoint && isMainPanelDistributionEndpoint(project, endpoint))
          return {
            ok: false,
            code: 'protected_endpoint',
            message: 'The main panel distribution symbol cannot be deleted',
          }
      }
    }
    if (input.refs.every((ref) => ref.kind === 'placement' && !ref.retainOwner)) {
      const placements = resolvePlanPlacementDeletion(
        project,
        input.refs.map((ref) => ref.id)
      )
      if (placements.placementIds.length === 0 && placements.endpointIds.length === 0)
        return {
          ok: false,
          code: 'nothing_to_delete',
          message: 'None of these can be deleted',
          details: placements,
        }
    }
    const preview = previewEntityDeletion(project, input)
    for (const ref of input.refs) {
      if (
        ref.kind === 'panel' &&
        !preview.removed.some((removed) => removed.kind === 'panel' && removed.id === ref.id)
      )
        return {
          ok: false,
          code: 'last_main_panel',
          message: 'The last main panel cannot be deleted',
        }
    }
    if (
      preview.removed.length === 0 &&
      preview.changed.length === 0 &&
      !input.refs.some((ref) => ref.kind === 'ground')
    )
      return {
        ok: false,
        code: 'nothing_to_delete',
        message: 'None of these can be deleted',
        details: preview,
      }
    return { ok: true, preview }
  },
  apply(draft, input) {
    const before = current(draft) as ProjectV2
    deleteEntitiesInProject(draft as ProjectV2, input)
    return { ...entityDeletionChanges(before, draft as ProjectV2), select: [] }
  },
})
