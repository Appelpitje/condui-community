import { createContext } from 'react'
import type { WireSegment } from '@/types/schema'

/** Descendants use the canvas's coherent wire revision, including during deferred renders. */
export const EendraadWireSegmentsContext = createContext<WireSegment[] | null>(null)
