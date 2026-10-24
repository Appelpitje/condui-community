import type { Endpoint } from '@/types/schema'
import { getScopedBusRowLabel } from '@/lib/controlLink/controlLinkNoteContext'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { getDomoticaRowDisplayLabel } from './domoticaRowLabel'

/** Bus names remain complete on one line, independently of the capped circuit-name box. */
export function getDomoticaBusRowLabelMetrics(endpoint: Pick<Endpoint, 'id' | 'label'>, fontFamily = 'Figtree') {
  if (!getScopedBusRowLabel(endpoint.id)) return undefined
  const text = getDomoticaRowDisplayLabel(endpoint)
  return { text, width: Math.max(80, measureSymbolLabelTextWidth(text, fontFamily, 11) + 4), height: 11 }
}
