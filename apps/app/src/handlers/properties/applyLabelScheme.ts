import type { LabelScheme } from '@/types/schema'
import { labelSchemeForStorage } from '@/lib/eendraad/labelScheme'
import { editProperties } from './editProperties'

/**
 * Applies a scheme to the project as one undoable edit and relabels when automatic naming is on.
 * Panel numbering is left alone when `panelNumberingEnabled` is undefined (edition without it).
 */
export function applyLabelScheme(scheme: LabelScheme, panelNumberingEnabled?: boolean): void {
  editProperties({
    installation: {
      labelScheme: labelSchemeForStorage(scheme) ?? null,
      ...(panelNumberingEnabled === undefined ? {} : { panelNumberingEnabled }),
    },
    refreshAutomaticNaming: true,
  })
}
