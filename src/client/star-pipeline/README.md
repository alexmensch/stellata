# Star pipeline

The star renderer's CPU half — instanced quads, three passes,
physical-size scaling, the super-Gaussian intensity profile, and
luminosity-class softness. Pulsation and dust extinction live in the
subfolders. The pipelines that draw are `../webgpu/star/`, over the
attribute writers here.

## Subfolders

- `star-frame/` — `StarFrame` (the CPU star position frame:
  local-position buffer, epoch advance, derived buffers, proximity
  queries). The floating origin and the shared uniform map every pass
  holds by reference live in `../frame/` (`FloatingOrigin`,
  `buildSharedUniforms`).
- `extinction/` — the per-star camera→star A_V raymarch and its prepass
  cache, plus the build-time de-extinction cancellation invariant.
- `pulsation/` — the per-type variable-star {ρ, ΔB−V} tables and the
  eclipsing-binary suppress mask.
- `local-pass/` — `StarLocalCluster` + the `StarMirror` contract: which
  stars join the local depth pass each frame and the mirror draw that
  re-renders them inside its bracket. `MIRROR_CAPACITY` and the
  `RESOLVED_DISC_MIN_PX` / `discWindowPc` pivots the core-mask gate
  shares live there.
- `collapse/` — the vertex-stage taper cull + kernel collapse bounding
  what a display-invisible star's quad costs — its own README.
- `shards/` — the population-shard contract (`StarShardTable` flat
  Target.idx mapping, per-shard SID columns, chunk-local coordinates,
  the recentre eagerness rule); the catalog is shard 0. Its § What is
  NOT shard-aware yet lists the legs still indexing `catalog` directly.
- `perceptual-disc/` — the display kernel: the `max(appSize, physSize)`
  sizing rule, the plate-scale calibration that makes it
  viewport-invariant, and the super-Gaussian profile. The CPU mirrors
  and the uniform interface live there, and it stays the authority on
  both — the sections below cover only how the star passes bind to it.

## Files

- `star-module.ts` (+ test) — the star `ObjectKindModule`
  (`../kinds/README.md`): catalog + search-index load (`critical:
  true` — its load may reject and boot treats that as fatal) and the
  focusable / card / hover / search / SID / pinnable / focal-hide legs.
  **This is the only fetch of `search-index.json`** — it lands as bytes
  and every reader, worker included, works from them
  ([The search-index worker](../typeahead/README.md#the-search-index-worker)).
  **`load` resolves on the catalogue's FIRST chunk**, so boot can paint;
  `ready` is the second promise, settling when the whole population and
  the search index have landed and every table derived from them is built
  ([Progressive catalog load](../loaders/README.md#progressive-catalog-load)). The search index is
  deliberately not awaited in `load` — 4.4 MB gzipped feeding only search,
  chart labels and designations, none of it on the first-paint path. Its
  fetch is issued before the catalogue is awaited and nothing attaches to
  it until `ready` exists, so it carries a silent catch to mark it handled
  across that window; `ready` still sees the rejection.
  `load` also derives the name tables the card tiers read
  (`../typeahead/star-name-tables.ts`), so `starLabels` is a getter
  beside `catalog` / `searchIndex` rather than something boot hands
  back — and it is ONE map filled in place, because every card provider
  and chart binding captures it before the index lands. `derivedGeneration()`
  counts those fills so a retained surface can tell that a table moved
  under it ([Surfaces retained over a growing catalogue](../focus-card/README.md#surfaces-retained-over-a-growing-catalogue));
  `card()`'s `tablesComplete` leg answers whether they are all
  in, which is what withholds a half-built card. The render layers
  stay shell-wired (`attach` returns null), and
  the legs reach the shell-owned machinery — StarFrame positions, park
  solve, rendered size, the Picker's star pick, the binaries table —
  through the single injected `StarModuleRuntime`. `photometry()` is
  the one leg a *non*-star module reads, via
  `KindContext.starPhotometry`.
- `star-source-attributes.ts` — the four per-star buffers the shell
  rewrites (`iPosition`, `iCompositeSuppress`, `iEclipseDim`,
  `iSuppressPulsation`), wrapped as `BufferAttribute`s over the shell's
  own arrays. Nothing instances them: they exist for the version and
  dirty ranges `util/attribute-upload` flags and
  `../webgpu/star/star-tables.ts` forwards.
- `star-blend.ts` (+ test) — `applyDiscBlendDefaults`,
  `applyGlowBlendDefaults`, `applyMonochromeBlend` and the
  `applyChartBlendSwap` pair helper over them. Every field they set is on
  `THREE.Material`, so the star layer and the planet glare share them.
- `star-quad.ts` — `STAR_QUAD_CORNERS` / `STAR_QUAD_INDEX`, the unit
  square every star-shaped emitter's geometry expands.
- `star-pass.ts` (+ test) — the pass identities (`STAR_PASS_GLOW` /
  `STAR_PASS_DISC` / `STAR_PASS_CORE_MASK`) and `colourPassFor`, the
  size-terms → colour-pass routing the pick mirror shares. The vertex
  stage's compile-time pass specialization keys on the same constants. `starPassRouting` reads the
  split both ways — undimmed and dimmed — for the eclipse debug HUD
  ([Eclipse routing](../debug/README.md#eclipse-routing--finding-a-band-you-cannot-see)); nothing in the render path
  calls it.
- `star-color-routing-pure.ts` (+ test) — `bestApsisTeff`: picks
  gspphot over gspspec for the per-instance `iTeffApsis` attribute.
  See § Colour routing.
- `blackbody-lut.ts` — hand-written runtime wrapper. Re-exports the
  generated bytes + constants and owns the three.js `DataTexture`
  construction.
- `blackbody-lut-data.ts` — **AUTO-GENERATED** by
  `scripts/colour/blackbody-lut.ts`. Do not edit by hand. 256-entry
  blackbody → **linear**-sRGB lookup indexed by B–V over [-0.4, 2],
  peak-normalised. Regenerate via `pnpm run build:lut`. The vertex
  shader renormalises each sample to luminance 1 (§ Physical-luminance
  emission).
- `star-pass-split.test.ts` — pins the vertex stage to routing the
  disc/glow split on the undimmed magnitude (§ Star rendering).
  Source-level, because no behavioural suite can reach it: the CPU
  mirror takes resolved size terms and agrees with itself whichever
  value the shader routes on.

## Physical-luminance emission

Stars emit into the scene-wide HDR unit ([Unit](../hdr/emission/README.md#unit--what-an-emitting-layer-writes)).
Brightness is the **peak** of the profile, `vPeakL`, computed per
instance in the vertex shader from the star's apparent magnitude:

```
vPeakL = pointSourcePeakTsl(uExposure, appMag, 0.5 * physSize)
```

The √Δm appSize curve and the plate-scale exaggeration `K` are purely a
display kernel normalised to peak 1 ([Star intensity profile](perceptual-disc/README.md#star-intensity-profile))
— they size the star and do not encode how bright it
is. **`K` therefore
stops being a calibration knob**, trading only legibility against how
crowded a dense field looks.

The radius argument is the **unclamped** `physSize` in **CSS** pixels;
[Unit](../hdr/emission/README.md#unit--what-an-emitting-layer-writes) has why, and it applies whichever term wins
`max(appSize, physSize)` so nothing pops at the disc/glow split.

Two consequences specific to this pipeline:

- **Every magnitude-domain modifier became photometric for free.**
  A_V, `iEclipseDim`, the variability `magMod`, and the glow pass's
  ±0.5-mag soft taper already worked in magnitudes, so they now modulate
  real luminance rather than just footprint size.
- **The profile thresholds did not.** `uCoreThreshold` and
  `uDiscardThreshold` still compare against the unit-peak kernel, so a
  bright and a faint star still split halo-from-core at the same radius.
  The depth/halo decision is about shape, not brightness.

The instrument's limiting magnitude drives `uExposure`
(`../hdr/exposure/README.md`), and the vertex cull is a *separate*,
derived bound (`uCullMag`) sitting far enough past it that +3 stops of
manual trim can never expose a population edge. Population cutoff and
exposure no longer agree by construction — they agreed only while one
number served both.

Validation compares **per-pixel** luminance, never integrals: the
K-exaggerated footprint over-counts a star's frame flux by design
([§ 1,](/docs/science-hdr-pipeline.md#1-the-unit--threshold-anchored-display-luminance) § 8). The exposure statistic needs
that integral back, so `vFluxPeakL` carries the same kernel divided by its
own area integral `Φ(n)·D²` — `perceptualDiscFluxIntegral` in
`../webgpu/perceptual-disc-tsl.ts`, and `../hdr/attachments/README.md` for what reads it.

**The disc pass's core claims lit-surface coverage; the glow pass claims
none.** That split is not about stars — it is the general rule read off
the unit: an emitter claims coverage exactly where it emits surface
brightness over its own physical footprint rather than a PSF peak over an
exaggerated kernel ([The unit](../hdr/attachments/README.md#the-unit)). A resolved
photosphere is the one resolved surface in the model the exposure pin used
to be unable to see, and a star at closest approach rendered as a flat
blown-out white disc because of it. The claim is `step(uCoreThreshold,
glow)` — the same threshold the core depth-mask stamps over, since the
halo is where the kernel stops reading as the photosphere.

## Colour routing

Runtime colour is **two-tier** — `iTeffApsis > 0 ? Ballesteros(iTeffApsis)
: iCi` in `../webgpu/star/star-vertex-tsl.ts` — where `iCi` is the build-time-baked
intrinsic B–V (observed AT-HYG cell, or the spectral-class colour
`spectralClassCi` bakes in
`scripts/catalog/spectral/physical-radius.ts`).
`bestApsisTeff` decides which Apsis Teff feeds `iTeffApsis`.
`extinction/` reddens whichever tier wins.

`ciToColor` then divides the LUT sample by its own relative luminance,
so `vColor * vPeakL` has luminance exactly `vPeakL` and chromaticity
carries no brightness side-channel. The table is stored peak-normalised
instead of luminance-normalised because a Y=1 triplet reaches 1.88 at
the blue end and will not fit uint8 — `scripts/colour/README.md`.

## Star rendering: instanced quads, three passes

Stars are rendered as **instanced unit-quads**, not `THREE.Points`.
WebGPU draws a point primitive at exactly 1 px — nothing like the
close-range physical-size rendering, which can target up to 50% of the
viewport. Each instance is one
`aCorner` vertex × 4, expanded to screen-space pixels in the vertex
shader by projecting the star centre, then offsetting each corner in
clip space by `corner × pxSize / viewport × 2 × centre.w` (the `×w`
makes the offset perspective-correct so stars stay a fixed pixel size
regardless of depth).

Rendering is **three passes over the same instanced geometry**:

- **Core depth-mask** (`renderOrder = -4`). Depth-only pass over
  disc-pass cores (`glow ≥ uCoreThreshold`). `colorWrite = false`,
  `depthWrite = true` — emits no colour but stamps near-z into the
  depth buffer before any background layer renders. Causes the Milky
  Way, molecular clouds, galactic disc, and galactic grid (all
  `depthTest: true`) to depth-fail behind close-range disc cores
  rather than bleeding through.

  **This pass is the one part of the star pipeline that registers as a
  scene layer**, and it does so because it is the only part with a
  per-frame visibility verdict of its own. Its entry declares
  `contribution: { kind: 'gated' }` on
  `starLocalCluster.hasMembers() || starFrame.shouldEnableCoreMask()`
  (members stamp regardless of the physSize window —
  `local-pass/README.md`), reported as `'legibility'`: the gate walks a
  bounded window of the Sol-distance-sorted index and skips the whole draw
  call when no star is close enough to subtend `RESOLVED_DISC_MIN_PX`; the
  window derivation is [`forEachStarNearCamera`](star-frame/README.md#foreachstarnearcamera--sorted-distance-binary-search-window).
  The floor is that constant and not the shared
  `FEATURE_LEGIBILITY_MIN_PX` — below it the bleed-through the mask stamps
  against is too small to see, and a wider floor would reject frames the
  mask does change. The entry is registered **after** the star local
  cluster's, so membership is this frame's, and it declares the binary
  walk's rate as anchored content ([Anchored content](../scene/README.md#anchored-content-declares-its-anchors-rate)).
  Everything else in this folder keeps explicit lifecycle calls
  in `stellata.ts`.

  **The predicate refuses above the walk while the `coreMask` lever is
  off.** That walk is what the lever's own A/B prices
  (`../debug/frame-cost/passes/README.md`), and it now runs inside the
  contribution test rather than beside it — so without the refusal both
  sides of the A/B would pay it and the `coreMask` row would price
  nothing. Refusing means the layer contributes while drawing nothing,
  which is the direction the contract allows.
- **Disc pass** (`renderOrder = 0`). Stars where `vPhysRatio ≥ 0.5` —
  i.e. the physical-size term dominates the final
  `max(appSize, physSize)`. Per-channel `MaxEquation` blend
  (`CustomBlending` with `OneFactor` × `OneFactor`) + `depthTest`, and
  no `depthWrite`. The blend and depth state lives in one helper,
  `applyDiscBlendDefaults()`, called both at construction and on
  chart-mode → colour-mode swap-back, so the two sites can't drift.
  **The pass writes no depth of its own**: the core-mask draw already
  stamped the same fragments several renderOrders earlier
  ([The disc draw writes no depth](../webgpu/star/README.md#the-disc-draw-writes-no-depth)), which is
  what keeps all three pipelines' early-z.
- **Glow pass** (`renderOrder = 1`). Stars where `vPhysRatio < 0.5`.
  Additive blending + depthTest but no depthWrite, so overlapping
  distant-field stars accumulate brightness (Milky Way density stays
  alive) and glows correctly depth-fail against any disc drawn in
  pass 2.

The three are separate pipelines over the same star-indexed storage
tables, drawn indirect at survivor count, and the pass is a compile-time
specialisation rather than a uniform (`../webgpu/star/README.md`). The
disc pass discards fragments with `vPhysRatio < 0.5`; the glow pass
discards `vPhysRatio ≥ 0.5`; the core mask discards both
`vPhysRatio < 0.5` and `glow < uCoreThreshold`.

**The three discards are complementary only while all three agree on
`physRatio`, and that is not free.** Each pipeline runs the vertex stage
independently, so any per-pass term reaching the size solve makes them
disagree — and the disc/glow discards are written as a partition, so a
disagreement drops the star from *both*, drawn nowhere while every CPU
mirror believes it renders. One term does this: `iEclipseDim`, folded
into `appMag` in the glow pass only, which shrinks `appSize` and thereby
*raises* `physSize / max(appSize, physSize)`. So the ratio is solved
from the **undimmed** `appSize` in every compilation (`routeAppSize` in
the vertex stage) while the footprint `pxSize` still carries the dim.
`vPhysRatio` is therefore the star's size *class*, not literally
`physSize / pxSize` — a dim fades the star and shrinks its quad, it never
re-tiers it. `isDiscDominant`
(`local-pass/star-local-cluster-pure.ts`) is the CPU mirror of that
routing and takes the undimmed size for the same reason, as does the
pick gate (`../camera/controls/star-pick-visibility-pure.ts`).

**`appMagRoute` is carried, never reconstructed.** The undimmed
magnitude is captured before the eclipse fold and takes the dust add
alongside `appMag`, so it is the identical sequence of adds the disc and
core-mask compilations run — equal bit for bit. Rebuilding it as
`appMag − eclipseDimMag` instead does not round-trip in float32 and puts
the glow pass back on a value the other two never compute, for any star
within ~1.6 × 10⁻³ px of the split. It is pinned against
that in `star-pass-split.test.ts`, which is the only thing that
can catch it: `colourPassFor` takes size terms already resolved, so the
CPU mirror agrees with itself whatever the graph does.

**`vPhysRatio` is not only the router**, so this reaches more than the
vanish band. It also drives `perceptualDiscExponent`
(`distN = mix(distNMin, distNMax, smoothstep(0, 0.5, physRatio))`) and
the kernel-collapse gate, so an eclipsed glow star now keeps the
intensity profile its *resolved* size implies rather than flattening
toward disc-like as the dim deepens, and stays collapse-eligible when it
dims under the floor. `vFluxPeakL` stays exact either way — the fragment
paints from the same varying the flux integral is taken over.

`uHideFocusIdx` (int) suppresses a single star across all three passes by
collapsing its vertex to a clip-space sentinel outside the frustum when
the star being drawn is the one it names. Defaults to `-1` (no
suppression). Set to the focal-star index in OBSERVE
mode (camera parked at the focal star — disc would render from inside) and
held pinned to the source star throughout an observe-launched warp so the
reorient phase doesn't flash the focal disc as the camera pulls away; the
pick path mirrors it (`../camera/controls/star-pick-visibility-pure.ts`).

`iCompositeSuppress` (float, per-instance) collapses a star's disc and
core depth-mask passes — but not the additive glow — under the same
clip-space-sentinel mechanism, gated on the compile-time pass. Written by `BinaryOrbitField` (see
`../binaries/README.md`) for the dimmer member of a sub-pixel binary
pair: the two near-coincident point sources sum brightness correctly
under AdditiveBlending in the glow pass, and dropping the opaque disc
+ depth mask avoids z-fighting between the two overlapping cores.

`iEclipseDim` (float, per-instance, default 1.0) multiplies the back
component's flux when an orbital pair's discs overlap from the camera
viewpoint. Written by `EclipsePhotometryField` (see
`../binaries/eclipse/README.md`) with real-time
smoothing, and re-uploaded only on frames with active dims. Folded
into `appMag` in the **glow pass only** — a resolved pair's disc
overlap orders geometrically in the local depth pass instead
(`local-pass/README.md`) — and deliberately kept out of the pass-split
solve, since it is the one per-pass term that could make the three
compilations disagree (§ Star rendering). Exactly 0 means totality: the glow quad
collapses via the off-screen-sentinel pattern instead of taking a
floored log. Integration shell initialises the buffer to 1.0 at
allocation and on every re-attach, so the shader's
`iEclipseDim < 1.0` gate fires only on slots the field holds below 1.

`iSuppressPulsation` (float, per-instance) gates the GCVS-amplitude
radial pulsation block. Built once at catalog-load time from
`catalog.varType` (via `buildPulsationSuppressMask` in
`pulsation-suppress-pure.ts`): 1 on every `VAR_TYPE_ECLIPSING` record,
regardless of whether it has a renderable orbit. Eclipsers are extrinsically
variable, so the cosmetic pulse is always dishonest; orbital pairs
additionally get the geometric dip from `iEclipseDim`, orbit-less
eclipsers simply render static.

`uPinFocusToCenter` (int, default `-1`) replaces the standard
projection chain with `projectionMatrix * vec4(0, 0, -dPc, 1)` for the
matched instance, sidestepping float32 cancellation in the projection
chain at sub-µpc orbit distances. Set per-frame by the integration
shell when the focused star qualifies; the engage / disengage rules +
load-bearing `controls.target` invariant are managed in the focus
controller.

Chart mode swaps the disc and glow materials to `MultiplyBlending` +
disables depth for an ink-on-paper look against the light canvas, and replaces
the super-Gaussian profile with flat hard-edged discs sized linearly
by magnitude. It is non-photometric and bypasses the HDR seam
entirely, so it emits no luminance ([Chart mode](../hdr/README.md#chart-mode--full-bypass)).

## Sizing and profile — `perceptual-disc/`

How a star gets its pixel size and its shape moved to
`perceptual-disc/README.md`, which stays the authority: the
`max(appSize, physSize)` rule and the glow taper (§ Physical-size
rendering), the plate-scale derivation of K that makes star size
invariant in FOV and viewport (§ Angular-size calibration), and the
super-Gaussian kernel with the disc pass's halo-transparency and
discard-fringe rules (§ Star intensity profile). The debug-panel knobs
and `STAR_RENDER_DEFAULTS` are listed there too.
