import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import { disconnectSupplyInverterGridInputInProject } from '@/lib/supplyAssembly/disconnectInverterGridInput'
import {
  getProjectElectricalInstallation,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { CommandError, defineProjectCommand } from '../types'
import type { SupplyNode } from '@/types/supplyAssembly'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'

export const supplyDisconnectInverterGridInputInputSchema = z.strictObject({
  assemblyId: z.string().min(1),
  panelId: z.string().min(1),
})

function isInverterUnit(node: SupplyNode): node is Extract<SupplyNode, { kind: 'inverter-unit' }> {
  return node.kind === 'inverter-unit' && node.symbol === 'inverter'
}

function target(project: ProjectV2, assemblyId: string, panelId: string) {
  const installation = getProjectElectricalInstallation(project)
  const assembly = selectProjectSupplyAssemblies(project).find((item) => item.id === assemblyId)
  const node = assembly?.nodes.find(isInverterUnit)
  const deviceId = node?.deviceId ?? node?.id
  const feed = installation?.feedTopology?.rootFeeds.find((item) => item.panelId === panelId)
  const inverter = feed?.trunkDevices?.find((device) => device.id === deviceId)
  return { assembly, node, feed, inverter }
}

export const supplyDisconnectInverterGridInput = defineProjectCommand({
  id: 'supply.disconnectInverterGridInput',
  version: 1,
  input: supplyDisconnectInverterGridInputInputSchema,
  check(project, input) {
    const found = target(project, input.assemblyId, input.panelId)
    if (!found.assembly || !found.node)
      return { ok: false, code: 'stale_target', message: 'Inverter supply connection no longer exists.' }
    if (
      found.inverter?.converterGridInputConnected === false &&
      found.node.properties.gridInputConnected === false
    )
      return { ok: true }
    if (!found.feed || !found.inverter)
      return { ok: false, code: 'stale_target', message: 'Inverter supply connection no longer exists.' }
    return { ok: true }
  },
  apply(draft, input) {
    const existing = target(draft, input.assemblyId, input.panelId)
    if (
      existing.inverter?.converterGridInputConnected === false &&
      existing.node?.properties.gridInputConnected === false
    )
      return { created: [], changed: [], removed: [], related: [], select: [] }
    const beforeRefs = collectTopologyRefs(draft)
    if (!disconnectSupplyInverterGridInputInProject(draft, input.assemblyId, input.panelId))
      throw new CommandError('check_failed', 'Inverter grid input could not be disconnected.')
    const diff = diffTopologyRefs(beforeRefs, collectTopologyRefs(draft))
    return {
      ...diff,
      related: [],
      select: diff.changed.length || diff.created.length || diff.removed.length
        ? [{ kind: 'panel' as const, id: input.panelId }]
        : [],
    }
  },
})
