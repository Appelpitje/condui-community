# Clipper2 integration note

Current baseline:
- Vendored JS glue: `src/lib/vendor/clipper2/clipper2z.js`
- Vendored wasm: `src/lib/vendor/clipper2/clipper2z.wasm`
- Runtime loader: `src/lib/plan/clipper2Runtime.ts`
- App-level geometry entrypoint: `src/lib/plan/wallVolumeGeometry.ts`
- Main consumer: `src/components/canvas/plan/WallRenderer.tsx`

The current JS glue is an Emscripten embind bundle. It resolves the adjacent wasm via `import.meta.url` / `locateFile()` and lazily initializes once per selected runtime variant.

Geometry operations currently used in practice by the wall-volume path:
- `InflatePathsD` to widen centerlines into wall polygons and inset merged fills
- `UnionSelfD` to merge overlapping wall polygons into a single fill
- `DifferenceD` to subtract door/window cutouts
- `AreaPathD` to filter orientation and degenerate paths
- `PathsD` / `MakePathD` for path construction and marshaling

CSP-safe variant (the default since the CSP dropped `'unsafe-eval'`):
- Generated JS glue: `src/lib/vendor/clipper2/clipper2z.experimental.js`
- Generated wasm copy: `src/lib/vendor/clipper2/clipper2z.experimental.wasm`
- Generator: `scripts/generate-clipper2-experimental.mjs`

The experimental variant keeps the same wasm and public API shape, but replaces embind's runtime `Function`-constructor invoker generation with a generic dispatcher. That targets the same unsafe-eval surface area that `-sDYNAMIC_EXECUTION=0` removes in Emscripten, while staying side-by-side with the original bundle. Builds use it unless `VITE_CSP_MODE=current` restores `'unsafe-eval'` and the original glue (see `csp.config.mjs`); `clipper2Runtime.test.ts` checks both produce identical wall volumes.
