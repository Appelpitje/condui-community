import type { BusMoveInput } from '@/lib/eendraad/busMoveMutations'
import { liveProjectSession, runProjectCommand } from '@/stores/liveProjectCommandSession'
import { CommandError } from '@/lib/commands/project'
import { useUIStore } from '@/stores/uiStore'

const COMMAND_ID = 'electrical.moveProtectionOnBus'

function applyOutcome(
  outcome: {
    changed: boolean
    results: Array<{ select?: Array<{ kind: string; id: string }> }>
  } | null
): boolean {
  if (!outcome?.changed) return false
  const selected = outcome.results.flatMap((result) => result.select ?? [])
  const unique = [...new Map(selected.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()]
  const first = unique[0]
  if (first && (first.kind === 'protection' || first.kind === 'trunkDevice')) {
    useUIStore.getState().setSelection({ type: first.kind, ids: unique.map((ref) => ref.id) })
  }
  return true
}

function run(inputs: readonly BusMoveInput[], label: string): boolean {
  if (inputs.length === 0) return false
  let commandInput: BusMoveInput
  if (inputs.length === 1) {
    commandInput = inputs[0]!
  } else {
    if (inputs.every((input) => input.kind === 'protectionDrop')) {
      const drops = inputs as readonly Extract<BusMoveInput, { kind: 'protectionDrop' }>[]
      const target = drops[0]!.target
      if (drops.some((input) => JSON.stringify(input.target) !== JSON.stringify(target)))
        return false
      commandInput = {
        kind: 'protectionSelectionDrop',
        protectionIds: [...new Set(drops.map((input) => input.protectionId))],
        target,
      }
    } else {
      commandInput = inputs[0]!
    }
  }
  try {
    if (inputs.length === 1) {
      return applyOutcome(runProjectCommand(COMMAND_ID, commandInput, { label, source: 'drag' }))
    }
    return applyOutcome(
      liveProjectSession.execute(
        commandInput.kind === 'protectionSelectionDrop'
          ? [{ id: COMMAND_ID, input: commandInput }]
          : inputs.map((input) => ({ id: COMMAND_ID, input })),
        { label, source: 'drag' }
      )
    )
  } catch (error) {
    if (error instanceof CommandError) return false
    throw error
  }
}

/** Runs one one-wire protection drop as an atomic project command. */
export function runEendraadBusMove(input: BusMoveInput) {
  return run([input], 'move protection on installation plan')
}

/** Runs related bus moves as one atomic transaction and one undo entry. */
export function runEendraadBusMoves(inputs: readonly BusMoveInput[]) {
  return run(inputs, 'move protection selection on installation plan')
}
