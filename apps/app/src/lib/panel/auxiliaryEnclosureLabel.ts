import type { AuxiliaryElectricalEnclosure } from '@/types/supplyAssembly'

type Translate = (key: string, fallback: string) => string
type EnclosureNaming = Pick<AuxiliaryElectricalEnclosure, 'id' | 'name' | 'kind'>

/**
 * Display name of a virtual enclosure. Unnamed module enclosures are numbered in project
 * order ("Kast 1", "Kast 2") when the other enclosures are known, so they can be told apart.
 */
export function getAuxiliaryEnclosureLabel(
  enclosure: EnclosureNaming | undefined,
  t: Translate,
  allEnclosures?: readonly EnclosureNaming[]
): string {
  const name = enclosure?.name.trim()
  if (name) return name
  if (enclosure?.kind !== 'other') return t('panelCanvas.virtualEnclosure', 'Supply enclosure')
  const base = t('panelCanvas.moduleEnclosure', 'Enclosure')
  const index = (allEnclosures ?? [])
    .filter((candidate) => candidate.kind === 'other')
    .findIndex((candidate) => candidate.id === enclosure.id)
  return index >= 0 ? `${base} ${index + 1}` : base
}

/** First free "Kast N" name, counting the names enclosures already show. */
export function getNextModuleEnclosureName(
  enclosures: readonly EnclosureNaming[],
  t: Translate
): string {
  const base = t('panelCanvas.moduleEnclosure', 'Enclosure')
  const taken = new Set(
    enclosures.map((enclosure) =>
      getAuxiliaryEnclosureLabel(enclosure, t, enclosures).trim().toLowerCase()
    )
  )
  let number = 1
  while (taken.has(`${base} ${number}`.toLowerCase())) number += 1
  return `${base} ${number}`
}
