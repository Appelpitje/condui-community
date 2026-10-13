import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useUIStore } from '@/stores/uiStore'
import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'
import { resolveSelectionToEndpointIds } from '@/lib/plan/selectionResolvers'
import type { Point2, Placement } from '@/types/schema'

export const PLAN_NUDGE_TAP_CM = 1
export const PLAN_NUDGE_HOLD_DELAY_MS = 250
export const PLAN_NUDGE_HOLD_SPEED_START_CM_S = 10
export const PLAN_NUDGE_HOLD_SPEED_END_CM_S = 18
export const PLAN_NUDGE_HOLD_RAMP_MS = 3000
/** Batch rapid taps into one store commit after this idle gap (ms). */
export const PLAN_NUDGE_COMMIT_COALESCE_MS = 80

export type PlanArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

export const PLAN_ARROW_KEYS: readonly PlanArrowKey[] = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]

export function isPlanArrowKey(code: string): code is PlanArrowKey {
  return (PLAN_ARROW_KEYS as readonly string[]).includes(code)
}

export type NudgeDirection = { dx: number; dy: number }

/** Opposing horizontal or vertical keys cancel; diagonals (e.g. left + up) combine. */
export function getNudgeDirectionFromHeldKeys(held: ReadonlySet<PlanArrowKey>): NudgeDirection {
  let dx = 0
  let dy = 0
  const left = held.has('ArrowLeft')
  const right = held.has('ArrowRight')
  const up = held.has('ArrowUp')
  const down = held.has('ArrowDown')

  if (left && !right) dx = -1
  else if (right && !left) dx = 1

  if (up && !down) dy = -1
  else if (down && !up) dy = 1

  return { dx, dy }
}

/**
 * Hold distance in cm (excluding tap). Speed ramps linearly from start to end over 3 s.
 * Only applies after {@link PLAN_NUDGE_HOLD_DELAY_MS} on the axis.
 */
export function getHoldDistanceCm(holdDurationMs: number): number {
  if (holdDurationMs <= 0) return 0
  const rampSeconds = PLAN_NUDGE_HOLD_RAMP_MS / 1000
  const seconds = holdDurationMs / 1000
  if (seconds <= rampSeconds) {
    return (
      PLAN_NUDGE_HOLD_SPEED_START_CM_S * seconds +
      ((PLAN_NUDGE_HOLD_SPEED_END_CM_S - PLAN_NUDGE_HOLD_SPEED_START_CM_S) / (2 * rampSeconds)) *
        seconds *
        seconds
    )
  }
  const atRampEnd =
    PLAN_NUDGE_HOLD_SPEED_START_CM_S * rampSeconds +
    ((PLAN_NUDGE_HOLD_SPEED_END_CM_S - PLAN_NUDGE_HOLD_SPEED_START_CM_S) / (2 * rampSeconds)) *
      rampSeconds *
      rampSeconds
  return atRampEnd + PLAN_NUDGE_HOLD_SPEED_END_CM_S * (seconds - rampSeconds)
}

/** Total travel on one axis: 1 cm tap, then hold distance after a short delay. */
export function getAxisTotalCm(keyDownAtMs: number, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - keyDownAtMs)
  if (elapsed < PLAN_NUDGE_HOLD_DELAY_MS) {
    return PLAN_NUDGE_TAP_CM
  }
  return PLAN_NUDGE_TAP_CM + getHoldDistanceCm(elapsed - PLAN_NUDGE_HOLD_DELAY_MS)
}

export function addCanvasDeltas(a: Point2, b: Point2): Point2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

/** @deprecated Discrete step interval; hold loop uses {@link getHoldDistanceCm} instead. */
export function getHoldRepeatIntervalMs(holdDurationMs: number): number {
  const t = Math.max(0, holdDurationMs)
  const ramp = Math.min(t / PLAN_NUDGE_HOLD_RAMP_MS, 1)
  const speedCmS =
    PLAN_NUDGE_HOLD_SPEED_START_CM_S +
    (PLAN_NUDGE_HOLD_SPEED_END_CM_S - PLAN_NUDGE_HOLD_SPEED_START_CM_S) * ramp
  return 1000 / speedCmS
}

/** Convert centimeters to plan canvas units (pixels in world space). */
export function planCmToCanvasUnits(cm: number, pxPerMeter: number | null): number {
  if (pxPerMeter != null && pxPerMeter > 0) {
    return (cm / 100) * pxPerMeter
  }
  // Uncalibrated floors: 1 canvas unit = 1 cm (see usePlanGrid).
  return cm
}

const NUDGE_SELECTION_TYPES = new Set(['placement', 'endpoint', 'panel'])

export function canPlanSymbolNudgeSelection(selection: {
  type: string | null
  ids: string[]
}): boolean {
  if (selection.ids.length === 0) return false
  if (!selection.type || !NUDGE_SELECTION_TYPES.has(selection.type)) return false
  return true
}

export type PlanNudgePlacementRow = {
  placementId: string
  /** Position at nudge session start (store truth). */
  startPos: Point2
  locked: boolean
  junctionPanelLabel?: string
  isEarthing?: boolean
}

export function resolvePlanNudgePlacements(
  selection: { type: string | null; ids: string[] },
  activeFloorId: string | null
): PlanNudgePlacementRow[] {
  const result: PlanNudgePlacementRow[] = []
  if (!activeFloorId) return result

  const store = useProjectStore.getState()
  const floorPlacements = store.getPlacementsByFloor(activeFloorId)

  if (selection.type === 'placement') {
    selection.ids.forEach((placementId) => {
      const row = floorPlacements.find((p: Placement) => p.id === placementId)
      if (!row) return
      const ext = row as Placement & { junctionPanelLabel?: string; isEarthing?: boolean }
      result.push({
        placementId: row.id,
        startPos: { x: row.pos.x, y: row.pos.y },
        locked: row.locked ?? false,
        junctionPanelLabel: ext.junctionPanelLabel,
        isEarthing: ext.isEarthing,
      })
    })
    return result
  }

  const endpointIds = resolveSelectionToEndpointIds(selection, {
    getPanelById: store.getPanelById,
    getPanelByName: store.getPanelByName,
    getAllEndpoints: store.getAllEndpoints,
  })
  endpointIds.forEach((endpointId) => {
    const endpoint = store.getEndpointById(endpointId)
    if (!endpoint) return
    const placement = endpoint.placements.find((p: Placement) => p.floorId === activeFloorId)
    if (!placement) return
    result.push({
      placementId: placement.id,
      startPos: { x: placement.pos.x, y: placement.pos.y },
      locked: placement.locked ?? false,
    })
  })
  return result
}

export function buildNudgePreviewPositions(
  rows: PlanNudgePlacementRow[],
  deltaCanvas: Point2
): Map<string, Point2> {
  const preview = new Map<string, Point2>()
  if (deltaCanvas.x === 0 && deltaCanvas.y === 0) return preview

  for (const row of rows) {
    if (row.locked) continue
    preview.set(row.placementId, {
      x: row.startPos.x + deltaCanvas.x,
      y: row.startPos.y + deltaCanvas.y,
    })
  }
  return preview
}

export type ComputeNudgeDeltaParams = {
  nowMs: number
  held: ReadonlySet<PlanArrowKey>
  keyDownTimes: ReadonlyMap<PlanArrowKey, number>
  frozenDeltaCanvas: Point2
  pxPerMeter: number | null
}

/** Live delta from key hold times; frozen axes keep their value after partial key release. */
export function computeNudgeDeltaCanvas(params: ComputeNudgeDeltaParams): Point2 {
  const { nowMs, held, keyDownTimes, frozenDeltaCanvas, pxPerMeter } = params

  let x = frozenDeltaCanvas.x
  let y = frozenDeltaCanvas.y

  const left = held.has('ArrowLeft')
  const right = held.has('ArrowRight')
  const up = held.has('ArrowUp')
  const down = held.has('ArrowDown')

  if (left && !right) {
    const downAt = keyDownTimes.get('ArrowLeft')
    if (downAt != null) {
      x = -planCmToCanvasUnits(getAxisTotalCm(downAt, nowMs), pxPerMeter)
    }
  } else if (right && !left) {
    const downAt = keyDownTimes.get('ArrowRight')
    if (downAt != null) {
      x = planCmToCanvasUnits(getAxisTotalCm(downAt, nowMs), pxPerMeter)
    }
  }

  if (up && !down) {
    const downAt = keyDownTimes.get('ArrowUp')
    if (downAt != null) {
      y = -planCmToCanvasUnits(getAxisTotalCm(downAt, nowMs), pxPerMeter)
    }
  } else if (down && !up) {
    const downAt = keyDownTimes.get('ArrowDown')
    if (downAt != null) {
      y = planCmToCanvasUnits(getAxisTotalCm(downAt, nowMs), pxPerMeter)
    }
  }

  return { x, y }
}

export type CommitPlanSymbolNudgeParams = {
  rows: PlanNudgePlacementRow[]
  deltaCanvas: Point2
  activeFloorId: string | null
}

/** Commit a completed nudge session in one undo entry. Snap is intentionally ignored. */
export function commitPlanSymbolNudge(params: CommitPlanSymbolNudgeParams): boolean {
  const { rows, deltaCanvas } = params
  if (deltaCanvas.x === 0 && deltaCanvas.y === 0) return false

  const movable = rows.filter((row) => !row.locked)
  if (movable.length === 0) return false

  const outcome = runProjectCommand(
    'plan.movePlacements',
    {
      moves: movable.map((row) => ({
        placementId: row.placementId,
        pos: { x: row.startPos.x + deltaCanvas.x, y: row.startPos.y + deltaCanvas.y },
      })),
    },
    { label: 'nudge plan symbols' }
  )
  return outcome?.changed ?? false
}

export function isPlanCanvasVisibleInLayout(): boolean {
  return useUIStore.getState().viewportLayout.panels.some((panel) => panel.canvas === 'plan')
}

export function resolvePlanNudgePxPerMeter(activeFloorId: string | null): number | null {
  if (!activeFloorId) return null
  const floor = useProjectStore.getState().getFloorById(activeFloorId)
  return calculatePxPerMeter(floor ?? null)
}
