import { createElement } from 'react'
import i18n from '@/i18n'
import { CommandInputDialog } from '@/components/commands/CommandInputDialog'
import { getProjectPaletteActions } from '@/lib/commands/ui/projectPaletteActions'
import type { CommandDefinition } from '@/lib/commands/ui/types'
import { CommandError } from '@/lib/commands/project'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useDialogStore } from '@/stores/dialogStore'

const bindings = [
  ['electrical.assignEndpoints', 'moveToCircuit'],
  ['electrical.reorderBranch', 'reorderBranch'],
  ['electrical.moveProtectionOnBus', 'moveOnBus'],
  ['electrical.moveBus.left', 'moveBusLeft'],
  ['electrical.moveBus.right', 'moveBusRight'],
  ['panel.moveModules', 'moveModules'],
  ['panel.resizeModule', 'resizeModule'],
  ['panel.rewire', 'connectTo'],
  ['panel.resizeEnclosure', 'resizePanel'],
  ['panel.autoArrange', 'autoArrange'],
  ['floor.rename', 'renameFloor'],
  ['circuit.createEmpty', 'addCircuit'],
] as const

let cached:
  | {
      project: unknown
      selection: unknown
      panel: string | null
      floor: string | null
      actions: ReturnType<typeof getProjectPaletteActions>
    }
  | undefined
function actions() {
  const project = useProjectStore.getState().currentProject
  if (!project) {
    cached = undefined
    return []
  }
  const { selection, activePanelId: panel, activeFloorId: floor } = useUIStore.getState()
  if (
    !cached ||
    cached.project !== project ||
    cached.selection !== selection ||
    cached.panel !== panel ||
    cached.floor !== floor
  )
    cached = {
      project,
      selection,
      panel,
      floor,
      actions: getProjectPaletteActions(project, selection, panel, floor),
    }
  return cached.actions
}

export function createProjectPaletteCommands(): CommandDefinition[] {
  return [
    {
      id: 'properties.edit',
      labelKey: 'contextMenu.editProperties',
      isEnabled: (ctx) =>
        ctx.capabilities.canEditProject && !!useProjectStore.getState().currentProject,
      run: () => {
        if (!useUIStore.getState().panels.properties.visible)
          useUIStore.getState().togglePanel('properties')
      },
    },
    ...bindings.map(
      ([id, label]) =>
        ({
          id,
          labelKey: `commandPalette.${label}`,
          searchKey: id === 'panel.rewire' ? 'commandPalette.rewire' : undefined,
          isEnabled: (ctx) =>
            ctx.capabilities.canEditProject && actions().some((action) => action.id === id),
          run: () => {
            const action = actions().find((action) => action.id === id)
            if (!action) return false
            const revision = liveProjectSession.revision
            const submit = (values: Record<string, string>): boolean => {
              if (
                action.fields.some((field) => {
                  const value = values[field.name]
                  if (field.options) return !field.options.some((option) => option.value === value)
                  if (field.type !== 'number') return !value?.trim()
                  const number = Number(value)
                  return (
                    !value ||
                    !Number.isFinite(number) ||
                    (field.min != null && number < field.min) ||
                    (field.max != null && number > field.max) ||
                    (field.step === 1 && !Number.isInteger(number))
                  )
                })
              )
                return false
              try {
                const outcome = liveProjectSession.execute([action.invocation(values)], {
                  expectedRevision: revision,
                  source: 'palette',
                  label: action.id,
                })
                const suggested = outcome.results[0]?.select
                if (
                  suggested?.length &&
                  suggested.every((ref) => ref.kind === suggested[0]!.kind)
                ) {
                  const kind = suggested[0]!.kind
                  if (
                    [
                      'endpoint',
                      'placement',
                      'circuit',
                      'protection',
                      'trunkDevice',
                      'panel',
                    ].includes(kind)
                  )
                    useUIStore.getState().setSelection({
                      type: kind as
                        | 'endpoint'
                        | 'placement'
                        | 'circuit'
                        | 'protection'
                        | 'trunkDevice'
                        | 'panel',
                      ids: suggested.map((ref) => ref.id),
                    })
                }
                if (id === 'circuit.createEmpty') {
                  const created = outcome.results[0]?.created.find((ref) => ref.kind === 'circuit')
                  if (created)
                    useUIStore.getState().setSelection({ type: 'circuit', ids: [created.id] })
                }
                return true
              } catch (error) {
                if (!(error instanceof CommandError)) throw error
                return false
              }
            }
            if (!action.fields.length) return submit({})
            useDialogStore.getState().openDialog({
              type: 'custom',
              title: i18n.t(action.labelKey),
              size: 'sm',
              content: createElement(CommandInputDialog, {
                fields: action.fields,
                onSubmit: submit,
              }),
            })
            return true
          },
        }) satisfies CommandDefinition
    ),
  ]
}
