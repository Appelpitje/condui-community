import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { liftCircuitNotesClearOfFrames } from '@/lib/eendraad/circuitNotesFrameClearance'
import { queryOneWireFrames } from '@/lib/projectV2/annotations'
import { useMemo, useRef } from 'react'
import { freeze } from 'immer'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { calculateBottomUpLayout, type BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { buildLayoutTree, type LayoutTree } from '@/lib/layout/layoutTree'
import { deriveWires } from '@/lib/layout/deriveWires'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import {
  simulatePanelAttachmentMoveOnProject,
  simulateProtectionRelocationOnProject,
  simulateDropOnProject,
  simulateEndpointSelectionMoveOnProject,
  simulateSupplyTrunkDeviceRelocationOnProject,
  simulateTrunkDeviceRelocationOnProject,
  type EendraadPreviewChangeSet,
} from '@/lib/layout/eendraadPreviewSimulation'
import type { WireSegment, Endpoint, ProtectionDevice, TrunkDevice, Panel } from '@/types/schema'
import { buildStablePreviewCircuitOverrides } from '@/lib/layout/previewCircuitAnchorOverrides'
import type { DragPreviewState } from './useEendraadDragPreview'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { withPanelReadContext } from '@/lib/panel/panelReadContext'

export interface EendraadPreviewGraph {
  layout: BottomUpLayoutResult
  layoutTree: LayoutTree
  /** Wires for the affected panels displayed by the preview overlay. */
  wireSegments: WireSegment[]
  /** Simulated project after applying the hypothetical drop. */
  project: ProjectWithOptionalV2Electrical
  /** Lookup tables for preview symbols. */
  endpointsById: Map<string, Endpoint>
  protectionsById: Map<string, ProtectionDevice>
  trunkDevicesById: Map<string, TrunkDevice>
  /** IDs of panels whose layout changed. */
  affectedPanelIds: string[]
  /** Circuits that changed (new or structurally updated). */
  affectedCircuitIds: string[]
  /** Endpoints created by this preview. */
  createdEndpointIds: string[]
  /** Protections created by this preview. */
  createdProtectionIds: string[]
  /** Trunk devices created by this preview. */
  createdTrunkDeviceIds: string[]
}

/**
 * The simulated graph depends on where a drop would commit, not on the exact
 * pointer coordinate. Keeping this key stable while the pointer remains in the
 * same slot prevents a full project clone and layout pass for every drag event.
 */
export function getEendraadPreviewIntentKey(
  dragPreview: DragPreviewState | null
): string | null {
  if (!dragPreview) return null
  return JSON.stringify({
    symbolId: dragPreview.symbolData?.id ?? null,
    // Main-bus protection moves use a lightweight overlay, so keeping the
    // resolved insertion slot in the intent key does not trigger an expensive
    // simulated layout. It does ensure the live preview follows the slot when
    // the pointer crosses a split bus segment.
    dropTarget: dragPreview.dropTarget,
    relocatingTrunkDevice: dragPreview.relocatingTrunkDevice,
    relocatingSupplyTrunkDevice: dragPreview.relocatingSupplyTrunkDevice,
    movingEndpointSelection: dragPreview.movingEndpointSelection,
    movingPanelAttachment: dragPreview.movingPanelAttachment,
    movingProtection: dragPreview.movingProtection,
    sameSymbolAddMoreNodeId: dragPreview.sameSymbolAddMore?.nodeId,
  })
}

export function usesLightweightProtectionMovePreview(
  dragPreview: DragPreviewState | null
): boolean {
  return !!dragPreview?.movingProtection && dragPreview.dropTarget?.type !== 'circuit'
}

/**
 * Compute a full layout+wire preview graph for the current drag preview,
 * using a simulated project that includes the hypothetical drop.
 */
export function useEendraadPreviewGraph(
  dragPreview: DragPreviewState | null,
  currentLayout: BottomUpLayoutResult | null = null
): EendraadPreviewGraph | null {
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const eendraadLayoutOverrides = useUIStore((s: UIState) => s.eendraadLayoutOverrides)
  const intentKey = getEendraadPreviewIntentKey(dragPreview)
  const stableIntentRef = useRef<{
    key: string | null
    preview: DragPreviewState | null
  }>({ key: intentKey, preview: dragPreview })
  if (stableIntentRef.current.key !== intentKey) {
    stableIntentRef.current = { key: intentKey, preview: dragPreview }
  }
  const previewIntent = stableIntentRef.current.preview
  // A -> B -> A is common while hovering buses. Retain only a few completed
  // graphs, scoped to the exact project, camera-independent layout and overrides.
  const recentPreviews = useMemo(() => new Map<string, EendraadPreviewGraph>(),
    [currentProject, currentLayout, eendraadLayoutOverrides])

  return useMemo(() => {
    if (!currentProject || !previewIntent || !previewIntent.symbolData) return null
    const cached = intentKey == null ? undefined : recentPreviews.get(intentKey)
    if (cached && intentKey != null) {
      recentPreviews.delete(intentKey)
      recentPreviews.set(intentKey, cached)
      return cached
    }

    let sim: EendraadPreviewChangeSet | null = null
    if (previewIntent.movingPanelAttachment) {
      sim = simulatePanelAttachmentMoveOnProject(
        currentProject,
        previewIntent.movingPanelAttachment,
        previewIntent.dropTarget ?? { type: null },
      )
    } else if (previewIntent.movingEndpointSelection) {
      sim = simulateEndpointSelectionMoveOnProject(
        currentProject,
        previewIntent.movingEndpointSelection,
        previewIntent.dropTarget ?? { type: null },
      )
    } else if (previewIntent.movingProtection) {
      // Reordering an existing protection on a main bus needs only the cheap
      // legacy bus/slot overlay. Simulating a normal drop here used to clone the
      // project and lay out a newly-created protection on every pointer move.
      if (usesLightweightProtectionMovePreview(previewIntent)) return null
      const protectionDropTarget = previewIntent.dropTarget
      if (!protectionDropTarget || protectionDropTarget.type !== 'circuit') return null
      sim = simulateProtectionRelocationOnProject(
        currentProject,
        previewIntent.movingProtection,
        protectionDropTarget
      )
    } else if (previewIntent.relocatingSupplyTrunkDevice) {
      sim = simulateSupplyTrunkDeviceRelocationOnProject(
        currentProject,
        previewIntent.relocatingSupplyTrunkDevice,
        previewIntent.dropTarget ?? { type: null },
      )
    } else if (previewIntent.relocatingTrunkDevice) {
      sim = simulateTrunkDeviceRelocationOnProject(
        currentProject,
        previewIntent.relocatingTrunkDevice,
        previewIntent.symbolData,
        previewIntent.dropTarget ?? { type: null },
      )
    } else {
      sim = simulateDropOnProject(
        currentProject,
        previewIntent.symbolData,
        previewIntent.dropTarget ?? { type: null },
      )
    }
    if (!sim) return null
    // Simulation is complete. Immutable snapshots can share phase/bus/topology
    // indexes throughout both layout passes and wire generation.
    freeze(sim.project, true)

    // Convert overrides Map<string, PointLike> from uiStore to a plain Map for the layout engine.
    const overrides = new Map<string, { x: number; y: number }>()
    eendraadLayoutOverrides.forEach((value, key) => {
      overrides.set(key, value)
    })

    const layoutOptions = { infoBlockLogo: currentLayout?.infoBlockLogo === true }
    const preliminaryLayout = calculateBottomUpLayout(sim.project, overrides, layoutOptions)
    const stableOverrides = currentLayout
      ? buildStablePreviewCircuitOverrides(
          currentLayout,
          preliminaryLayout,
          overrides,
          sim.affectedPanelIds
        )
      : overrides
    const layout = currentLayout
      ? calculateBottomUpLayout(sim.project, stableOverrides, layoutOptions)
      : preliminaryLayout
    if (!layout) return null
    liftCircuitNotesClearOfFrames(layout, sim.project, queryOneWireFrames(sim.project))

    const layoutTree = buildLayoutTree(layout)
    // Wire derivation is independent for each panel; the overlay only draws
    // affected panels. Keep the full tree for layout/anchor comparisons while
    // avoiding phase and wire work for every other board in a campus.
    const affectedPanels = new Set(sim.affectedPanelIds)
    const previewWireTree = { ...layoutTree, panels: layoutTree.panels.filter(
      (panel) => panel.domainId != null && affectedPanels.has(panel.domainId)
    ) }
    // Share the finalized preview's lookups across wire readers.
    const wireSegments = withPanelReadContext(sim.project, () =>
      deriveWires(
        previewWireTree,
        getProjectElectricalPanels(sim.project),
        getProjectElectricalInstallation(sim.project),
        selectProjectSupplyAssemblies(sim.project),
        (deviceId) => resolveSupplyDeviceMounting(sim.project, deviceId),
        selectProjectWireRuns(sim.project),
      )
    )

    // Build lookup maps for preview symbols
    const endpointsById = new Map<string, Endpoint>()
    const protectionsById = new Map<string, ProtectionDevice>()
    const trunkDevicesById = new Map<string, TrunkDevice>()

    const panelStack: Panel[] = [...getProjectElectricalPanels(sim.project)]
    while (panelStack.length) {
      const panel = panelStack.pop()!

      panel.circuits.forEach((circuit) => {
        circuit.endpoints.forEach((ep) => endpointsById.set(ep.id, ep))
        circuit.trunkDevices?.forEach((td) => trunkDevicesById.set(td.id, td))
        circuit.branches?.forEach((branch) =>
          branch.branchDevices?.forEach((td) => trunkDevicesById.set(td.id, td))
        )
      })

      panel.protections?.forEach((prot) => {
        protectionsById.set(prot.id, prot)
        prot.circuits?.forEach((circuit) => {
          circuit.endpoints.forEach((ep) => endpointsById.set(ep.id, ep))
          circuit.trunkDevices?.forEach((td) => trunkDevicesById.set(td.id, td))
          circuit.branches?.forEach((branch) =>
            branch.branchDevices?.forEach((td) => trunkDevicesById.set(td.id, td))
          )
        })
      })

      if (panel.subPanels?.length) {
        panelStack.push(...panel.subPanels)
      }
    }

    // Include supply and ground trunk devices in lookup so preview can
    // highlight them when added on supply/ground wires.
    const installation = getProjectElectricalInstallation(sim.project)
    if (installation?.mainSupply?.supplyTrunkDevices) {
      installation.mainSupply.supplyTrunkDevices.forEach((d) => {
        trunkDevicesById.set(d.id, d)
      })
    }
    for (const device of collectAllGroundTrunkDevices(
      getProjectElectricalPanels(sim.project),
      installation
    )) {
      trunkDevicesById.set(device.id, device)
    }

    const graph: EendraadPreviewGraph = {
      layout,
      layoutTree,
      wireSegments,
      project: sim.project,
      endpointsById,
      protectionsById,
      trunkDevicesById,
      affectedPanelIds: Array.from(new Set(sim.affectedPanelIds)),
      affectedCircuitIds: Array.from(new Set(sim.affectedCircuitIds)),
      createdEndpointIds: Array.from(new Set(sim.createdEndpointIds)),
      createdProtectionIds: Array.from(new Set(sim.createdProtectionIds)),
      createdTrunkDeviceIds: Array.from(
        new Set([...sim.createdTrunkDeviceIds, ...sim.movedTrunkDeviceIds]),
      ),
    }
    if (intentKey != null) {
      if (recentPreviews.size >= 4) recentPreviews.delete(recentPreviews.keys().next().value!)
      recentPreviews.set(intentKey, graph)
    }
    return graph
  }, [currentProject, currentLayout, previewIntent, eendraadLayoutOverrides, recentPreviews, intentKey])
}
