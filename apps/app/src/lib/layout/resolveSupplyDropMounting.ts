import type { DropTarget } from '@/lib/layout/findDropTarget'
import { getPanelDiagramId } from '@/lib/layout/bottomUpLayout'
import { getSupplyEnclosureBoundaryCenter } from '@/lib/layout/supplyEnclosureBoundaryGeometry'
import {
  getSupplyConverterDcConnectionIndex,
  getSupplyConverterDcPath,
} from '@/lib/supplyAssembly/converterDcConnections'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'
import type { Point } from '@/types/ui'
import type { TrunkDevice, WireSegment } from '@/types/schema'

function supplyDeviceMatchesTargetLane(device: TrunkDevice, target: DropTarget): boolean {
  const path = device.supplyPath
  if (target.type === 'supplyConverterDcWire') {
    const targetConnectionIndex =
      target.supplyConverterDcConnectionIndex ?? (target.supplyConverterDcBranch === 'top' ? 1 : 0)
    return (
      path === getSupplyConverterDcPath(targetConnectionIndex) &&
      getSupplyConverterDcConnectionIndex(device) === targetConnectionIndex
    )
  }
  if (target.type === 'supplyConverterGridWire') {
    return path === 'converter-grid' || path === 'backup' || path === 'converter-branch'
  }
  if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
    return path === 'backup-output' || path === 'backup'
  }
  if (target.type === 'supplyChangeoverGridWire') {
    return path === 'changeover-grid' || device.symbol === 'source_changeover'
  }
  return path == null || path === 'serial' || device.symbol === 'source_changeover'
}

/** Infer the enclosure region under a one-wire drop from nearby mounted devices. */
export function resolveSupplyDropMounting(
  project: ProjectWithOptionalV2Electrical,
  panelLayout: BottomUpPanelLayout,
  target: DropTarget,
  position: Point,
  wireSegments: WireSegment[] = []
): ElectricalEnclosureRef {
  const ownerPanelId = panelLayout.ownerPanelId ?? panelLayout.panel.id
  const candidates: Array<{
    mounting: ElectricalEnclosureRef
    distance: number
    x: number
    y: number
  }> = (panelLayout.supplyDevices ?? [])
    .filter(({ device }) => supplyDeviceMatchesTargetLane(device, target))
    .map(({ device, x, y }) => ({
      mounting: resolveSupplyDeviceMounting(project, device.id),
      distance: Math.hypot(position.x - x, position.y - y),
      x,
      y,
    }))
    .filter(
      (
        candidate
      ): candidate is {
        mounting: ElectricalEnclosureRef
        distance: number
        x: number
        y: number
      } => candidate.mounting != null
    )

  if (target.type === 'supplyWire') {
    if (target.supplyFeedScope === 'shared') {
      candidates.push({
        mounting: { kind: 'grid' },
        distance: Math.hypot(position.x - panelLayout.supply.x, position.y - panelLayout.supply.y),
        x: panelLayout.supply.x,
        y: panelLayout.supply.y,
      })
    } else {
      candidates.push({
        mounting: { kind: 'panel', panelId: ownerPanelId },
        distance: Math.hypot(
          position.x - panelLayout.mainBus.x,
          position.y - panelLayout.mainBus.y
        ),
        x: panelLayout.mainBus.x,
        y: panelLayout.mainBus.y,
      })
    }
  }

  const diagramId = getPanelDiagramId(panelLayout)
  const nearbyBoundary = wireSegments
    .filter(
      (segment) => segment.diagramId === diagramId && segment.supplyEnclosureBoundary === true
    )
    .map((segment) => {
      const center = getSupplyEnclosureBoundaryCenter(segment)
      const horizontalWire =
        Math.abs(segment.endPoint.x - segment.startPoint.x) >=
        Math.abs(segment.endPoint.y - segment.startPoint.y)
      const perpendicularDistance = horizontalWire
        ? Math.abs(position.y - center.y)
        : Math.abs(position.x - center.x)
      const axisDistance = horizontalWire
        ? Math.abs(position.x - center.x)
        : Math.abs(position.y - center.y)
      return { center, horizontalWire, perpendicularDistance, axisDistance }
    })
    .filter((boundary) => boundary.perpendicularDistance <= 24)
    .sort(
      (left, right) =>
        left.perpendicularDistance - right.perpendicularDistance ||
        left.axisDistance - right.axisDistance
    )[0]

  if (nearbyBoundary) {
    const boundaryAxis = nearbyBoundary.horizontalWire
      ? nearbyBoundary.center.x
      : nearbyBoundary.center.y
    const pointerAxis = nearbyBoundary.horizontalWire ? position.x : position.y
    const sameLane = candidates.filter((candidate) =>
      nearbyBoundary.horizontalWire
        ? Math.abs(candidate.y - nearbyBoundary.center.y) <= 50
        : Math.abs(candidate.x - nearbyBoundary.center.x) <= 50
    )
    const sideCandidates = sameLane.filter((candidate) => {
      const candidateAxis = nearbyBoundary.horizontalWire ? candidate.x : candidate.y
      return pointerAxis <= boundaryAxis
        ? candidateAxis <= boundaryAxis
        : candidateAxis >= boundaryAxis
    })
    sideCandidates.sort((left, right) => left.distance - right.distance)
    if (sideCandidates[0]) return sideCandidates[0].mounting
  }

  candidates.sort((left, right) => left.distance - right.distance)
  return (
    candidates[0]?.mounting ??
    (target.supplyFeedScope === 'shared'
      ? { kind: 'grid' }
      : { kind: 'panel', panelId: ownerPanelId })
  )
}
