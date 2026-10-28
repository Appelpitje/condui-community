import {
  applyNodeWireInset,
  getCircuitWirePropertiesFromResolvedOverride,
  resolveDomoticaOutputWireProperties,
} from './circuitWireDerivationSupport'
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'

import { generateId } from '@/utils'
import { type LayoutNode } from './layoutTree'
import type { WireSegment, Circuit, Panel, Installation, ProtectionDevice } from '@/types/schema'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/lib/symbols'
import { getDomoticaEndpointInputDomain } from '@/lib/eendraad/domoticaOutputOrdering'
import { findDomoticaRowRoot } from '@/lib/eendraad/domoticaRowLabel'
import {
  findSectionWireOverride,
  findSubPanelFeederWireOverride,
} from '@/lib/wires/sectionWireOverrides'

export function derivePanelGroundWires(
  panelNode: LayoutNode,
  panel: Panel,
  groundNode: LayoutNode,
  installation: Installation | undefined,
  mainBusY: number,
  detachedGridGroundY: number | undefined,
  segments: WireSegment[]
): void {
  const groundCable = installation?.groundCable || {
    kind: 'VOB',
    conductors: 1,
    sectionMm2: 6,
    hasPE: true,
  }

  // Find ground trunk device nodes (children of the panel, not the main bus)
  const groundTrunkDeviceNodes = panelNode.children
    .filter((c) => c.type === 'trunkDevice' && c.id?.startsWith('groundTrunkDevice-'))
    .sort((a, b) => b.bounds.y - a.bounds.y) // Sort by Y descending (bottom to top = ground to bus)

  if (groundTrunkDeviceNodes.length > 0) {
    // Ground wire with trunk devices: segments between ground → devices → bus.
    // Build waypoints on the vertical wire: ground (high Y) → devices → main bus (low Y)
    const waypoints: { y: number; deviceId?: string }[] = [
      { y: groundNode.bounds.y }, // Start at ground symbol
    ]

    // Add trunk devices as waypoints (already sorted high Y to low Y)
    for (const td of groundTrunkDeviceNodes) {
      waypoints.push({ y: td.bounds.y, deviceId: td.domainId })
    }

    waypoints.push({ y: detachedGridGroundY ?? mainBusY }) // End at grid lane or main bus

    // Create wire segments between consecutive waypoints
    // Apply wire insets at the ground symbol and each trunk device
    const groundX = groundNode.bounds.x
    const allNodes = [groundNode, ...groundTrunkDeviceNodes] // index 0..n-1 match waypoints 0..n-1
    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i]!
      const to = waypoints[i + 1]!
      const startPt = { x: groundX, y: from.y }
      const endPt = { x: groundX, y: to.y }

      // Apply inset on the "from" side (ground symbol or trunk device)
      const fromNode = allNodes[i]
      const adjustedStart = fromNode ? applyNodeWireInset(startPt, endPt, fromNode) : startPt

      // Apply inset on the "to" side (trunk device or main bus — bus has no inset)
      const toNode = allNodes[i + 1] // undefined for the last segment (→ main bus)
      const adjustedEnd = toNode ? applyNodeWireInset(endPt, startPt, toNode) : endPt

      segments.push({
        id: generateId(),
        type: 'vertical',
        startPoint: adjustedStart,
        endPoint: adjustedEnd,
        cable: groundCable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        hideWireLabel: true,
        fromElementType: 'ground',
        wireAnchor: deriveWireAnchorKey({
          kind: 'ground-input',
          nodeRef: to.deviceId ? `device:${to.deviceId}` : `panel:${panel.id}`,
        }),
      })
    }
  } else {
    // No ground trunk devices: simple vertical wire from ground to main bus
    const groundStart = { x: groundNode.bounds.x, y: groundNode.bounds.y }
    const groundEnd = { x: groundNode.bounds.x, y: detachedGridGroundY ?? mainBusY }
    segments.push({
      id: generateId(),
      type: 'vertical',
      startPoint: applyNodeWireInset(groundStart, groundEnd, groundNode),
      endPoint: groundEnd,
      cable: groundCable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      hideWireLabel: true,
      fromElementType: 'ground',
      wireAnchor: deriveWireAnchorKey({ kind: 'ground-input', nodeRef: `panel:${panel.id}` }),
    })
  }
}

export function deriveSubPanelIncomingWires(
  panelNode: LayoutNode,
  panel: Panel,
  parentMcbNode: LayoutNode,
  mainBusY: number,
  segments: WireSegment[]
): void {
  // Use the parent MCB's circuit cable — this is the same cable shown on the
  // main panel's circuit wire, so properties stay in sync when edited.
  const parentProtection = parentMcbNode.domainRef as ProtectionDevice | undefined
  const sourceEndpoint = parentMcbNode.sourceEndpointForWires
  const parentCircuit =
    (parentMcbNode.circuitIdForWires && Array.isArray(parentProtection?.circuits)
      ? parentProtection.circuits.find((c: Circuit) => c.id === parentMcbNode.circuitIdForWires)
      : undefined) ?? parentProtection?.circuits?.[0]
  const parentCircuitCable = parentCircuit?.cable
  const incomingDomain =
    parentCircuit && sourceEndpoint
      ? getDomoticaEndpointInputDomain(parentCircuit, sourceEndpoint.id, DEFAULT_ELECTRICAL_DOMAIN)
      : DEFAULT_ELECTRICAL_DOMAIN
  const fallbackSupplyCable = parentCircuitCable || {
    kind: 'XVB' as const,
    conductors: 3,
    sectionMm2: 6,
    hasPE: true,
  }
  // The same physical feeder is rendered once in the source panel and once as
  // the incoming supply of the target panel. Resolve the target-side copy from
  // the source panel's protection→panel section override as well, otherwise it
  // silently falls back to Circuit.cable and validation can report a different
  // section than the wire properties editor.
  const sourceOutput = sourceEndpoint?.domoticaChildProps
  const sourceModule = parentCircuit?.endpoints.find(
    (endpoint) => endpoint.id === sourceOutput?.parentEndpointId
  )
  const sourceRowRoot =
    parentCircuit && sourceEndpoint ? findDomoticaRowRoot(parentCircuit, sourceEndpoint) : undefined
  const sourceRowWire =
    sourceOutput?.outputGroup === 'endpoint'
      ? sourceModule?.domoticaProps?.endpointOutputWires?.[sourceOutput.outputIndex]
      : undefined
  const outputFeederOverride =
    parentCircuit && sourceOutput
      ? findSectionWireOverride(parentCircuit, {
          fromElementType: 'protection',
          fromElementId: parentProtection?.id,
          toElementType: 'endpoint',
          toElementId: panel.id,
          domain: incomingDomain,
        })
      : undefined
  const sourceRowOverride =
    parentCircuit && sourceOutput
      ? findSectionWireOverride(parentCircuit, {
          fromElementType: 'endpoint',
          fromElementId: sourceOutput.parentEndpointId,
          toElementType: 'endpoint',
          toElementId: sourceRowRoot?.id ?? sourceEndpoint?.id,
          domain: incomingDomain,
        })
      : undefined
  const parentFeederOverride = sourceEndpoint
    ? sourceRowOverride
    : parentCircuit
      ? findSubPanelFeederWireOverride(
          parentCircuit,
          parentProtection?.id,
          panel.id,
          incomingDomain
        )
      : undefined
  const baseSupplyWireProps = parentCircuit
    ? getCircuitWirePropertiesFromResolvedOverride(
        parentCircuit,
        incomingDomain,
        parentFeederOverride
      )
    : undefined
  const supplyWireProps =
    baseSupplyWireProps && sourceEndpoint
      ? resolveDomoticaOutputWireProperties(
          resolveDomoticaOutputWireProperties(baseSupplyWireProps, sourceRowWire),
          outputFeederOverride
        )
      : baseSupplyWireProps
  const supplyCable = supplyWireProps?.cable ?? fallbackSupplyCable

  const subPanelSupplyDeviceNodes = panelNode.children
    .filter((c) => c.type === 'trunkDevice' && c.id?.startsWith('subpanelSupplyTrunkDevice-'))
    .sort((a, b) => b.bounds.y - a.bounds.y) // bottom -> top
  const hasLocalFeederDevice = subPanelSupplyDeviceNodes.length > 0
  const waypoints: Array<{ y: number; node?: LayoutNode; deviceId?: string }> = hasLocalFeederDevice
    ? [
        { y: parentMcbNode.bounds.y, node: parentMcbNode },
        ...subPanelSupplyDeviceNodes.map((node) => ({
          y: node.bounds.y,
          node,
          deviceId: node.domainId,
        })),
        { y: mainBusY },
      ]
    : [{ y: parentMcbNode.bounds.y, node: parentMcbNode }, { y: mainBusY }]
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i]!
    const to = waypoints[i + 1]!
    if (from.y === to.y) continue
    const startPt = { x: parentMcbNode.bounds.x, y: from.y }
    const endPt = { x: parentMcbNode.bounds.x, y: to.y }
    const fromNode = from.node
    const toNode = to.node
    const adjustedStart =
      fromNode && !(sourceEndpoint && i === 0)
        ? applyNodeWireInset(startPt, endPt, fromNode)
        : startPt
    const adjustedEnd = toNode ? applyNodeWireInset(endPt, startPt, toNode) : endPt
    segments.push({
      id: generateId(),
      type: 'vertical',
      startPoint: adjustedStart,
      endPoint: adjustedEnd,
      cable: supplyCable,
      panelId: panel.id,
      domain: incomingDomain,
      circuitId: parentCircuit?.id,
      inTube: supplyWireProps?.inTube ?? parentCircuit?.inTube,
      wireRoute:
        supplyWireProps?.wireRoute ??
        parentCircuit?.wireRoute ??
        (parentCircuit?.inWall ? 'wall' : undefined),
      inWall: supplyWireProps?.inWall ?? false,
      hideWireLabel: supplyWireProps?.hideWireLabel ?? parentCircuit?.hideWireLabel,
      showFireClassLabel: supplyWireProps?.showFireClassLabel,
      wireLengthM: supplyWireProps?.wireLengthM,
      showWireLengthLabel: supplyWireProps?.showWireLengthLabel,
      fromElementType: from.deviceId || !sourceEndpoint ? 'protection' : 'endpoint',
      fromElementId: from.deviceId ?? sourceEndpoint?.id ?? parentProtection?.id,
      toElementType: to.deviceId ? 'protection' : undefined,
      toElementId: to.deviceId,
      // Anchors follow the structure snapshot: the run into the first local supply device is
      // the physical feeder cable (the edge the situation plan draws); the run into the bus is
      // the internal wire between the last device and the busbar.
      wireAnchor: deriveWireAnchorKey({
        kind: 'panel-input',
        panelId: panel.id,
        deviceId: to.deviceId,
      }),
      isSubPanelSupply: true,
      feederProtectionId: parentProtection?.id,
      domoticaOutputGroup: sourceOutput?.outputGroup,
      domoticaOutputIndex: sourceOutput?.outputIndex,
    })
  }
}
