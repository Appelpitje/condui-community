import { isDraft } from 'immer'
import type {
  Endpoint,
  Placement,
  PlanWireRoute,
  PlanWireRouteStyle,
  Point2,
  Wall,
} from '@/types/schema'
import type { QuadrantScores } from '@/utils/planAutoOrient'

export type PlanLabelSamplingState = {
  lastImageKey: string
  lastPlacementGeomById: Map<string, string>
  wallScoresByPlacementId: Map<string, QuadrantScores>
}

export type SettledLabelInputs = {
  electrical: object | undefined
  getEndpointById: (id: string) => Endpoint | null | undefined
  placements: Array<Placement & { endpointId?: string; junctionPanelLabel?: string }>
  image: HTMLImageElement | null
  imagePosition: Point2
  baseSymbolSizePx: number
  labelRecalcKey: number
  fontFamily: string
  enableImageWallSampling: boolean
  walls: { walls: Wall[]; masterWallThickness: number; pxPerMeter: number | null } | null
  wires: {
    routes: PlanWireRoute[]
    routeStyle: PlanWireRouteStyle
    placementPositionOverrides?: Map<string, Point2>
  } | null
  hasLiveDrag: boolean
  allowSettledCache: boolean
}

export type SettledLabelKey = {
  electrical: object
  getEndpointById: SettledLabelInputs['getEndpointById']
  fingerprint: string
}

const frozenInputs = new WeakSet<object>()
function deeplyFrozen(value: unknown, visiting = new Set<object>()): boolean {
  if (value == null || typeof value !== 'object') return true
  if (frozenInputs.has(value)) return true
  if (isDraft(value) || !Object.isFrozen(value) || visiting.has(value)) return false
  visiting.add(value)
  const valid = Object.values(value).every((child) => deeplyFrozen(child, visiting))
  visiting.delete(value)
  if (valid) frozenInputs.add(value)
  return valid
}

// Identity tokens do not retain HTML images, decoded pixels or blob resources.
const imageIds = new WeakMap<
  HTMLImageElement,
  {
    id: number
    version: number
    src: string
    currentSrc: string
    width: number
    height: number
    naturalWidth: number
    naturalHeight: number
    complete: boolean
  }
>()
let nextImageId = 0

function imageIdentity(image: HTMLImageElement): string {
  const previous = imageIds.get(image)
  const next = {
    id: previous?.id ?? ++nextImageId,
    version: previous?.version ?? 0,
    src: image.src,
    currentSrc: image.currentSrc,
    width: image.width,
    height: image.height,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    complete: image.complete,
  }
  if (
    previous &&
    (previous.src !== next.src ||
      previous.currentSrc !== next.currentSrc ||
      previous.width !== next.width ||
      previous.height !== next.height ||
      previous.naturalWidth !== next.naturalWidth ||
      previous.naturalHeight !== next.naturalHeight ||
      previous.complete !== next.complete)
  )
    next.version++
  imageIds.set(image, next)
  return `${next.id}:${next.version}`
}

/** Source strings (including large data URLs) remain exclusively in the weak image record. */
export function getPlanLabelSamplingImageKey(
  image: HTMLImageElement,
  position: Point2,
  baseSymbolSizePx: number
): string {
  return `${imageIdentity(image)}|${position.x},${position.y}|${baseSymbolSizePx}`
}

export function getSettledLabelKey(inputs: SettledLabelInputs): SettledLabelKey | null {
  const { electrical, image } = inputs
  if (
    !inputs.allowSettledCache ||
    inputs.hasLiveDrag ||
    inputs.wires?.placementPositionOverrides?.size ||
    !electrical ||
    !deeplyFrozen(electrical)
  )
    return null
  if (inputs.walls?.walls.some((wall) => !deeplyFrozen(wall))) return null
  if (image && (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0)) return null
  if (!(inputs.baseSymbolSizePx > 0)) return null
  try {
    const fingerprint = JSON.stringify(
      [
        inputs.placements,
        inputs.walls,
        inputs.wires ? [inputs.wires.routes, inputs.wires.routeStyle] : null,
        inputs.baseSymbolSizePx,
        inputs.fontFamily,
        inputs.labelRecalcKey,
        inputs.enableImageWallSampling,
        image ? imageIdentity(image) : null,
        inputs.imagePosition,
      ],
      (_key, value: unknown) => {
        if (
          (typeof value === 'number' && !Number.isFinite(value)) ||
          (value != null && typeof value === 'object' && isDraft(value))
        )
          throw new Error('Unsettled label inputs')
        return value
      }
    )
    return { electrical, getEndpointById: inputs.getEndpointById, fingerprint }
  } catch {
    return null
  }
}

function cloneSampling(state: PlanLabelSamplingState): PlanLabelSamplingState {
  return {
    lastImageKey: state.lastImageKey,
    lastPlacementGeomById: new Map(state.lastPlacementGeomById),
    wallScoresByPlacementId: new Map(
      [...state.wallScoresByPlacementId].map(([id, scores]) => [id, { ...scores }])
    ),
  }
}

function clonePositions(positions: Map<string, Point2>): Map<string, Point2> {
  return new Map([...positions].map(([id, point]) => [id, { ...point }]))
}

/** Two completed floor solves, containing numeric data only; no scene/image retention. */
export function createSettledLabelPositionsCache(limit = 2) {
  const entries: Array<{
    key: SettledLabelKey
    positions: Map<string, Point2>
    sampling: PlanLabelSamplingState
  }> = []
  const find = (key: SettledLabelKey) =>
    entries.findIndex(
      (entry) =>
        entry.key.electrical === key.electrical &&
        entry.key.getEndpointById === key.getEndpointById &&
        entry.key.fingerprint === key.fingerprint
    )
  return {
    read(key: SettledLabelKey | null) {
      if (!key) return null
      const index = find(key)
      if (index < 0) return null
      const entry = entries.splice(index, 1)[0]!
      entries.push(entry)
      return { positions: clonePositions(entry.positions), sampling: cloneSampling(entry.sampling) }
    },
    save(
      key: SettledLabelKey | null,
      positions: Map<string, Point2>,
      sampling: PlanLabelSamplingState
    ) {
      if (!key || limit <= 0) return
      const index = find(key)
      if (index >= 0) entries.splice(index, 1)
      entries.push({ key, positions: clonePositions(positions), sampling: cloneSampling(sampling) })
      while (entries.length > limit) entries.shift()
    },
  }
}

export const settledLabelPositionsCache = createSettledLabelPositionsCache()
