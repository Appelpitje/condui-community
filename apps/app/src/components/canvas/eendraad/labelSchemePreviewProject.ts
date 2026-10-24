import { produce } from 'immer'
import type { LabelScheme } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { createHeadlessProjectSession, projectCommands, type CommandEnv } from '@/lib/commands/project'
import type { EntityRef } from '@/lib/commands/project/types'
import { applyAutomaticEendraadNamingAllPanelsInProject } from '@/lib/eendraad/projectElectricalDomain'
import { labelSchemeForStorage } from '@/lib/eendraad/labelScheme'
import {
  getEditableProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { createEmptyProjectV2 } from '@/utils/project'

function sampleEnv(language: string): CommandEnv {
  let next = 0
  return {
    newId: () => `label-preview-${next++}`,
    now: () => '2026-01-01T00:00:00.000Z',
    language,
  }
}

const createdId = (refs: EntityRef[], kind: EntityRef['kind']): string => {
  const ref = refs.find((candidate) => candidate.kind === kind)
  if (!ref) throw new Error(`Label preview sample: no ${kind} created`)
  return ref.id
}

/**
 * The fixed project behind the label style preview, built with the same commands as the editor:
 * a lighting circuit with three lights, a 30 mA differential feeding two socket circuits, a
 * domotica module with three outputs, and a circuit feeding a sub-panel with two circuits.
 */
function buildLabelSchemeSampleProject(language: string): ProjectV2 {
  const empty = createEmptyProjectV2('Label preview')
  // No meter or supply breakers: the preview is about circuit labels and stays compact.
  const installation = getEditableProjectElectricalInstallation(empty)
  if (installation) {
    installation.mainSupply.supplyTrunkDevices = []
    if (installation.feedTopology) {
      installation.feedTopology.sharedFeed.trunkDevices = []
      for (const feed of installation.feedTopology.rootFeeds) feed.trunkDevices = []
    }
  }
  const session = createHeadlessProjectSession(empty, {
    registry: projectCommands,
    env: sampleEnv(language),
  })
  const place = (symbolId: string, destination: unknown): EntityRef[] =>
    session.execute([{ id: 'electrical.placeSymbol', input: { symbolId, destination } }]).results[0]!.created
  const mainPanelId = getProjectElectricalPanels(session.project)[0]!.id

  const lighting = createdId(place('mcb', { kind: 'panelBus', panelId: mainPanelId }), 'circuit')
  for (let i = 0; i < 3; i++) place('light_point', { kind: 'circuit', circuitId: lighting })

  const differential = createdId(place('rcd', { kind: 'panelBus', panelId: mainPanelId }), 'circuit')
  const socketsA = createdId(place('mcb', { kind: 'circuit', circuitId: differential }), 'circuit')
  const socketsB = createdId(place('mcb', { kind: 'circuit', circuitId: differential }), 'circuit')
  place('socket', { kind: 'circuit', circuitId: socketsA })
  place('socket', { kind: 'circuit', circuitId: socketsA })
  place('socket', { kind: 'circuit', circuitId: socketsB })

  const domotica = createdId(place('mcb', { kind: 'panelBus', panelId: mainPanelId }), 'circuit')
  const module = createdId(place('domotica', { kind: 'circuit', circuitId: domotica }), 'endpoint')
  session.execute([
    {
      id: 'properties.edit',
      input: { edits: [{ kind: 'endpoint', ids: [module], set: { domoticaProps: { endpointCount: 3 } } }] },
    },
  ])
  ;['light_point', 'light_point', 'motor'].forEach((symbolId, index) => {
    session.execute([
      {
        id: 'electrical.placeSymbol',
        input: {
          symbolId,
          target: {
            type: 'endpoint',
            panelId: mainPanelId,
            circuitId: domotica,
            endpointId: module,
            branchEndpoints: [module],
            insertAfterEndpointId: module,
            domoticaOutput: { group: 'endpoint', index },
          },
        },
      },
    ])
  })

  const feeder = createdId(place('mcb', { kind: 'panelBus', panelId: mainPanelId }), 'circuit')
  const subPanelId = createdId(place('panel_distribution', { kind: 'circuit', circuitId: feeder }), 'panel')
  const subLighting = createdId(place('mcb', { kind: 'panelBus', panelId: subPanelId }), 'circuit')
  place('light_point', { kind: 'circuit', circuitId: subLighting })
  const subSockets = createdId(place('mcb', { kind: 'panelBus', panelId: subPanelId }), 'circuit')
  place('socket', { kind: 'circuit', circuitId: subSockets })

  return session.project
}

const samples = new Map<string, ProjectV2>()

export function getLabelSchemeSampleProject(language: string): ProjectV2 {
  let sample = samples.get(language)
  if (!sample) {
    sample = buildLabelSchemeSampleProject(language)
    samples.set(language, sample)
  }
  return sample
}

/** The sample relabelled with `scheme`, as automatic naming would label it. */
export function labelSchemePreviewProject(
  sample: ProjectV2,
  scheme: LabelScheme,
  options: { panelNumberingEnabled: boolean; hideFeederLetters: boolean }
): ProjectV2 {
  return produce(sample, (draft) => {
    const installation = getEditableProjectElectricalInstallation(draft)
    if (!installation) return
    installation.labelScheme = labelSchemeForStorage(scheme)
    installation.panelNumberingEnabled = options.panelNumberingEnabled
    installation.eendraadAutomaticNaming = true
    installation.eendraadAutoNamingHideFeederLetters = options.hideFeederLetters
    applyAutomaticEendraadNamingAllPanelsInProject(draft)
  })
}
