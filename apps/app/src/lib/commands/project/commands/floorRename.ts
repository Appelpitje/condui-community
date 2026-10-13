import { z } from 'zod'
import { defineProjectCommand } from '../types'

export const floorRename = defineProjectCommand({
  id: 'floor.rename',
  version: 1,
  input: z.object({
    floorId: z.string().min(1),
    name: z.string().trim().min(1),
  }),
  check(project, input) {
    const floor = project.building?.floors?.find((candidate) => candidate.id === input.floorId)
    if (!floor) return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    return { ok: true }
  },
  apply(draft, input) {
    const floor = draft.building.floors.find((candidate) => candidate.id === input.floorId)!
    if (floor.name === input.name) return { created: [], changed: [], removed: [] }
    floor.name = input.name
    const ref = { kind: 'floor' as const, id: input.floorId }
    return { created: [], changed: [ref], removed: [] }
  },
})
