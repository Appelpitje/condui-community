import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type Konva from 'konva'
import { Group } from 'react-konva'
import { installLiveGroupViewportCulling } from '@/lib/canvas/liveGroupViewportCulling'

/** Keep complete scene geometry while skipping live draws of offscreen artwork. */
export function ViewportCulledGroup({
  name,
  boundsRevision,
  conservativeBounds,
  children,
}: {
  name?: string
  /** Changes with artwork/layout, never with the camera's pan or zoom. */
  boundsRevision: unknown
  /** Logical envelope includes artwork whose images/effects have not mounted yet. */
  conservativeBounds?: { x: number; y: number; width: number; height: number }
  children: ReactNode
}) {
  const groupRef = useRef<Konva.Group>(null)
  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    // Measure the complete diagram, including wires, labels, frames and supply
    // branches outside the nominal panel layout. Camera movement reads just this
    // cached rectangle and the live transform, without traversing descendants.
    const measured = group.getClientRect({ skipTransform: true })
    const bounds = conservativeBounds
      ? {
          x: Math.min(measured.x, conservativeBounds.x),
          y: Math.min(measured.y, conservativeBounds.y),
          width:
            Math.max(measured.x + measured.width, conservativeBounds.x + conservativeBounds.width) -
            Math.min(measured.x, conservativeBounds.x),
          height:
            Math.max(
              measured.y + measured.height,
              conservativeBounds.y + conservativeBounds.height
            ) - Math.min(measured.y, conservativeBounds.y),
        }
      : measured
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height)
    )
      return
    return installLiveGroupViewportCulling(group, bounds)
  }, [boundsRevision, conservativeBounds])

  return (
    <Group ref={groupRef} name={name}>
      {children}
    </Group>
  )
}
