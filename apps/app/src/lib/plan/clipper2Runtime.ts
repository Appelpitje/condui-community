// Current vendored bundle plus side-by-side CSP-safer experimental glue.
// Both variants keep the same exported module shape so callers can switch by config.

export type ClipperVariant = 'current' | 'csp-experimental'

type ClipperEnumValue = { value: number }

export interface ClipperPointD {
  x: number
  y: number
  delete?: () => void
}

export interface ClipperPathD {
  size(): number
  get(index: number): ClipperPointD
  delete?: () => void
}

export interface ClipperPathsD {
  size(): number
  get(index: number): ClipperPathD
  push_back(path: ClipperPathD): void
  delete?: () => void
}

export interface ClipperModule {
  PathsD: new () => ClipperPathsD
  MakePathD(values: number[]): ClipperPathD
  InflatePathsD(
    paths: ClipperPathsD,
    delta: number,
    joinType: ClipperEnumValue,
    endType: ClipperEnumValue,
    miterLimit: number,
    arcTolerance: number,
    precision: number,
  ): ClipperPathsD
  UnionSelfD(paths: ClipperPathsD, fillRule: ClipperEnumValue, precision: number): ClipperPathsD
  DifferenceD(
    subject: ClipperPathsD,
    clip: ClipperPathsD,
    fillRule: ClipperEnumValue,
    precision: number,
  ): ClipperPathsD
  AreaPathD(path: ClipperPathD): number
  FillRule: {
    NonZero: ClipperEnumValue
  }
  JoinType: {
    Miter: ClipperEnumValue
  }
  EndType: {
    Polygon: ClipperEnumValue
    Joined: ClipperEnumValue
    Butt: ClipperEnumValue
  }
}

type ClipperFactoryOptions = {
  wasmBinary?: ArrayBuffer | Uint8Array
}

type ClipperFactory = (options?: ClipperFactoryOptions) => Promise<ClipperModule>

const variantConfigs: Record<ClipperVariant, { loadFactory: () => Promise<ClipperFactory>; wasmUrl: URL }> = {
  current: {
    loadFactory: async () =>
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ((await import('@/lib/vendor/clipper2/clipper2z.js')).default as ClipperFactory),
    wasmUrl: new URL('../vendor/clipper2/clipper2z.wasm', import.meta.url),
  },
  'csp-experimental': {
    loadFactory: async () =>
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ((await import('@/lib/vendor/clipper2/clipper2z.experimental.js')).default as ClipperFactory),
    wasmUrl: new URL('../vendor/clipper2/clipper2z.experimental.wasm', import.meta.url),
  },
}

const modulePromises = new Map<ClipperVariant, Promise<ClipperModule>>()

/** The CSP-safe glue unless a build explicitly opts back into the original (VITE_CSP_MODE=current). */
export function getConfiguredClipperVariant(): ClipperVariant {
  const requested = import.meta.env.VITE_CLIPPER2_VARIANT
  return requested === 'current' ? 'current' : 'csp-experimental'
}

export function loadClipperModule(variant: ClipperVariant = getConfiguredClipperVariant()): Promise<ClipperModule> {
  const existing = modulePromises.get(variant)
  if (existing) return existing

  const next = (async () => {
    const config = variantConfigs[variant]
    const factory = await config.loadFactory()
    if (typeof window === 'undefined') {
      const { readFile } = await import('node:fs/promises')
      const wasmBinary = await readFile(config.wasmUrl)
      return factory({ wasmBinary: new Uint8Array(wasmBinary) })
    }
    return factory()
  })()
  modulePromises.set(variant, next)
  return next
}

export async function loadWallVolumeClipper(variant?: ClipperVariant): Promise<void> {
  await loadClipperModule(variant)
}
