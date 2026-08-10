# Per-star dust extinction

The camera→star V-band extinction read: one raymarch per star through
the Edenhofer 3D dust texture, cached in a star-indexed render target
that `../star.vert.glsl` consumes with a single `texelFetch`.

The **cancellation invariant** below is the load-bearing content here —
catalog `absmag` / `ci` are stored de-extincted, so this runtime stack
restores extinction rather than adding it twice.

The source order this march follows — measured grid inside its coverage,
analytic slab beyond, with the seam handed over as a coverage-exit distance —
is a **shared contract**, not a local choice: the Milky Way band composes its
own dust column the same way. `docs/science-galactic-structure.md` § The dust
stack is the contract. The two share the analytic term and the ordering but
**not** the sampling mechanism — this march cannot take a prefiltered field
without breaking the cancellation invariant below.

## Files in this area

```
src/client/star-pipeline/extinction/
  extinction-prepass.ts           ExtinctionPrepass — the per-star A_V cache
                                  and its camera-displacement invalidation.
  extinction-prepass.frag.glsl    The prepass draw: one fragment per star,
                                  writing raw physical A_V into R32F. Rides
                                  the shared fullscreen vertex stage +
                                  geometry in ../../util/fullscreen-pass.
  extinction-prepass-pure.ts      Texture geometry, position packing, and the
    (+ test)                      ε-displacement predicate. Vitest-pinned.
  dust-raymarch.glsl              Shared camera→star Edenhofer raymarch chunk
                                  (stellata_dust_raymarch), included by the
                                  prepass and by ../star.vert.glsl's fallback
                                  path. Spliced in stellata.ts via ?raw. Its
                                  single-sample `dustDensityAt` (bbox test +
                                  log decode) is the one piece the band's
                                  froxel fill shares — see
                                  ../../dust/froxel/README.md.
  dust-raymarch-pure.ts (+ test)  CPU mirror of the raymarch decode +
                                  trapezoidal integration and the
                                  E(B−V) = A_V / R_V reddening. Test-only;
                                  pins the shader math against
                                  synthetic-cloud fixtures.
```

## What the read produces

Each star is dimmed by the V-band extinction A_V integrated through
the Edenhofer 3D dust texture along the camera→star sightline, and
reddened by E(B−V) = A_V/3.1 on the intrinsic LUT-input B–V. That input
is the shader's two-tier routing: `Ballesteros(iTeffApsis)` when an
Apsis Teff is present, else the baked intrinsic `iCi` (observed AT-HYG
B–V or the spectral-class colour baked at build — see `../README.md`
§ Colour routing). Looking through dust dims and reddens stars behind
it, which is what you'd actually see.

## The prepass cache

`ExtinctionPrepass` renders one raymarch per *star* into a
star-indexed R32F render target (1024 × ⌈count/1024⌉; star *i* at
texel `(i % 1024, i / 1024)`); `../star.vert.glsl` consumes it with a
single `texelFetch`. Without the cache the identical integral ran in
the vertex shader once per vertex (×4) per pass (×2–3) — 8–12
recomputations per visible star per frame.

- **Invalidation** is camera-displacement-based: the target is
  recomputed when the absolute camera position moves more than
  `RECOMPUTE_EPSILON_PC` (1 pc) from the last-computed position, when
  a dust voxel chunk lands on the GPU (progressive load), or on
  (re-)attach. Between recomputes the cached values are served
  **stale-while-moving** — extinction varies on ~5 pc voxel scales,
  so worst-case drift at ε is ~0.003 mag. Close-range orbiting
  (AU-scale motion) never recomputes; a fast warp recomputes per
  frame, which still costs ~1/10th of the old per-vertex-per-pass
  scheme.
- **Positions are the catalog baseline** (`catalog.positions`, packed
  once into an RGBA float texture) — binary-orbit perturbations
  (sub-AU) are ignored, as is the floating origin (both the prepass
  march and the fallback run in absolute heliocentric space).
- **Fallback:** on contexts without `EXT_color_buffer_float` (no
  float-renderable target) the prepass is inert and the vertex shader
  runs the in-vertex camera→star raymarch, gated by the visibility
  prefilter. Both paths share the `stellata_dust_raymarch` chunk
  (`dust-raymarch.glsl`). The march's 48 fixed samples are a
  pragmatic trapezoidal integration: at 1.25 kpc that's 26 pc per
  step ≈ 5 voxels of the texture's native ~5 pc resolution; more
  samples cost proportionally with marginal quality gain.
- **A/B switch:** `stellata.setExtinctionPrepassEnabled(false)` (dev
  console) parks the shader on the fallback path — the honest way to
  measure the prepass win on identical scenes; `true` restores the
  cache.

The prepass stores raw physical A_V; `uDustEnabled ×
uExtinctionStrength` scales it at the point of consumption, so
strength changes never invalidate the cache.

## The cancellation invariant

Catalog `absmag` and `ci` are stored **intrinsic** (de-extincted at
build against the same voxel grid — see
`scripts/catalog/distance/README.md` § Build-time de-extinction), so this
runtime extinction *restores* the observer-relative extinction rather
than double-applying it: at camera=Sol the build subtraction and this
addition cancel, so a dusty-sightline star renders at its AT-HYG
observed magnitude. **Invariant:** any change to this runtime stack
(map, slab) must ship with the mirrored build-side integral + catalog
rebuild, or the cancellation breaks.

`stellata.setExtinctionStrength(x)` (dev console) scales the re-added
A_V: default 1 = physical realism; **0 = a dust-free universe** (every
star at its intrinsic brightness/colour everywhere, since nothing is
re-added on top of the de-extincted catalog); >1 amplifies dust
visually.
