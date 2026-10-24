import type {
  Circuit,
  Panel,
  PanelGridModuleRef,
  PanelGridSlot,
  ProtectionDevice,
  PolesConfig,
  SymbolKey,
  TrunkDevice,
} from '@/types/schema'
import { getMainBusOrder, isCircuitNestedUnderPanelBus } from '@/lib/panel/mainBusOrder'
export { getMainBusOrder, isCircuitNestedUnderPanelBus } from '@/lib/panel/mainBusOrder'
import { getModuleWidthInCols } from '@/lib/panel/panelGridModuleWidth'
import { getDefaultTrunkDeviceProtectionProps } from '@/lib/protectionDefaults'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { clamp } from '@/lib/geometry'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'

/** First non-nested circuit that attaches a protection row to the main bus. */
function getProtectionMainBusAttachmentCircuit(
  panel: Panel,
  protection: ProtectionDevice
): Circuit | undefined {
  return (protection.circuits ?? []).find(
    (circuit) => !isCircuitNestedUnderPanelBus(panel, circuit.id)
  )
}

/**
 * Same order as {@link getMainBusOrder}, with array indices into `panel.circuits` / `panel.protections`
 * for swap-based moves (first index per protection id).
 */
export function getMainBusItemsWithIndices(panel: Panel): Array<{
  type: 'protection' | 'circuit'
  id: string
  index: number
}> {
  const items: Array<{ type: 'protection' | 'circuit'; id: string; index: number }> = []
  for (const item of getMainBusOrder(panel)) {
    if (item.type === 'circuit') {
      const idx = panel.circuits.findIndex((c) => c.id === item.id)
      if (idx >= 0) items.push({ type: 'circuit', id: item.id, index: idx })
    } else {
      const idx = panel.protections?.findIndex((p) => p.id === item.id) ?? -1
      if (idx >= 0) items.push({ type: 'protection', id: item.id, index: idx })
    }
  }
  return items
}

/**
 * Removes duplicate {@link Panel.protections} entries (same device `id`), keeping the first.
 * Duplicates can appear after ééndraad drag simulations and break naming (phantom C/D slots).
 */
export function dedupePanelProtectionsById(panel: Panel): boolean {
  if (!panel.protections?.length) return false
  const seen = new Set<string>()
  const next: ProtectionDevice[] = []
  let changed = false
  for (const p of panel.protections) {
    if (seen.has(p.id)) {
      changed = true
      continue
    }
    seen.add(p.id)
    next.push(p)
  }
  if (!changed) return false
  panel.protections = next
  return true
}

/** Dedupe protections on `panel` and all `subPanels`. */
export function dedupePanelProtectionsInPanelTree(panel: Panel): boolean {
  let any = dedupePanelProtectionsById(panel)
  for (const sub of panel.subPanels ?? []) {
    if (dedupePanelProtectionsInPanelTree(sub)) any = true
  }
  return any
}

export function dedupeAllPanelsProtectionsInProject(
  project: ProjectWithOptionalV2Electrical
): boolean {
  let any = false
  const walk = (panels: Panel[]) => {
    for (const p of panels) {
      if (dedupePanelProtectionsInPanelTree(p)) any = true
    }
  }
  walk(getProjectElectricalPanels(project))
  return any
}

const collectPanelTreeCircuits = (panel: Panel): Circuit[] =>
  [...walkPanels([panel])].flatMap((currentPanel) => collectCircuits(currentPanel))

/**
 * All circuit ids under this device, following `subCircuitIds` **only** within
 * `protection.circuits` (does not follow into other {@link ProtectionDevice} rows).
 */
export function collectCircuitIdsInProtectionDevice(protection: ProtectionDevice): Set<string> {
  const ids = new Set<string>()
  const circuits = protection.circuits ?? []
  const visit = (cid: string) => {
    if (ids.has(cid)) return
    ids.add(cid)
    const c = circuits.find((x) => x.id === cid)
    if (!c?.subCircuitIds?.length) return
    for (const sub of c.subCircuitIds) visit(sub)
  }
  for (const c of circuits) visit(c.id)
  return ids
}

/**
 * Circuits reachable from `rootProtection` across the panel: follows every `subCircuitIds` link
 * to circuits on this panel (any protection row or direct `panel.circuits`), and when any
 * circuit of a device is reached, includes **all** circuits of that same protection so sibling
 * secondary rows move together.
 */
export function collectCircuitClosureDownstreamFromProtection(
  panel: Panel,
  rootProtection: ProtectionDevice
): Set<string> {
  const idToCircuit = new Map<string, Circuit>()
  const circuitIdToProtection = new Map<string, ProtectionDevice>()
  for (const pr of panel.protections ?? []) {
    for (const c of pr.circuits ?? []) {
      idToCircuit.set(c.id, c)
      circuitIdToProtection.set(c.id, pr)
    }
  }
  for (const c of panel.circuits ?? []) {
    idToCircuit.set(c.id, c)
  }

  const ids = new Set<string>()
  const queue: string[] = []

  const enqueue = (cid: string) => {
    if (ids.has(cid)) return
    if (!idToCircuit.has(cid)) return
    queue.push(cid)
  }

  for (const c of rootProtection.circuits ?? []) enqueue(c.id)

  while (queue.length) {
    const cid = queue.shift()!
    if (ids.has(cid)) continue
    const circuit = idToCircuit.get(cid)
    if (!circuit) continue
    ids.add(cid)

    const prot = circuitIdToProtection.get(cid)
    if (prot?.circuits) {
      for (const sib of prot.circuits) enqueue(sib.id)
    }
    for (const sub of circuit.subCircuitIds ?? []) enqueue(sub)
  }

  return ids
}

export function collectProtectionsOrderedForSubtreeMove(
  panel: Panel,
  circuitClosure: Set<string>,
  rootProtection: ProtectionDevice
): ProtectionDevice[] {
  const picked: ProtectionDevice[] = []
  for (const pr of panel.protections ?? []) {
    if (!pr.circuits?.some((c) => circuitClosure.has(c.id))) continue
    picked.push(pr)
  }
  return [
    ...picked.filter((p) => p.id === rootProtection.id),
    ...picked.filter((p) => p.id !== rootProtection.id),
  ]
}

function collectDirectPanelCircuitsInClosure(panel: Panel, circuitClosure: Set<string>): Circuit[] {
  return (panel.circuits ?? []).filter((c) => circuitClosure.has(c.id) && c.code !== 'PANEL')
}

/**
 * Remove `subCircuitIds` entries that point **into** `closureIds`, but only from circuits **not**
 * in `closureIds`, so internal wiring inside the moved subtree stays intact.
 */
export function stripSubCircuitRefsFromCircuitsOutsideClosure(
  panel: Panel,
  closureIds: Set<string>
): void {
  for (const c of collectPanelTreeCircuits(panel)) {
    if (closureIds.has(c.id)) continue
    if (!c.subCircuitIds?.length) continue
    const filtered = c.subCircuitIds.filter((id) => !closureIds.has(id))
    if (filtered.length !== c.subCircuitIds.length) {
      c.subCircuitIds = filtered.length ? filtered : undefined
    }
  }
}

/**
 * Pick a circuit id to drive bus moves (main bus, secondary bus, eject parent lookup).
 * Prefer the row's main-bus attachment circuit; only fall back to a nested circuit when the
 * device has no direct bus connection (fully nested on a secondary bus / parent trunk).
 */
export function pickRepresentativeCircuitIdForMainBusMove(
  panel: Panel,
  protection: ProtectionDevice
): string | undefined {
  const attach = getProtectionMainBusAttachmentCircuit(panel, protection)
  if (attach) return attach.id
  for (const c of protection.circuits ?? []) {
    if (isCircuitNestedUnderPanelBus(panel, c.id)) return c.id
  }
  return undefined
}

/**
 * Human-facing name for a new sub-panel when ejecting `protection` (label may be an auto bus letter).
 */
export function deriveDescriptiveNameFromProtectionForNewSubPanel(
  protection: ProtectionDevice
): string | undefined {
  const lbl = (protection.label ?? '').trim()
  const busLetter = /^[A-Z]{1,3}[0-9]?$/i
  if (lbl.length > 0 && !busLetter.test(lbl)) return lbl

  const c0 = protection.circuits?.[0]
  const notes = c0?.notes?.trim()
  if (notes) return notes
  const code = c0?.code?.trim()
  if (code && !/^[A-Z]{1,3}[0-9]*$/i.test(code)) return code
  if (lbl.length > 0) return lbl
  return undefined
}

/**
 * {@link getMainBusOrder} index for inserting the sub-panel **feeder** that replaces a removed row.
 * Nested-only devices are absent from that order — walk up to the nearest main-bus parent and insert **after** it.
 */
export function computeMainBusInsertIndexForEjectedProtection(
  panel: Panel,
  ejectedProtectionId: string,
  projectPanels: Panel[]
): number {
  const orderBefore = getMainBusOrder(panel)
  const direct = orderBefore.findIndex(
    (o) => o.type === 'protection' && o.id === ejectedProtectionId
  )
  if (direct >= 0) return direct

  const protection = panel.protections.find((p) => p.id === ejectedProtectionId)
  if (!protection) return orderBefore.length

  // Walk up nested parents until we hit a row that actually appears in `getMainBusOrder`
  // (the immediate feeder may be nested too, e.g. X under an RCBO).
  let current: ProtectionDevice | undefined = protection
  const visited = new Set<string>()
  for (let i = 0; i < 128 && current && !visited.has(current.id); i++) {
    visited.add(current.id)
    const currentId = current.id
    const idx = orderBefore.findIndex((o) => o.type === 'protection' && o.id === currentId)
    if (idx >= 0) return idx + 1

    const rep =
      pickRepresentativeCircuitIdForMainBusMove(panel, current) ?? current.circuits?.[0]?.id
    if (!rep || !isCircuitNestedUnderPanelBus(panel, rep)) break
    const info = findParentCircuitInfo(rep, projectPanels)
    current = info?.parentProtection ?? undefined
  }
  return orderBefore.length
}

function protectionTypeToIncomingTrunkSymbol(type: ProtectionDevice['type']): SymbolKey {
  switch (type) {
    case 'RCBO':
      return 'rcbo'
    case 'RCD':
      return 'rcd'
    case 'FUSE':
      return 'fuse'
    case 'MAIN_SWITCH':
      return 'main_switch'
    case 'SPD':
      return 'spd'
    default:
      return 'mcb'
  }
}

function orderTrunkDevicesByPosition(devices: TrunkDevice[]): TrunkDevice[] {
  if (devices.length <= 1) return [...devices]
  return [...devices].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
}

/** True if this circuit should stay on the panel as a main-bus direct circuit after the root protection row is removed. */
function circuitHasMigratableMainBusPayload(c: Circuit): boolean {
  if ((c.endpoints?.length ?? 0) > 0) return true
  if ((c.branches?.length ?? 0) > 0) return true
  if ((c.trunkDevices?.length ?? 0) > 0) return true
  return false
}

/**
 * Build a PANEL incoming-wire {@link TrunkDevice} from a main-bus {@link ProtectionDevice}
 * (used when ejecting a device onto a secondary sub-panel supply segment).
 */
export function protectionDeviceToSubPanelIncomingTrunkDevice(
  protection: ProtectionDevice,
  deviceId: string,
  polesConfig: PolesConfig
): TrunkDevice {
  const defaults = getDefaultTrunkDeviceProtectionProps(protection.type, polesConfig)
  return {
    id: deviceId,
    type: 'protection',
    symbol: protectionTypeToIncomingTrunkSymbol(protection.type),
    label: protection.label ?? '',
    trunkPosition: 0,
    ...defaults,
    protectionType: protection.type,
    ratingA: protection.ratingA ?? defaults.ratingA,
    curve: protection.curve ?? defaults.curve,
    sensitivityMa: protection.sensitivityMa ?? defaults.sensitivityMa,
    residualCurrentType: protection.residualCurrentType ?? defaults.residualCurrentType,
    selective: protection.selective,
    superImmunized: protection.superImmunized,
    breakingCapacityKa: protection.breakingCapacityKa ?? defaults.breakingCapacityKa,
    breakingCapacityOption: protection.breakingCapacityOption ?? defaults.breakingCapacityOption,
    polesConfig: protection.polesConfig ?? defaults.polesConfig,
    poles: protection.poles ?? defaults.poles,
    notes: protection.notes,
    symbolLabelDisplay: protection.symbolLabelDisplay,
  }
}

/**
 * After {@link relocateProtectionToPanelMainBus} moved a subtree onto a **secondary** panel,
 * hoists the **root** device onto the PANEL incoming trunk (between mirrored parent feeder and
 * main bus) and promotes its direct downstream rows onto the main bus while preserving any
 * nested hierarchy below those rows.
 * Mutates `panel` in place.
 */
export function promoteMovedSubPanelRootToIncomingTrunk(
  panel: Panel,
  rootProtectionId: string,
  incomingDevice: TrunkDevice
): void {
  if (panel.isMain) return

  const root = panel.protections?.find((p) => p.id === rootProtectionId)
  if (!root?.circuits?.length) return

  const panelCircuit = panel.circuits.find((c) => c.code === 'PANEL')
  if (!panelCircuit) return

  const rootCircuits = [...root.circuits]
  const directChildCircuitIds: string[] = []
  const seenDirectChildCircuitIds = new Set<string>()
  for (const circuit of rootCircuits) {
    for (const childId of circuit.subCircuitIds ?? []) {
      if (seenDirectChildCircuitIds.has(childId)) continue
      seenDirectChildCircuitIds.add(childId)
      directChildCircuitIds.push(childId)
    }
  }

  // Capture the order from the parent bus before removing the parent link. The
  // protection array can contain nested rows interleaved with their parent rows,
  // so its index order is not a reliable replacement for subCircuitIds order.
  const directChildItems: Array<{ type: 'circuit' | 'protection'; id: string }> = []
  const seenDirectChildItemKeys = new Set<string>()
  for (const childCircuitId of directChildCircuitIds) {
    const childProtection = (panel.protections ?? []).find(
      (candidate) =>
        candidate.id !== rootProtectionId &&
        candidate.circuits?.some((circuit) => circuit.id === childCircuitId)
    )
    const item = childProtection
      ? { type: 'protection' as const, id: childProtection.id }
      : panel.circuits.some(
            (circuit) => circuit.id === childCircuitId && circuit.code !== 'PANEL'
          )
        ? { type: 'circuit' as const, id: childCircuitId }
        : null
    if (!item) continue
    const key = `${item.type}:${item.id}`
    if (seenDirectChildItemKeys.has(key)) continue
    seenDirectChildItemKeys.add(key)
    directChildItems.push(item)
  }

  // The incoming protection is no longer a bus parent after this operation.
  // Promote only its direct children. Any links below those children describe
  // deeper secondary-bus hierarchy and must remain intact.
  for (const circuit of rootCircuits) {
    if (circuit.subCircuitIds?.length) circuit.subCircuitIds = undefined
  }

  for (const c of rootCircuits) {
    if (!circuitHasMigratableMainBusPayload(c)) continue
    if (panel.circuits.some((x) => x.id === c.id)) continue
    panel.circuits.push(c)
  }

  panel.protections = (panel.protections ?? []).filter((p) => p.id !== rootProtectionId)

  if (directChildItems.length > 0) {
    const protectionByCircuitId = new Map<string, ProtectionDevice>()
    for (const candidate of panel.protections) {
      for (const circuit of candidate.circuits ?? []) {
        protectionByCircuitId.set(circuit.id, candidate)
      }
    }
    const orderedProtections: ProtectionDevice[] = []
    const orderedProtectionIds = new Set<string>()
    const appendProtectionTree = (protectionId: string): void => {
      if (orderedProtectionIds.has(protectionId)) return
      const candidate = panel.protections.find((protection) => protection.id === protectionId)
      if (!candidate) return
      orderedProtectionIds.add(candidate.id)
      orderedProtections.push(candidate)
      for (const circuit of candidate.circuits ?? []) {
        for (const childCircuitId of circuit.subCircuitIds ?? []) {
          const childProtection = protectionByCircuitId.get(childCircuitId)
          if (childProtection) appendProtectionTree(childProtection.id)
        }
      }
    }

    for (const item of directChildItems) {
      if (item.type === 'protection') appendProtectionTree(item.id)
    }
    for (const candidate of panel.protections) appendProtectionTree(candidate.id)
    panel.protections = orderedProtections
  }

  const previous = orderTrunkDevicesByPosition(panelCircuit.trunkDevices ?? [])
  const kept = previous.filter((d) => d.type !== 'protection')
  const merged = [...kept, { ...incomingDevice, trunkPosition: kept.length }]
  panelCircuit.trunkDevices = merged.map((d, i) => ({ ...d, trunkPosition: i }))

  const currentMainBusOrder = getMainBusOrder(panel)
  if (directChildItems.length > 0) {
    const directChildKeys = new Set(
      directChildItems.map((item) => `${item.type}:${item.id}`)
    )
    const firstDirectIndex = currentMainBusOrder.findIndex((item) =>
      directChildKeys.has(`${item.type}:${item.id}`)
    )
    const insertIndex =
      firstDirectIndex < 0
        ? currentMainBusOrder.length
        : currentMainBusOrder
            .slice(0, firstDirectIndex)
            .filter((item) => !directChildKeys.has(`${item.type}:${item.id}`)).length
    const remainingMainBusItems = currentMainBusOrder.filter(
      (item) => !directChildKeys.has(`${item.type}:${item.id}`)
    )
    rebuildPanelMainBusFromOrder(panel, [
      ...remainingMainBusItems.slice(0, insertIndex),
      ...directChildItems,
      ...remainingMainBusItems.slice(insertIndex),
    ])
  } else {
    rebuildPanelMainBusFromOrder(panel, currentMainBusOrder)
  }
}

function rebuildPanelMainBusFromOrder(
  panel: Panel,
  newOrder: Array<{ type: 'circuit' | 'protection'; id: string }>
): void {
  const oldProtectionsSnapshot = [...(panel.protections ?? [])]
  const oldCircuitsSnapshot = [...(panel.circuits ?? [])]

  const mainProtectionIds = newOrder
    .filter((item): item is { type: 'protection'; id: string } => item.type === 'protection')
    .map((item) => item.id)
  const mainProtectionSet = new Set(mainProtectionIds)

  /**
   * Non–main-bus protections that sat between `leftMainId` and `rightMainId` in the pre-rebuild
   * `panel.protections` array (so inserting/reordering main rows does not flush nested modules to
   * the end of the array, which breaks nesting on the panel canvas).
   */
  const nestedBetweenMains = (
    leftMainId: string | null,
    rightMainId: string | null
  ): ProtectionDevice[] => {
    const leftIdx =
      leftMainId == null ? -1 : oldProtectionsSnapshot.findIndex((p) => p.id === leftMainId)
    if (leftMainId != null && leftIdx < 0) return []
    const rightIdx =
      rightMainId == null
        ? oldProtectionsSnapshot.length
        : oldProtectionsSnapshot.findIndex((p) => p.id === rightMainId)
    if (rightMainId != null && rightIdx < 0) return []
    if (rightIdx >= 0 && rightIdx <= leftIdx) return []
    const end = rightIdx < 0 ? oldProtectionsSnapshot.length : rightIdx
    const out: ProtectionDevice[] = []
    for (let i = leftIdx + 1; i < end; i++) {
      const p = oldProtectionsSnapshot[i]!
      if (!mainProtectionSet.has(p.id)) out.push(p)
    }
    return out
  }

  const newProtections: ProtectionDevice[] = []
  const usedNestedIds = new Set<string>()
  let prevMainId: string | null = null
  for (const mid of mainProtectionIds) {
    for (const n of nestedBetweenMains(prevMainId, mid)) {
      if (!usedNestedIds.has(n.id)) {
        newProtections.push(n)
        usedNestedIds.add(n.id)
      }
    }
    const p = panel.protections.find((x) => x.id === mid)
    if (!p) continue
    newProtections.push(p)
    prevMainId = mid
  }
  for (const n of nestedBetweenMains(prevMainId, null)) {
    if (!usedNestedIds.has(n.id)) {
      newProtections.push(n)
      usedNestedIds.add(n.id)
    }
  }
  for (const p of oldProtectionsSnapshot) {
    if (!mainProtectionSet.has(p.id) && !usedNestedIds.has(p.id)) {
      newProtections.push(p)
      usedNestedIds.add(p.id)
    }
  }

  const newCircuits: Circuit[] = []
  for (const item of newOrder) {
    if (item.type === 'circuit') {
      const c = panel.circuits.find((x) => x.id === item.id)
      if (c) newCircuits.push(c)
    }
  }
  for (const c of oldCircuitsSnapshot) {
    if (!newCircuits.some((nc) => nc.id === c.id)) {
      newCircuits.push(c)
    }
  }

  panel.circuits = newCircuits
  panel.protections = newProtections
}

/**
 * Move only this protection device (its own `circuits[]` and internal `subCircuitIds` links).
 * Other protections that were fed via `subCircuitIds` from this device stay on `sourcePanel`.
 */
export function relocateSingleProtectionDeviceToPanelMainBus(
  sourcePanel: Panel,
  targetPanel: Panel,
  protection: ProtectionDevice,
  mainBusInsertIndex: number
): void {
  const circuitClosure = collectCircuitIdsInProtectionDevice(protection)
  stripSubCircuitRefsFromCircuitsOutsideClosure(sourcePanel, circuitClosure)

  const protectionsOrdered = [protection]
  const protectionIdsToPlace = protectionsOrdered.map((p) => p.id)

  const directToMove = collectDirectPanelCircuitsInClosure(sourcePanel, circuitClosure)
  const circuitIdsToPlace = directToMove.map((c) => c.id)

  const cross = sourcePanel.id !== targetPanel.id

  if (cross) {
    const idSet = new Set(protectionIdsToPlace)
    sourcePanel.protections = (sourcePanel.protections ?? []).filter((p) => !idSet.has(p.id))
    const dirSet = new Set(circuitIdsToPlace)
    sourcePanel.circuits = (sourcePanel.circuits ?? []).filter((c) => !dirSet.has(c.id))

    for (const p of protectionsOrdered) {
      if (!targetPanel.protections.some((x) => x.id === p.id)) {
        targetPanel.protections.push(p)
      }
    }
    for (const c of directToMove) {
      targetPanel.circuits.push(c)
    }
  } else {
    for (const p of protectionsOrdered) {
      if (!targetPanel.protections.some((x) => x.id === p.id)) {
        targetPanel.protections.push(p)
      }
    }
  }

  const filteredOrder = getMainBusOrder(targetPanel).filter(
    (o) =>
      !(o.type === 'protection' && protectionIdsToPlace.includes(o.id)) &&
      !(o.type === 'circuit' && circuitIdsToPlace.includes(o.id))
  )

  const inserted: Array<{ type: 'circuit' | 'protection'; id: string }> = [
    ...protectionIdsToPlace.map((id) => ({ type: 'protection' as const, id })),
    ...circuitIdsToPlace.map((id) => ({ type: 'circuit' as const, id })),
  ]

  const insertAt = clamp(mainBusInsertIndex, 0, filteredOrder.length)
  const newOrder = [
    ...filteredOrder.slice(0, insertAt),
    ...inserted,
    ...filteredOrder.slice(insertAt),
  ]

  rebuildPanelMainBusFromOrder(targetPanel, newOrder)
}

/**
 * Move a protection and every downstream device on the same panel (linked via `subCircuitIds`
 * and sibling rows on the same protection) onto `targetPanel`'s main bus at `mainBusInsertIndex`.
 * Handles same-panel promotion/reorder and cross-panel moves. Mutates panel data in place.
 */
export function relocateProtectionToPanelMainBus(
  sourcePanel: Panel,
  targetPanel: Panel,
  protection: ProtectionDevice,
  mainBusInsertIndex: number
): void {
  const circuitClosure = collectCircuitClosureDownstreamFromProtection(sourcePanel, protection)
  stripSubCircuitRefsFromCircuitsOutsideClosure(sourcePanel, circuitClosure)

  const protectionsOrdered = collectProtectionsOrderedForSubtreeMove(
    sourcePanel,
    circuitClosure,
    protection
  )
  const protectionIdsToPlace = protectionsOrdered.map((p) => p.id)

  const directToMove = collectDirectPanelCircuitsInClosure(sourcePanel, circuitClosure)
  const circuitIdsToPlace = directToMove.map((c) => c.id)

  const cross = sourcePanel.id !== targetPanel.id

  if (cross) {
    const idSet = new Set(protectionIdsToPlace)
    sourcePanel.protections = (sourcePanel.protections ?? []).filter((p) => !idSet.has(p.id))
    const dirSet = new Set(circuitIdsToPlace)
    sourcePanel.circuits = (sourcePanel.circuits ?? []).filter((c) => !dirSet.has(c.id))

    for (const p of protectionsOrdered) {
      if (!targetPanel.protections.some((x) => x.id === p.id)) {
        targetPanel.protections.push(p)
      }
    }
    for (const c of directToMove) {
      targetPanel.circuits.push(c)
    }
  } else {
    for (const p of protectionsOrdered) {
      if (!targetPanel.protections.some((x) => x.id === p.id)) {
        targetPanel.protections.push(p)
      }
    }
  }

  const filteredOrder = getMainBusOrder(targetPanel).filter(
    (o) =>
      !(o.type === 'protection' && protectionIdsToPlace.includes(o.id)) &&
      !(o.type === 'circuit' && circuitIdsToPlace.includes(o.id))
  )

  const inserted: Array<{ type: 'circuit' | 'protection'; id: string }> = [
    ...protectionIdsToPlace.map((id) => ({ type: 'protection' as const, id })),
    ...circuitIdsToPlace.map((id) => ({ type: 'circuit' as const, id })),
  ]

  const insertAt = clamp(mainBusInsertIndex, 0, filteredOrder.length)
  const newOrder = [
    ...filteredOrder.slice(0, insertAt),
    ...inserted,
    ...filteredOrder.slice(insertAt),
  ]

  rebuildPanelMainBusFromOrder(targetPanel, newOrder)
}

/** Reorder `panel.protections` / `panel.circuits` so `protectionId` sits at main-bus visual index. */
export function moveProtectionToMainBusInsertIndex(
  panel: Panel,
  protectionId: string,
  insertIndex: number
): void {
  if (!panel.protections.some((p) => p.id === protectionId)) return
  const filtered = getMainBusOrder(panel).filter(
    (o) => !(o.type === 'protection' && o.id === protectionId)
  )
  const at = clamp(insertIndex, 0, filtered.length)
  const newOrder = [
    ...filtered.slice(0, at),
    { type: 'protection' as const, id: protectionId },
    ...filtered.slice(at),
  ]
  rebuildPanelMainBusFromOrder(panel, newOrder)
}

function slotSpanCols(slot: PanelGridSlot, project: ProjectWithOptionalV2Electrical): number {
  return slot.moduleWidth ?? getModuleWidthInCols(slot.module, project)
}

/**
 * Place a main-bus protection module on the panel grid at `mainBusInsertIndex`, shifting modules
 * at or after that column on the same row. This is used when creating a new physical module;
 * existing Panel Canvas placement remains independent from later one-wire reordering.
 */
export function placeMainBusProtectionGridSlotAtIndex(
  panel: Panel,
  newProtectionId: string,
  mainBusInsertIndex: number,
  project: ProjectWithOptionalV2Electrical,
  copyLayoutFromProtectionId?: string
): void {
  const gv = panel.gridView
  if (!gv?.slots) return

  const newRef: PanelGridModuleRef = { kind: 'protection', id: newProtectionId }
  const mainBusProtIds = getMainBusOrder(panel)
    .filter((item): item is { type: 'protection'; id: string } => item.type === 'protection')
    .map((item) => item.id)
  const mainBusProtSet = new Set(mainBusProtIds)
  const withoutNew = mainBusProtIds.filter((id) => id !== newProtectionId)
  const insertAt = clamp(mainBusInsertIndex, 0, withoutNew.length)

  const findSlot = (protId: string): PanelGridSlot | undefined =>
    gv.slots!.find((s) => s.module.kind === 'protection' && s.module.id === protId)

  gv.slots = gv.slots.filter(
    (s) => !(s.module.kind === 'protection' && s.module.id === newProtectionId)
  )

  const sourceSlot = copyLayoutFromProtectionId ? findSlot(copyLayoutFromProtectionId) : undefined
  const newWidth = sourceSlot?.moduleWidth ?? getModuleWidthInCols(newRef, project)

  const shiftRowFromCol = (row: number, fromCol: number) => {
    for (const slot of gv.slots!) {
      if (slot.row !== row) continue
      if (slot.module.kind !== 'protection') continue
      if (!mainBusProtSet.has(slot.module.id)) continue
      if (slot.col >= fromCol) slot.col += newWidth
    }
  }

  const orderedExisting = withoutNew
    .map((id) => findSlot(id))
    .filter((slot): slot is PanelGridSlot => !!slot)

  let row: number
  let newCol: number

  if (orderedExisting.length === 0) {
    row = sourceSlot?.row ?? 0
    newCol = 0
  } else if (insertAt === 0) {
    const first = orderedExisting[0]!
    row = first.row
    newCol = first.col
    shiftRowFromCol(row, newCol)
  } else if (insertAt >= withoutNew.length) {
    const last = orderedExisting[orderedExisting.length - 1]!
    row = last.row
    newCol = last.col + slotSpanCols(last, project)
  } else {
    const beforeSlot = findSlot(withoutNew[insertAt]!)
    if (beforeSlot) {
      row = beforeSlot.row
      newCol = beforeSlot.col
      shiftRowFromCol(row, newCol)
    } else {
      const prevSlot = findSlot(withoutNew[insertAt - 1]!)
      row = prevSlot?.row ?? sourceSlot?.row ?? 0
      newCol = prevSlot ? prevSlot.col + slotSpanCols(prevSlot, project) : 0
    }
  }

  gv.slots.push({
    row,
    col: newCol,
    module: newRef,
    moduleWidth: sourceSlot?.moduleWidth,
    moduleWidthManual: sourceSlot?.moduleWidthManual,
  })
}
