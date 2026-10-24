import type { Panel, ProtectionDevice } from '@/types/schema'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import { getPanelDisplayName } from '@/utils/panelNames'

export interface PanelLabelFeeds {
  /** One line per downstream circuit with its description, then fed boards. */
  list: string
  /** Circuit codes collapsed into ranges, for cells that also carry the label. */
  compact: string
}

interface FeedItem {
  code: string
  description: string
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function splitCode(code: string): { prefix: string; number: number | null; letter: number | null } {
  const numbered = /^(.*?)(\d+)$/.exec(code)
  if (numbered) return { prefix: numbered[1]!, number: Number(numbered[2]), letter: null }
  if (/^[A-Za-z]$/.test(code)) return { prefix: '', number: null, letter: code.charCodeAt(0) }
  return { prefix: code, number: null, letter: null }
}

function follows(previous: string, next: string): boolean {
  const a = splitCode(previous)
  const b = splitCode(next)
  if (a.number != null && b.number != null) return a.prefix === b.prefix && b.number === a.number + 1
  return a.letter != null && b.letter != null && b.letter === a.letter + 1
}

/** Collapses runs of three or more consecutive codes: A, B, C, E → A–C, E. */
export function compactCircuitCodes(codes: readonly string[]): string {
  const parts: string[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length >= 3) parts.push(`${run[0]}–${run.at(-1)}`)
    else parts.push(...run)
    run = []
  }
  for (const code of codes) {
    if (run.length > 0 && !follows(run.at(-1)!, code)) flush()
    run.push(code)
  }
  flush()
  return parts.join(', ')
}

function findProtectionForCircuit(
  panels: readonly Panel[],
  circuitId: string
): ProtectionDevice | undefined {
  for (const panel of walkPanels(panels)) {
    const protection = panel.protections?.find((candidate) =>
      candidate.circuits?.some((circuit) => circuit.id === circuitId)
    )
    if (protection) return protection
  }
  return undefined
}

function findCircuit(panels: readonly Panel[], circuitId: string) {
  for (const panel of walkPanels(panels)) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    const circuit = circuits.find((candidate) => candidate.id === circuitId)
    if (circuit) return circuit
  }
  return undefined
}

/**
 * Circuits and boards a protection feeds, derived from the topology so the label
 * follows when circuits move. Returns null for a protection that feeds one circuit.
 */
export function getProtectionFeeds(
  protection: ProtectionDevice,
  project: ProjectWithOptionalV2Electrical
): PanelLabelFeeds | null {
  const panels = getProjectElectricalPanels(project)
  const items: FeedItem[] = []
  for (const circuit of protection.circuits ?? []) {
    for (const childId of circuit.subCircuitIds ?? []) {
      const owner = findProtectionForCircuit(panels, childId)
      const child = findCircuit(panels, childId)
      const code = cleanText(owner?.label) || cleanText(child?.code)
      if (!code) continue
      items.push({
        code,
        description: cleanText(child?.notes) || cleanText(owner?.notes),
      })
    }
  }
  const boards = protection.subPanelId
    ? [...walkPanels(panels)]
        .filter((panel) => panel.id === protection.subPanelId)
        .map((panel) => getPanelDisplayName(panel))
    : []
  if (items.length === 0 && boards.length === 0) return null

  const boardLines = boards.map((board) => `→ ${board}`)
  const list = [
    ...items.map((item) => (item.description ? `${item.code} ${item.description}` : item.code)),
    ...boardLines,
  ].join('\n')
  const codes = compactCircuitCodes(items.map((item) => item.code))
  const compact = [codes ? `→ ${codes}` : '', ...boardLines].filter(Boolean).join(', ')
  return { list, compact }
}
