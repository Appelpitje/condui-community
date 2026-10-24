import i18n from '@/i18n'
import type { Panel } from '@/types/schema'
import { getPanelDiagramTitleLine } from '@/lib/panel/panelDiagramLabels'

/** Reserve either title variant so dialog estimates and gated exports agree. */
export function getEendraadPackingTitle(
  project: Parameters<typeof getPanelDiagramTitleLine>[0],
  panel: Panel,
): string {
  const plain = getPanelDiagramTitleLine(project, panel, i18n.t.bind(i18n), false)
  const advanced = getPanelDiagramTitleLine(project, panel, i18n.t.bind(i18n), true)
  return Array.from(plain).length > Array.from(advanced).length ? plain : advanced
}
