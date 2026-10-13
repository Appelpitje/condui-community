import type { InstallationPropertyPatch } from './editProperties'
import type {
  GeneralProjectPropertyPatch,
  GeneralPropertyEdit,
} from '@/lib/properties/generalPropertyFamilies'
import type { ProjectV2 } from '@/types/projectV2'
import type { Frame, Note, Wall, Door, Window, Stair, PlanGraphicElement } from '@/types/schema'
import type { ProjectDocumentPatch } from '@/lib/documents/projectDocuments'
import { editProperties } from './editProperties'
import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'

type GeneralPatch<K extends GeneralPropertyEdit['kind']> = Extract<
  GeneralPropertyEdit,
  { kind: K }
>['set']

// The callback boundary accepts existing editor patches; the command validates serialized fields.
export function updateProjectProperties(
  set: Partial<ProjectV2['project']> | GeneralProjectPropertyPatch
) {
  const project = useProjectStore.getState().currentProject
  if (!project) return null
  return editProperties({
    edits: [{ kind: 'project', ids: [project.project.id], set: set as GeneralPatch<'project'> }],
  })
}
export function updateInstallationAddressAndSite(
  address: Record<string, unknown>,
  site: Record<string, unknown>
) {
  const project = useProjectStore.getState().currentProject
  if (!project) return null
  return editProperties({
    installation: { address } as InstallationPropertyPatch,
    edits: [{ kind: 'site', ids: [project.project.id], set: site as GeneralPatch<'site'> }],
  })
}
export function updateNoteProperties(id: string, scope: 'oneWire' | 'sitplan', set: Partial<Note>) {
  return editProperties({
    edits: [{ kind: 'note', ids: [id], scope, set: set as GeneralPatch<'note'> }],
  })
}
export const updateOneWireNoteProperties = (id: string, set: Partial<Note>) =>
  updateNoteProperties(id, 'oneWire', set)
export const updateSituationPlanNoteProperties = (id: string, set: Partial<Note>) =>
  updateNoteProperties(id, 'sitplan', set)
export function updateFrameProperties(id: string, set: Partial<Frame>) {
  return editProperties({
    edits: [{ kind: 'frame', ids: [id], set: set as GeneralPatch<'frame'> }],
  })
}
export function updateWallProperties(id: string, set: Partial<Wall>) {
  return editProperties({ edits: [{ kind: 'wall', ids: [id], set: set as GeneralPatch<'wall'> }] })
}
export function updateDoorProperties(id: string, set: Partial<Door>) {
  return editProperties({ edits: [{ kind: 'door', ids: [id], set: set as GeneralPatch<'door'> }] })
}
export function updateWindowProperties(id: string, set: Partial<Window>) {
  return editProperties({
    edits: [{ kind: 'window', ids: [id], set: set as GeneralPatch<'window'> }],
  })
}
export function updateStairProperties(id: string, set: Partial<Stair>) {
  return editProperties({
    edits: [{ kind: 'stair', ids: [id], set: set as GeneralPatch<'stair'> }],
  })
}
export function updateGraphicElementProperties(id: string, set: Partial<PlanGraphicElement>) {
  return editProperties({
    edits: [{ kind: 'graphicElement', ids: [id], set: set as GeneralPatch<'graphicElement'> }],
  })
}
export function updateDocumentProperties(id: string, set: ProjectDocumentPatch) {
  return editProperties({
    edits: [{ kind: 'document', ids: [id], set: set as GeneralPatch<'document'> }],
  })
}
export function deleteWallByCommand(id: string) {
  return runProjectCommand(
    'entities.delete',
    { refs: [{ kind: 'wall', id }] },
    { source: 'properties', label: 'delete wall' }
  )
}
