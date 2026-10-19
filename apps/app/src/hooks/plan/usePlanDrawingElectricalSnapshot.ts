import { useMemo, useRef } from 'react'
import type { ProjectV2 } from '@/types/projectV2'

/** Hold derived electrical artwork during a drawing session, retaining only one snapshot.
 * Building edits remain live elsewhere. Exit/export uses the latest geometry, since cable
 * routing can depend on walls. Floor/project changes must never reuse another scene.
 */
export function usePlanDrawingElectricalSnapshot(
  project: ProjectV2 | null,
  floorId: string | null,
  defer: boolean
): ProjectV2 | null {
  const elements = project?.elements
  const electricalElements = useMemo(
    () => elements?.filter((element) => element.kind.startsWith('electrical.')) ?? [],
    [elements]
  )
  const snapshot = useRef({ project, floorId, electricalElements })
  if (
    !defer ||
    snapshot.current.floorId !== floorId ||
    snapshot.current.project?.project.id !== project?.project.id ||
    snapshot.current.project?.disciplines.electrical !== project?.disciplines.electrical ||
    snapshot.current.electricalElements.length !== electricalElements.length ||
    snapshot.current.electricalElements.some((element, index) => element !== electricalElements[index])
  ) {
    snapshot.current = { project, floorId, electricalElements }
  }
  return snapshot.current.project
}
