import type { WireRun } from '@/types/projectV2'
import {
  editProjectWireRuns,
  selectProjectWireRuns,
  type ProjectWithOptionalV2WireRuns,
} from '@/lib/projectV2/wireRuns'
import { generateId } from '@/utils/id'

interface CloneMaps {
  circuit: ReadonlyMap<string, string>
  endpoint: ReadonlyMap<string, string>
  trunkDevice: ReadonlyMap<string, string>
  protection: ReadonlyMap<string, string>
}

/** Copy authored cables onto the new circuit/protection identities, independently of the source. */
export function cloneCircuitWireRuns(
  project: ProjectWithOptionalV2WireRuns,
  panelId: string,
  maps: CloneMaps,
  newId: () => string = generateId,
): void {
  const nodes = new Map<string, string>()
  for (const [kind, ids] of [
    ['endpoint', maps.endpoint],
    ['trunk-device', maps.trunkDevice],
    ['protection', maps.protection],
  ] as const) {
    for (const [from, to] of ids) {
      nodes.set(`${kind}:${from}`, `${kind}:${to}`)
      nodes.set(
        `open-end:${kind}:${encodeURIComponent(from)}`,
        `open-end:${kind}:${encodeURIComponent(to)}`
      )
    }
  }
  for (const [from, to] of maps.circuit) {
    nodes.set(`bus-section:secondary-bus:${from}`, `bus-section:secondary-bus:${to}`)
  }

  const remapAnchor = (anchor: string): string | undefined => {
    const circuit = /^circuit:([^:]+):into:(.+):(AC|DC)$/.exec(anchor)
    if (circuit) {
      const id = maps.circuit.get(circuit[1]!)
      const node = nodes.get(circuit[2]!)
      return id && node ? `circuit:${id}:into:${node}:${circuit[3]}` : undefined
    }
    const prefix = `panel:${panelId}:into:protection:`
    if (!anchor.startsWith(prefix)) return undefined
    const tap = /^(.*):(AC|DC)$/.exec(anchor.slice(prefix.length))
    const id = tap && maps.protection.get(tap[1]!)
    return id ? `${prefix}${id}:${tap![2]}` : undefined
  }

  const copies: WireRun[] = []
  for (const source of selectProjectWireRuns(project)) {
    const members = source.members.flatMap((from) => {
      const to = remapAnchor(from)
      return to ? [{ from, to }] : []
    })
    if (members.length === 0) continue
    const copy = JSON.parse(JSON.stringify(source)) as WireRun
    copy.id = newId()
    copy.members = members.map(({ to }) => to)
    // A duplicated cable has new physical cores, rather than aliases back to the source cable.
    delete copy.coreAliases
    copy.conductors = copy.conductors.map((conductor) => {
      const port = conductor.assignment?.port
      const ids =
        port?.kind === 'endpoint'
          ? maps.endpoint
          : port?.kind === 'trunk_device'
            ? maps.trunkDevice
            : maps.protection
      if (port && ids.has(port.id)) port.id = ids.get(port.id)!
      return { ...conductor, id: newId() }
    })
    const remapEntries = <T>(
      entries: Record<string, T> | undefined
    ): Record<string, T> | undefined =>
      entries &&
      Object.fromEntries(
        members.flatMap(({ from, to }) =>
          entries[from] !== undefined ? [[to, entries[from]!]] : []
        )
      )
    copy.segmentLengths = remapEntries(source.segmentLengths)
    copy.segmentLengthSources = remapEntries(source.segmentLengthSources)
    copies.push(copy)
  }
  if (copies.length > 0) editProjectWireRuns(project).push(...copies)
}
