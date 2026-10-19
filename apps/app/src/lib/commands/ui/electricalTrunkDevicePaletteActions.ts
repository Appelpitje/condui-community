import type { ProjectV2 } from '@/types/projectV2'
import type { Selection } from '@/types/ui'
import type { TrunkDevice } from '@/types/schema'
import type { CommandInvocation } from '../project'
import type { ProjectPaletteAction } from './projectPaletteActions'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { projectCommands } from '../project'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { isSupplyTrunkDeviceDropTarget } from '@/lib/eendraad/supplyTrunkDeviceMove'
import i18n from '@/i18n'

type Candidate = { input: Record<string, unknown>; label: string }

function commandAccepts(project: ProjectV2, invocation: CommandInvocation): boolean {
  try {
    const { command, input } = projectCommands.parseOne(invocation)
    return command.check(project, input).ok
  } catch {
    return false
  }
}

function singleSelectedTrunkDevice(
  project: ProjectV2,
  selection: Selection
): TrunkDevice | undefined {
  if (selection.type !== 'trunkDevice' || selection.ids.length !== 1) return undefined
  const id = selection.ids[0]
  const supply = queryAllSupplyTrunkDevices(project).find((device) => device.id === id)
  if (supply) return supply
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    for (const circuit of collectCircuits(panel)) {
      const device = circuit.trunkDevices?.find((candidate) => candidate.id === id)
      if (device) return device
    }
  }
  return undefined
}

function supplyDestinations(project: ProjectV2, device: TrunkDevice): Candidate[] {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const shared =
    installation.mainSupply.supplyTrunkDevices ??
    installation.feedTopology?.sharedFeed.trunkDevices ??
    []
  const targets: Array<{
    type: DropTarget['type']
    scope: 'shared' | 'root'
    panelId?: string
    label: string
    devices: TrunkDevice[]
  }> = [
    {
      type: 'supplyWire',
      scope: 'shared',
      label: i18n.t('commandPalette.values.sharedSupply'),
      devices: shared,
    },
  ]
  for (const feed of installation.feedTopology?.rootFeeds ?? []) {
    const panel = getProjectElectricalPanels(project).find(
      (candidate) => candidate.id === feed.panelId
    )
    if (!panel) continue
    const devices = feed.trunkDevices ?? []
    for (const [type, valueKey] of [
      ['supplyWire', 'supplyWire'],
      ['supplyBackupWire', 'backupWire'],
      ['supplyBackupOutputWire', 'backupOutput'],
      ['supplyChangeoverGridWire', 'changeoverGrid'],
      ['supplyConverterGridWire', 'converterGrid'],
      ['supplyConverterDcWire', 'converterDc'],
    ] as const) {
      targets.push({
        type,
        scope: 'root',
        panelId: panel.id,
        label: i18n.t('commandPalette.values.supplyDestination', {
          panel: panel.name,
          lane: i18n.t(`commandPalette.values.${valueKey}`),
        }),
        devices,
      })
    }
  }
  const options: Candidate[] = []
  for (const target of targets) {
    const indexes = Array.from({ length: target.devices.length + 1 }, (_, index) => index)
    for (const index of indexes) {
      const input = {
        deviceId: device.id,
        target: {
          type: target.type,
          panelId: target.panelId,
          supplyFeedScope: target.scope,
          supplyDeviceInsertIndex: index,
        },
      }
      if (
        isSupplyTrunkDeviceDropTarget(device, input.target as DropTarget) &&
        commandAccepts(project, {
          id: 'electrical.moveSupplyTrunkDevice',
          input,
        })
      ) {
        options.push({
          input,
          label: i18n.t('commandPalette.values.destinationAtPosition', {
            destination: target.label,
            position: index + 1,
          }),
        })
      }
    }
  }
  return options
}

function circuitDestinations(project: ProjectV2, deviceId: string): Candidate[] {
  const panels = getProjectElectricalPanels(project)
  const circuits = walkPanels(panels).flatMap((panel) =>
    collectCircuits(panel).map((circuit) => ({ panel, circuit }))
  )
  const options: Candidate[] = []
  for (const { panel, circuit } of circuits) {
    const positions = Array.from(
      { length: (circuit.trunkDevices?.length ?? 0) + 1 },
      (_, index) => index
    )
    for (const index of positions) {
      const input = {
        deviceId,
        sourceCircuitId: sourceCircuitForDevice(project, deviceId) ?? '',
        target: {
          type: 'circuit',
          panelId: panel.id,
          circuitId: circuit.id,
          circuitTrunkSegmentIndex: index,
        },
      }
      if (commandAccepts(project, { id: 'electrical.moveCircuitTrunkDevice', input })) {
        options.push({
          input,
          label: i18n.t('commandPalette.values.circuitDestinationAtPosition', {
            panel: panel.name,
            circuit: circuit.code || circuit.id,
            position: index + 1,
          }),
        })
      }
    }
  }
  return options
}

function sourceCircuitForDevice(project: ProjectV2, deviceId: string): string | undefined {
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    for (const circuit of collectCircuits(panel)) {
      if (circuit.trunkDevices?.some((device) => device.id === deviceId)) return circuit.id
    }
  }
  return undefined
}

/** Palette routes for the same explicit one-wire relocation intents used by canvas commits. */
export function getElectricalTrunkDevicePaletteActions(
  project: ProjectV2,
  selection: Selection
): ProjectPaletteAction[] {
  const device = singleSelectedTrunkDevice(project, selection)
  if (!device) return []
  const supplyDevice = queryAllSupplyTrunkDevices(project).some(
    (candidate) => candidate.id === device.id
  )
  if (supplyDevice) {
    const candidates = supplyDestinations(project, device)
    if (!candidates.length) return []
    return [
      {
        id: 'electrical.moveSupplyTrunkDevice',
        labelKey: 'commandPalette.moveSupplyDevice',
        fields: [
          {
            name: 'destination',
            labelKey: 'commandPalette.fields.destination',
            value: '0',
            options: candidates.map((candidate, index) => ({
              value: String(index),
              label: candidate.label,
            })),
          },
        ],
        invocation: (values) =>
          candidates[Number(values.destination)]
            ? {
                id: 'electrical.moveSupplyTrunkDevice',
                input: candidates[Number(values.destination)]!.input,
              }
            : { id: 'electrical.moveSupplyTrunkDevice', input: {} },
      },
    ]
  }

  const sourceCircuitId = sourceCircuitForDevice(project, device.id)
  if (!sourceCircuitId) return []
  const candidates = circuitDestinations(project, device.id)
  if (!candidates.length) return []
  return [
    {
      id: 'electrical.moveCircuitTrunkDevice',
      labelKey: 'commandPalette.moveCircuitTrunkDevice',
      fields: [
        {
          name: 'destination',
          labelKey: 'commandPalette.fields.destination',
          value: '0',
          options: candidates.map((candidate, index) => ({
            value: String(index),
            label: candidate.label,
          })),
        },
      ],
      invocation: (values) =>
        candidates[Number(values.destination)]
          ? {
              id: 'electrical.moveCircuitTrunkDevice',
              input: candidates[Number(values.destination)]!.input,
            }
          : { id: 'electrical.moveCircuitTrunkDevice', input: {} },
    },
  ]
}
