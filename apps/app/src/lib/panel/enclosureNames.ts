import { findPanelById } from '@/lib/panel/panelTree'
import { getAuxiliaryEnclosureLabel } from '@/lib/panel/auxiliaryEnclosureLabel'
import {
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { getPanelDisplayName } from '@/utils/panelNames'
import type { ProjectV2 } from '@/types/projectV2'

type Translate = (key: string, fallback: string) => string

/** Visible name of a physical enclosure key (`grid`, `panel:<id>`, `auxiliary:<id>`). */
export function describeEnclosureKey(project: ProjectV2, key: string, t: Translate): string {
  if (key === 'grid') return t('panelCanvas.supplyPanel', 'Grid panel')
  const [kind, ...rest] = key.split(':')
  const id = rest.join(':')
  if (kind === 'junction') return id
  if (kind === 'panel') {
    const panel = findPanelById(getProjectElectricalPanels(project), id)
    return panel ? getPanelDisplayName(panel, project) : t('panels.propertiesTitle', 'Panel')
  }
  const enclosures = selectProjectAuxiliaryElectricalEnclosures(project)
  return getAuxiliaryEnclosureLabel(
    enclosures.find((enclosure) => enclosure.id === id),
    t,
    enclosures
  )
}
