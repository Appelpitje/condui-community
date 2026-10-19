import type { Frame, Note, WireSegment } from '@/types/schema'
import type { DisciplineModelsV2, ElementModelV2 } from '@/types/projectV2'
import { PROJECT_SCOPE_IDS } from '@/types/projectV2'

export type AnnotationProject = { disciplines?: Partial<DisciplineModelsV2>; elements?: ElementModelV2[] }
const SYSTEM_ANNOTATION = 'system_annotation'
const EMPTY_NOTES: Note[] = []
const EMPTY_FRAMES: Frame[] = []
const EMPTY_WIRE_SEGMENTS: WireSegment[] = []

function layerIdFor(floorId: string | undefined): string { return floorId ? `layer_${floorId}_annotations` : 'layer_annotations' }
function sitplanNoteElement(note: Note): ElementModelV2 {
  return { id: `elem_note_sitplan_${note.id}`, kind: 'annotation.note', scopeId: PROJECT_SCOPE_IDS.coordination, name: note.text, floorId: note.floorId,
    systemId: SYSTEM_ANNOTATION, layerId: layerIdFor(note.floorId), geometry: { kind: 'point', position: note.pos },
    properties: { v1: note, scope: 'sitplan', fontSize: note.fontSize, formatting: note.formatting, panelId: note.panelId },
    sourceRefs: [{ kind: 'v1', id: note.id, path: 'sitplanNotes' }] }
}
function isSitplanNoteElement(element: ElementModelV2): boolean {
  if (element.kind !== 'annotation.note') return false
  const properties = element.properties
  if (properties && typeof properties === 'object' && (properties as { scope?: unknown }).scope === 'sitplan') return true
  return element.sourceRefs?.some((ref) => ref.kind === 'v1' && ref.path === 'sitplanNotes') === true
}
function sitplanNoteFromElement(element: ElementModelV2): Note | null {
  if (!isSitplanNoteElement(element)) return null
  const properties = element.properties
  if (!properties || typeof properties !== 'object') return null
  const value = (properties as { v1?: unknown }).v1
  return value && typeof value === 'object' ? value as Note : null
}

export function queryOneWireNotes(document: AnnotationProject): Note[] { return document.disciplines?.electrical?.oneWire?.notes ?? EMPTY_NOTES }
export function querySitplanNotes(document: AnnotationProject): Note[] { return (document.elements ?? []).map(sitplanNoteFromElement).filter((note): note is Note => note !== null) }
export function editOneWireNotes(document: AnnotationProject): Note[] {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit one-wire notes.')
  if (!electrical.oneWire?.notes) electrical.oneWire = { ...electrical.oneWire, notes: [] }
  return electrical.oneWire!.notes!
}
export function replaceOneWireNotes(document: AnnotationProject, notes: Note[]): void {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit one-wire notes.')
  electrical.oneWire = { ...electrical.oneWire, notes }
}
export function replaceSitplanNotes(document: AnnotationProject, notes: Note[]): void {
  document.elements = [...(document.elements ?? []).filter((element) => !isSitplanNoteElement(element)), ...notes.map(sitplanNoteElement)]
}
export function queryOneWireFrames(document: AnnotationProject): Frame[] { return document.disciplines?.electrical?.oneWire?.frames ?? EMPTY_FRAMES }
export function editOneWireFrames(document: AnnotationProject): Frame[] {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit one-wire frames.')
  if (!electrical.oneWire?.frames) electrical.oneWire = { ...electrical.oneWire, frames: [] }
  return electrical.oneWire!.frames!
}
export function replaceOneWireFrames(document: AnnotationProject, frames: Frame[]): void {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit one-wire frames.')
  electrical.oneWire = { ...electrical.oneWire, frames }
}
export function queryOneWireSegments(document: AnnotationProject): WireSegment[] { return document.disciplines?.electrical?.oneWire?.wireSegments ?? EMPTY_WIRE_SEGMENTS }
export function editOneWireSegments(document: AnnotationProject): WireSegment[] {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit wire overrides.')
  if (!electrical.oneWire?.wireSegments) electrical.oneWire = { ...electrical.oneWire, wireSegments: [] }
  return electrical.oneWire!.wireSegments!
}
