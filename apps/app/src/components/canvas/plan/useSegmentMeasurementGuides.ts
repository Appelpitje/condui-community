import { useState } from 'react'
import {
  buildDistanceMeasurementGuides,
  buildSegmentMeasurementGuides,
  type DistanceMeasurementInterval,
} from '@/lib/plan/segmentMeasurements'
import type { Point2 } from '@/types/schema'

interface Inputs {
  points: Point2[]
  segmentIndices: number[]
  intervals: DistanceMeasurementInterval[]
  pxPerMeter: number
  extensionOffset: number
}
interface CachedGuides {
  inputs: Inputs
  sides: Map<string, -1 | 1>
  guides: ReturnType<typeof buildSegmentMeasurementGuides>
}

/** A distance label keeps its chosen wall side as the opening or wall moves. */
export function useSegmentMeasurementGuides(inputs: Inputs) {
  const [cached, setCached] = useState<CachedGuides | null>(null)
  if (
    !cached ||
    cached.inputs.points !== inputs.points ||
    cached.inputs.segmentIndices !== inputs.segmentIndices ||
    cached.inputs.intervals !== inputs.intervals ||
    cached.inputs.pxPerMeter !== inputs.pxPerMeter ||
    cached.inputs.extensionOffset !== inputs.extensionOffset
  ) {
    const sides = new Map(cached?.sides)
    const guides = [
      ...buildSegmentMeasurementGuides(inputs),
      ...buildDistanceMeasurementGuides({ ...inputs, normalSideByKey: sides }),
    ]
    setCached({ inputs, sides, guides })
    return guides
  }
  return cached.guides
}
