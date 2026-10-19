import type { Frame, Note } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import {
  queryOneWireFrames,
  queryOneWireNotes,
  querySitplanNotes,
  replaceOneWireFrames,
  replaceOneWireNotes,
  replaceSitplanNotes,
} from '@/lib/projectV2/annotations'

export function addOneWireNoteInProject(project: ProjectV2, note: Note): boolean {
  if (queryOneWireNotes(project).some((item) => item.id === note.id)) return false
  replaceOneWireNotes(project, [...queryOneWireNotes(project), note])
  return true
}

export function addSitplanNoteInProject(project: ProjectV2, note: Note): boolean {
  if (querySitplanNotes(project).some((item) => item.id === note.id)) return false
  replaceSitplanNotes(project, [...querySitplanNotes(project), note])
  return true
}

export function addOneWireFrameInProject(project: ProjectV2, frame: Frame): boolean {
  if (queryOneWireFrames(project).some((item) => item.id === frame.id)) return false
  replaceOneWireFrames(project, [...queryOneWireFrames(project), frame])
  return true
}
