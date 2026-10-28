import React from 'react'
import type { Wall, Door, Window } from '@/types/schema'
import { buildWallVolumeComponents, type WallVolumeComponent } from '@/lib/plan/wallVolumeGeometry'
import { logger } from '@/lib/logger'

/** Owns merged-volume loading, its cancellation, and permanent fallback after failure. */
export function useWallVolumeComponents(
  walls: Wall[],
  doors: Door[],
  windows: Window[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
) {
  const [wallVolumeComponents, setWallVolumeComponents] = React.useState<
    WallVolumeComponent[] | null
  >(() => (walls.length === 0 ? [] : null))
  const [wallVolumeFallbackActive, setWallVolumeFallbackActive] = React.useState(false)
  const wallVolumeFallbackLoggedRef = React.useRef(false)

  const [volumeSource, setVolumeSource] = React.useState({
    doors,
    masterWallThickness,
    pxPerMeter,
    wallVolumeFallbackActive,
    walls,
    windows,
  })
  if (
    volumeSource.doors !== doors ||
    volumeSource.masterWallThickness !== masterWallThickness ||
    volumeSource.pxPerMeter !== pxPerMeter ||
    volumeSource.wallVolumeFallbackActive !== wallVolumeFallbackActive ||
    volumeSource.walls !== walls ||
    volumeSource.windows !== windows
  ) {
    setVolumeSource({
      doors,
      masterWallThickness,
      pxPerMeter,
      wallVolumeFallbackActive,
      walls,
      windows,
    })
    if (!wallVolumeFallbackActive && walls.length === 0) setWallVolumeComponents([])
  }

  React.useEffect(() => {
    if (wallVolumeFallbackActive) return

    if (walls.length === 0) return

    let cancelled = false

    buildWallVolumeComponents(walls, doors, windows, masterWallThickness, pxPerMeter)
      .then((components) => {
        if (!cancelled) setWallVolumeComponents(components)
      })
      .catch((error) => {
        if (!wallVolumeFallbackLoggedRef.current) {
          wallVolumeFallbackLoggedRef.current = true
          logger.warn(
            '[WallRenderer] Merged wall volumes unavailable; using simple wall rendering.',
            error
          )
        }
        if (!cancelled) {
          // Clipper2 is an enhancement for merged wall geometry, not a prerequisite for
          // editing plans. Leave the regular per-wall renderer in charge when WASM is
          // unavailable or blocked by the browser/security policy.
          setWallVolumeComponents([])
          setWallVolumeFallbackActive(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [doors, masterWallThickness, pxPerMeter, wallVolumeFallbackActive, walls, windows])

  return { wallVolumeComponents, wallVolumeFallbackActive }
}
