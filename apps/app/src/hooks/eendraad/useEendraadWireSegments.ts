import { useContext, useDeferredValue, useMemo } from 'react'
import { EendraadWireSegmentsContext } from '@/contexts/EendraadWireSegmentsContext'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useLayoutTree } from './useLayoutTree'
import type { WireSegment } from '@/types/schema'
import {
  getCachedEendraadWireSegments,
  getEendraadRenderProjectRevision,
} from '@/lib/layout/eendraadDerivedLayout'

/**
 * Hook to generate wire segments from the layout tree
 */
export function useEendraadWireSegments(enabled = true): WireSegment[] {
  const shared = useContext(EendraadWireSegmentsContext)
  const derive = enabled && shared === null
  const currentProject = useProjectStore((state: ProjectState) =>
    derive && state.currentProject ? getEendraadRenderProjectRevision(state.currentProject) : null
  )
  const renderProject = useDeferredValue(currentProject)
  const layoutTree = useLayoutTree(derive)

  return useMemo<WireSegment[]>(() => {
    if (!enabled) return []
    if (shared) return shared
    if (!layoutTree || !renderProject) return []
    return getCachedEendraadWireSegments(renderProject, layoutTree)
  }, [enabled, shared, layoutTree, renderProject])
}
