import { getThemeColors } from '@/lib/theme/colors'
import type { ThemeColors } from '@/lib/theme/types'
import type { ExportTheme } from './types'

/** Ordinary one-wire labels and conductors use black ink on white paper. */
export function getEendraadExportColors(theme: ExportTheme): ThemeColors {
  const colors = getThemeColors(theme)
  return theme === 'light'
    ? { ...colors, textColor: '#000000', secondaryText: '#000000', wireColor: '#000000' }
    : colors
}
