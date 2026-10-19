import {
  getProjectElectrical,
  getProjectElectricalPanels,
  getProjectElectricalInstallation,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

type TerminalStripEntity = {
  symbol?: unknown
  label?: unknown
  junctionIdentity?: unknown
  terminalStripPin?: unknown
  terminalStripOutgoingPin?: unknown
  trunkPosition?: unknown
  id?: unknown
}

export interface TerminalStripOccurrence {
  id: string
  entityId: string
  side: 'incoming' | 'outgoing'
  stripId: string
  pin: number
  /** Electrical ownership; repeated numbers are legal only inside this circuit. */
  circuitId?: string
}

export function terminalStripOccurrenceId(entityId: string, side: 'incoming' | 'outgoing'): string {
  return `${entityId}:${side}`
}

export function normalizeTerminalStripId(value: string | undefined): string {
  const editable = (value ?? '').trim().replace(/^X/i, '')
  return editable.split('-')[0]?.trim() ?? ''
}

export function getTerminalStripId(entity: TerminalStripEntity): string {
  const identity =
    typeof entity.junctionIdentity === 'string'
      ? entity.junctionIdentity
      : typeof entity.label === 'string'
        ? entity.label
        : ''
  return normalizeTerminalStripId(identity)
}

export function getTerminalStripPin(entity: TerminalStripEntity): number | undefined {
  if (
    typeof entity.terminalStripPin === 'number' &&
    Number.isInteger(entity.terminalStripPin) &&
    entity.terminalStripPin > 0
  ) {
    return entity.terminalStripPin
  }
  const legacy =
    typeof entity.junctionIdentity === 'string'
      ? entity.junctionIdentity
      : typeof entity.label === 'string'
        ? entity.label
        : ''
  const match = /^(?:X)?[^-]+-([1-9]\d*)$/i.exec(legacy.trim())
  return match ? Number(match[1]) : undefined
}

export function getTerminalStripOutgoingPin(entity: TerminalStripEntity): number | undefined {
  return typeof entity.terminalStripOutgoingPin === 'number' &&
    Number.isInteger(entity.terminalStripOutgoingPin) &&
    entity.terminalStripOutgoingPin > 0
    ? entity.terminalStripOutgoingPin
    : undefined
}

export function getTerminalStripDisplayLabel(
  entityOrLabel: TerminalStripEntity | string | undefined,
  pinOverride?: number
): string {
  const entity =
    typeof entityOrLabel === 'object' && entityOrLabel != null
      ? entityOrLabel
      : { junctionIdentity: entityOrLabel }
  const stripId = getTerminalStripId(entity)
  const pin = pinOverride ?? getTerminalStripPin(entity)
  return `X${stripId}${pin == null ? '' : `-${pin}`}`
}

export function collectTerminalStripOccurrences(project: unknown): TerminalStripOccurrence[] {
  const occurrences: TerminalStripOccurrence[] = []
  const seen = new Set<object>()
  const visit = (value: unknown, circuitId?: string): void => {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return
    seen.add(value as object)
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, circuitId))
      return
    }
    const entity = value as TerminalStripEntity & Record<string, unknown>
    if (typeof entity.id === 'string' && Array.isArray(entity.endpoints)) circuitId = entity.id
    if (entity.symbol === 'terminal_strip') {
      const stripId = getTerminalStripId(entity)
      const pin = getTerminalStripPin(entity)
      if (stripId && pin != null) {
        const entityId =
          typeof entity.id === 'string' ? entity.id : `__terminal-${occurrences.length}`
        occurrences.push({
          id: terminalStripOccurrenceId(entityId, 'incoming'),
          entityId,
          side: 'incoming',
          ...(circuitId ? { circuitId } : {}),
          stripId,
          pin,
        })
        const outgoingPin = getTerminalStripOutgoingPin(entity) ?? pin
        if (
          getTerminalStripOutgoingPin(entity) != null ||
          typeof entity.trunkPosition === 'number'
        ) {
          occurrences.push({
            id: terminalStripOccurrenceId(entityId, 'outgoing'),
            entityId,
            side: 'outgoing',
            ...(circuitId ? { circuitId } : {}),
            stripId,
            pin: outgoingPin,
          })
        }
      }
    }
    Object.values(entity).forEach((child) => visit(child, circuitId))
  }
  const document = project as ProjectWithOptionalV2Electrical | null | undefined
  if (document && getProjectElectrical(document)) {
    // Panel occurrences own their circuit context. Ignore flattened device projections and snapshots.
    visit(getProjectElectricalPanels(document))
    visit(getProjectElectricalInstallation(document))
    visit(selectProjectSupplyAssemblies(document))
  } else {
    visit(project)
  }
  const ids = new Set<string>()
  return occurrences.filter((occurrence) => {
    if (ids.has(occurrence.id)) return false
    ids.add(occurrence.id)
    return true
  })
}

export function getNextTerminalStripPin(project: unknown, stripId = '1'): number {
  const normalizedId = normalizeTerminalStripId(stripId).toUpperCase()
  const used = new Set(
    collectTerminalStripOccurrences(project)
      .filter((occurrence) => occurrence.stripId.toUpperCase() === normalizedId)
      .map((occurrence) => occurrence.pin)
  )
  let pin = 1
  while (used.has(pin)) pin += 1
  return pin
}

export function getNextTerminalStripId(project: unknown): string {
  const used = new Set(
    collectTerminalStripOccurrences(project).map((occurrence) => occurrence.stripId.toUpperCase())
  )
  let number = 1
  while (used.has(String(number))) number += 1
  return String(number)
}

/** Reuse this circuit's group on the strip; other circuits reserve their own number. */
export function getTerminalStripCreationProps(project: unknown, stripId = '1', circuitId?: string) {
  const normalizedId = normalizeTerminalStripId(stripId) || '1'
  const existing = circuitId
    ? collectTerminalStripOccurrences(project).find(
        (occurrence) =>
          occurrence.circuitId === circuitId &&
          occurrence.stripId.toUpperCase() === normalizedId.toUpperCase()
      )
    : undefined
  const pin = existing?.pin ?? getNextTerminalStripPin(project, normalizedId)
  return {
    label: `${normalizedId}-${pin}`,
    junctionIdentity: normalizedId,
    terminalStripPin: pin,
  }
}

/** Returns the legacy combined designation used by automatic endpoint labels. */
export function getNextTerminalStripLabel(
  project: unknown,
  stripId?: string,
  circuitId?: string
): string {
  return getTerminalStripCreationProps(project, stripId, circuitId).label
}

export function getTerminalStripTrunkCreationProps(
  project: unknown,
  stripId?: string,
  circuitId?: string
) {
  const incoming = getTerminalStripCreationProps(project, stripId, circuitId)
  return { ...incoming, terminalStripOutgoingPin: incoming.terminalStripPin }
}

export function getTerminalStripTrunkConnectionProps(
  project: unknown,
  stripId?: string,
  circuitId?: string
) {
  const { label: _label, ...connectionProps } = getTerminalStripTrunkCreationProps(
    project,
    stripId,
    circuitId
  )
  return connectionProps
}

export function getEffectiveTerminalStripOutgoingPin(
  _project: unknown,
  entity: TerminalStripEntity
): number {
  return getTerminalStripOutgoingPin(entity) ?? getTerminalStripPin(entity) ?? 1
}

export function planTerminalStripPinAssignment(
  _project: unknown,
  occurrenceId: string,
  stripId: string,
  requestedPin: number,
  _vacatedPin?: number
): Array<{ id: string; stripId: string; pin: number }> {
  // Preserve manual sharing. Validation reports cross-circuit conflicts without renumbering peers.
  return [
    {
      id: occurrenceId,
      stripId: normalizeTerminalStripId(stripId) || '1',
      pin: Math.max(1, Math.round(requestedPin)),
    },
  ]
}

export function planTerminalStripPairAssignment(
  _project: unknown,
  entityId: string,
  stripId: string,
  incomingPin: number,
  outgoingPin: number
): Array<{ id: string; stripId: string; pin: number }> {
  return [
    ...planTerminalStripPinAssignment(
      _project,
      terminalStripOccurrenceId(entityId, 'incoming'),
      stripId,
      incomingPin
    ),
    ...planTerminalStripPinAssignment(
      _project,
      terminalStripOccurrenceId(entityId, 'outgoing'),
      stripId,
      outgoingPin
    ),
  ]
}
