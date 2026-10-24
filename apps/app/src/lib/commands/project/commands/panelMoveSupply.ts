import { z } from 'zod'
import { findCircuitOwner, panelContainsDescendant } from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById } from '@/lib/panel/panelTree'
import { movePanelToCircuitInProject, promotePanelToRootSupply } from '@/lib/panel/panelSupplyMove'
import { isDomoticaPanelFeedEndpoint, resolvePanelSupplyLinkForPanelInPanels } from '@/lib/eendraad/panelSupplyLink'
import { attachRootPanelToExistingSupplyAssembly } from '@/lib/supplyAssembly/panelHandoff'
import {
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { CommandError, defineProjectCommand } from '../types'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'

export const panelMoveSupplyInputSchema = z.strictObject({
  panelId: z.string().min(1),
  target: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('supply') }),
    z.strictObject({ type: z.literal('circuit'), circuitId: z.string().min(1) }),
  ]),
})

export const panelMoveSupply = defineProjectCommand({
  id: 'panel.moveSupply',
  version: 1,
  input: panelMoveSupplyInputSchema,
  check(project, input) {
    const panels = getProjectElectricalPanels(project)
    const installation = getProjectElectricalInstallation(project)
    const panel = findPanelById(panels, input.panelId)
    if (!installation || !panel)
      return { ok: false, code: 'unknown_panel', message: 'Panel no longer exists.' }
    if (isDomoticaPanelFeedEndpoint(resolvePanelSupplyLinkForPanelInPanels(panels, panel.id)?.sourcePanelEndpoint))
      return { ok: false, code: 'output_feed', message: 'This panel is connected to a domotica output.' }
    if (input.target.type === 'supply') {
      return { ok: true }
    }

    const target = findCircuitOwner(panels, input.target.circuitId)
    if (!target || !target.protection)
      return { ok: false, code: 'unknown_target', message: 'Target circuit cannot feed a panel.' }
    if (target.protection.subPanelId && target.protection.subPanelId !== panel.id)
      return { ok: false, code: 'occupied_target', message: 'Target already feeds another panel.' }
    if (target.panel.id === panel.id || panelContainsDescendant(panel, target.panel.id))
      return { ok: false, code: 'cyclic_target', message: 'A panel cannot feed itself or a descendant.' }
    const previous = resolvePanelSupplyLinkForPanelInPanels(panels, panel.id)
    if (previous?.protection.id === target.protection.id)
      return { ok: true }
    return { ok: true }
  },
  apply(draft, input) {
    const beforeRefs = collectTopologyRefs(draft)
    const panels = getProjectElectricalPanels(draft)
    const panel = findPanelById(panels, input.panelId)
    if (!panel) throw new CommandError('check_failed', 'Panel no longer exists.')

    if (input.target.type === 'circuit') {
      const previous = resolvePanelSupplyLinkForPanelInPanels(panels, panel.id)
      const targetOwner = findCircuitOwner(panels, input.target.circuitId)
      if (previous && targetOwner?.protection?.id === previous.protection.id) {
        return { created: [], changed: [], removed: [], related: [], select: [] }
      }
      const result = movePanelToCircuitInProject(draft, panel.id, input.target.circuitId)
      if (!result.ok) throw new CommandError('check_failed', result.message, { reason: result.code })
      const afterRefs = collectTopologyRefs(draft)
      const diff = diffTopologyRefs(beforeRefs, afterRefs)
      return {
        ...diff,
        related: [],
        select: diff.changed.length || diff.created.length || diff.removed.length
          ? [{ kind: 'panel' as const, id: panel.id }]
          : [],
      }
    }

    if (panel.isMain === true) return { created: [], changed: [], removed: [], related: [], select: [] }

    const editablePanels = getEditableProjectElectricalPanels(draft)
    const installation = getEditableProjectElectricalInstallation(draft)
    if (!installation) throw new CommandError('check_failed', 'Electrical installation is missing.')
    const result = promotePanelToRootSupply(editablePanels, installation, input.panelId)
    if (!result) throw new CommandError('check_failed', 'Panel could not be moved to the supply.')
    attachRootPanelToExistingSupplyAssembly(draft, input.panelId)
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
