import { isLayoutPreset } from '@/lib/viewport/layoutPresets'
import type { SavedLabelStyle } from '@/lib/eendraad/labelScheme'
import { useSettingsStore } from '@/stores/settingsStore'
import type { LayoutPreset } from '@/types/ui'
import { normalizeSupportedLanguage } from '@/utils/languageRouting'
import type { ThemeMode } from '@/utils/userPreferences'
import type { EditorPreferenceField } from './editorPreferenceSync'
import { switchEditorLanguage } from './switchEditorLanguage'

// Scroll-wheel behaviour and left-drag panning stay per device: they depend on the mouse,
// trackpad or touch screen in use, so syncing them would make other devices worse.

const placePlanSymbolsManually: EditorPreferenceField<boolean> = {
  key: 'placePlanSymbolsManually',
  read: () => useSettingsStore.getState().placePlanSymbolsManually,
  apply: (value) => useSettingsStore.getState().setPlacePlanSymbolsManually(value),
  isValid: (value): value is boolean => typeof value === 'boolean',
}

const defaultLayoutPreset: EditorPreferenceField<LayoutPreset> = {
  key: 'defaultLayoutPreset',
  read: () => useSettingsStore.getState().defaultLayoutPreset,
  apply: (value) => useSettingsStore.getState().setDefaultLayoutPreset(value),
  isValid: isLayoutPreset,
}

const language: EditorPreferenceField<string> = {
  key: 'language',
  read: () => useSettingsStore.getState().language,
  apply: switchEditorLanguage,
  isValid: (value): value is string => typeof value === 'string' && normalizeSupportedLanguage(value) === value,
}

const themeMode: EditorPreferenceField<ThemeMode> = {
  key: 'themeMode',
  read: () => useSettingsStore.getState().theme.mode,
  apply: (value) => {
    const { theme, setTheme } = useSettingsStore.getState()
    setTheme({ ...theme, mode: value })
  },
  isValid: (value): value is ThemeMode => value === 'light' || value === 'dark',
}

const labelStyles: EditorPreferenceField<SavedLabelStyle[]> = {
  key: 'labelStyles',
  read: () => useSettingsStore.getState().labelStyles,
  apply: (value) => useSettingsStore.getState().setLabelStyles(value),
  isValid: (value): value is SavedLabelStyle[] => Array.isArray(value),
}

/** Workflow preferences synced to the account (language and theme have their own profile columns). */
export const ACCOUNT_EDITOR_PREFERENCE_FIELDS: EditorPreferenceField[] = [
  placePlanSymbolsManually,
  defaultLayoutPreset,
  labelStyles,
] as EditorPreferenceField[]

/** Everything Community keeps in the server settings when server storage is on. */
export const COMMUNITY_EDITOR_PREFERENCE_FIELDS: EditorPreferenceField[] = [
  language,
  themeMode,
  placePlanSymbolsManually,
  defaultLayoutPreset,
  labelStyles,
] as EditorPreferenceField[]

export function subscribeToSettingsChanges(onChange: () => void): () => void {
  return useSettingsStore.subscribe(onChange)
}
