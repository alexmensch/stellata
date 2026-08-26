# Chart-mode label engine

`ChartLabels` — the per-frame engine that fills three SVG layers under
`#overlay` with proper names, Bayer Greek glyphs, constellation Latin
names, cloud labels, variable rings and binary wings. It imports only
`../chart-mode.ts` (context type) and `../chart-disc-pure.ts` from the
parent; `stellata.ts` is its one consumer.

## Files

- `chart-labels.ts` (+ test) — the engine, `CHART_LAYER_IDS`, and the
  pooling / dirty-tracking machinery § What got optimised describes.

## Label engine + glyphs

Each tier is
gated by the detail cycle — `tick()` reads `detailPermits(id)` per group
(star names + planets → `chartStarNameLabels`, Bayer → `chartBayerGlyphs`,
rings + wings → `chartVariableRings`, constellation names →
`chartConstellationNames`, cloud names → `chartCloudNames`) and skips the
group's build loop when the current level doesn't reach its chart floor.
See `../../scene/README.md` § Chart-content wiring for the couplings.

- `<g id="chart-con-labels">` — `<text>` per constellation Latin name.
- `<g id="chart-labels">` — `<text>` elements for proper-named stars,
  Bayer-letter Greek glyphs (drawn from `bayerMap` built in
  `search.ts`), planet names, and molecular cloud names.
- `<g id="chart-glyphs">` — `<circle class="chart-variable-ring">`
  per visible variable, `<line class="chart-binary-wings">` per
  visible binary primary (catalog flag bit 4).

**All three are declared in `index.html`, never minted on demand**, and
sit *before* the HUD stack so the HUD paints over the chart. SVG has no
z-index — paint order is document order — and the pool appends a `<text>`
the frame its key is first seen, so DOM order within a group is the
history of which labels have entered and left the viewport, not this
frame's priority. That is harmless between labels that all punch a halo
through what's behind them, and was not harmless between those and the
`kind-con` wash (`fill: rgba(0,0,0,0.18); stroke: none`), which ate the
halo of any star name created before it. Hence the separate con group
rather than a per-frame re-append in priority order, which would
reintroduce exactly the DOM churn the pool exists to avoid.

The sequence is the fix, so it is pinned rather than trusted:
`CHART_LAYER_IDS` (exported by `chart-labels.ts`) is the one authority
for the ids **and their order**, `layerById` throws on a group the
markup doesn't declare, and `chart-labels.test.ts` reads `index.html`
to assert both the inter-group order and that all three precede
`#hud-ring`.

**Greedy collision pass** with axis-aligned bounding rectangles, sorted
by priority (proper name 1 → Bayer 2 → cloud 3). Constellation names
**bypass** the collision pass entirely — they always render at
`.chart-label-layer .chart-label.kind-con`'s sparse semi-transparent
outline typography, allowed to overlap small star symbols underneath à
la Sky Atlas; see styles.css for the live size / weight / letter-spacing.
They are never measured either, so what a star name collides against is
the padded anchor *point*, not the 36 px block.

**Star-name + Bayer label offsets** scale with the rendered disc.
`starLabelOffsetPx(discPx) = max(STAR_LABEL_OFFSET_MIN_PX,
discPx/2 + STAR_LABEL_GAP_PX)` so the label's bottom-left corner clears
the disc edge across the chart-mode magnitude range (faint sub-pixel
discs keep the floor; the brightest 28 px disc pushes the label out
to 18 px diagonal). `discPx` comes from `chartDiscPxForAppMag` in
`chart-disc-pure.ts`, which mirrors the vertex shader's chart-branch
formula.

**Constellation names sit at the IAU region's own centre, not at their
stars.** The anchor is the equal-surface-weight centre of mass of the
region the boundary layer draws — `Stellata.constellationLabelAnchors`,
one per region, off the shipped artifact
(`../../constellation-boundaries/README.md` § Label anchors) — baked to the
same Sol-centred sphere as the arcs, so `− worldOffset` is the whole
per-frame projection and the name stays inside its block from any camera
position. **Serpens therefore gets two labels**, one in Caput and one in
Cauda; the flux-weighted centroid it replaced put a single "SERPENS" in
the gap between them, which is Ophiuchus.

Visibility still gates on the members: `min(appMag) ≤ uLimitMag` over
every star byte 34 assigns to the constellation, so a region whose stars
are all under the limit goes unnamed (both Serpens labels share one gate —
one constellation, one member set). The full member walk is what fixed a
bug where constellations with no single dominant intrinsic-brightest star
(Vela, Pyxis, Sagittarius) silently dropped their label; it is **cached**
under a 0.5 pc camera-translation threshold + filter version, since
apparent magnitude barely moves under a small camera nudge.

**Variable rings** are **intrinsic-only** — the ring set gates on
`periodDays > 0 && amplitudeMag > 0 && varType !== VAR_TYPE_ECLIPSING`.
Eclipsing binaries are extrinsically variable (line-of-sight
occlusion, not the star's own output), so they surface via the wings
glyph instead and never draw a ring. Rings size to the bright-extreme
magnitude (`appMag - amplitude/2`) plus a `VARIABLE_RING_MIN_GAP_PX = 1.0`
radial gap, so the ring stays visibly outside the inner disc even at
peak phase for low-amplitude variables. The gap means the ring no
longer encodes "exact maximum brightness" — that's a deliberate trade
for glyph legibility.

**Binary wings** are screen-aligned horizontal `<line>`s extending
`discPx * BINARY_WING_EXTENSION_RATIO` (0.25) past each disc edge.
The proportional extension keeps the glyph readable across the
full chart-mode magnitude range — 16 px discs get 4 px wings,
6 px discs get 1.5 px wings — instead of overwhelming faint stars
with the fixed 4 px stub the earlier implementation drew. Below a
`BINARY_WING_MIN_EXTENSION_PX = 1.5 px` floor the wings would be
sub-pixel and the underlying disc is too faint to register as a
double anyway, so the glyph is skipped entirely rather than
rendered as a degenerate stub. SVG line coordinates are in
viewport space, so the wings stay horizontal regardless of camera
roll by construction. Both glyph classes share the per-frame
`renderableAppMag` filter — same spectMask + distance gates as the
GPU disc — so a hidden inner disc takes its glyph offscreen with
it.

**CPU/GPU dust mismatch.** Dust extinction is intentionally **not**
replicated CPU-side (per-star raymarch too expensive for the label
loop). For stars sitting behind heavy dust (Cygnus, Ophiuchus,
Aquila Rift) the GPU renders a much smaller disc than the CPU
mirror computes, so wings sized to the CPU disc would dwarf the
real rendered disc. The 1.5 px floor on the wing extension acts as
a heuristic guard — it requires the un-extincted CPU disc to be
≥ 6 px before wings render, which gives ~2 mag of headroom for
dust to attenuate the GPU disc without orphaning the glyph. The
trade is a few legitimate wings dropped on faint un-extincted
stars near the magnitude limit. **The proper fix when needed:**
ship a coarser (~128³ resample of Edenhofer 2023, ~2 MiB) CPU-side
voxel grid and raymarch per CCDM-flagged binary in the per-frame
label loop, cached by camera position. That's the right answer for
chart-mode use from far-from-Sol viewpoints, where this heuristic
breaks down further (dust columns change as the camera moves and
the heuristic stays static). Left as future work; the heuristic is
adequate for current near-Earth chart-mode use.

**Pooling.** Each `<text>` / `<circle>` / `<line>` is keyed by stable
identity (`n:idx`, `b:idx`, `c:regionCode`, `m:cloudIdx`) so adding /
removing nodes is free across frames. Unused entries are detached at
the end of each tick. `tick`'s own containers — the candidate objects,
the accepted list, the four dedupe Sets — are pooled on the same
principle, and the pool keys plus the two composed label texts (the
Bayer glyph pair, the con name's uppercase) are interned per identity
in a `StringCache`, trading a template literal per label per tick for a
hash lookup. `stop()` drops the per-tick scratch; `dispose()` also
drops the interned strings, which are catalog-derived and worth keeping
across a chart exit.

**The one per-label allocation left is the attribute string `setNumAttr`
formats**, on the labels whose x/y actually moved — unavoidable through
`setAttribute`, and it fires on exactly the frames the camera is moving.
Don't read the pooling as "chart mode allocates nothing"; see
§ Chart-labels: pooled per-frame containers below before
interpreting a profile.

Three invariants make the reuse safe. Each is mutation-pinned in
`chart-labels.test.ts` — dropping any one of them fails a test:

1. `candidateList` is **truncated to the live count before the sort**.
   Otherwise a sparser frame ranks the previous, larger frame's entries
   (constellation names, priority tier 0) ahead of its own live labels
   and redraws labels the engine never built.
2. `collides` walks **only the accepted array's live prefix**. `count`
   is a required argument, not defaulted to `others.length` — for the
   one caller that matters, that default *is* the bug.
3. `addCandidate` **rewrites `width` / `height` on every claim**.
   Constellation labels skip `measureCandidate`, so a con recycling a
   slot would otherwise collide against the measured box of whatever
   star name held it — and since cons are accepted first, that stale
   box evicts live star names. Pool slots shift down whenever an
   earlier family shrinks, which is what the magnitude slider does.


## What got optimised

The chart label engine carries the largest share of the client's CPU
optimisation history. Ordered by impact; each shipped as a separate
commit. The non-chart entries live with their own code —
`../../star-pipeline/star-frame/README.md` and `../../overlays/README.md`.

### Chart-labels: scratch `Vector3` for projection

`chart-labels.ts`. `projectVec()` originally allocated a fresh
`Vector3` per call via `p.clone().applyMatrix4(...)`. With four
candidate sets (proper names, Bayer, variables, binaries) that's
5–15k Vector3 allocations per frame, the dominant GC pressure
source.

Replaced with a module-level `projVec` scratch deliberately
*not* aliased with the existing `tmpV3` — the latter is held
across the projection in `projectStarInto`, so a shared scratch
would clobber the input. That scratch now lives in
`../../overlays/overlay-project.ts`, which `projectVecInto` calls.

The **returned tuple** was the other half, and outlived the
`Vector3`: `projectVec` handed back a fresh `[x, y]` per call, one
per label per frame across the same four candidate sets. It writes
into a caller-owned tuple now (`projectVecInto`), and `ChartLabels`
owns one for all of them — safe because each caller reads it before
the next projection runs.

### Chart-labels: pooled per-frame containers

Both halves above are about the *projector*, and the larger cost on
this path was the label engine's own churn: `tick` built a candidates
array, an accepted array, four Sets and one `Candidate` literal per
surviving label — hundreds per frame across seven families, each one
strictly more bytes than the projector tuple it sat beside.

All of it is pooled now, the same idiom as the `<text>` / `<circle>` /
`<line>` element pools, and the pool keys plus the two composed label
texts are interned per identity rather than minted per tick.

What survives is O(1) per tick — the `getChartDiscParams` bag and the
`discPxFor` closure over it — plus one attribute string per *moved*
label, from `setNumAttr`'s `toFixed`, which no `setAttribute` caller
escapes. **So chart mode under a moving camera still shows string
allocation in a sampling profile.** That residue is the DOM write, not
the label engine's containers; read a non-zero `tick` self-size as the
former before suspecting the latter.

Pooled reuse rests on three invariants, each mutation-pinned by
`chart-labels.test.ts` and argued under § Pooling above.

### Chart-labels: cached brightest constellation member

The Latin names are placed from the shipped region anchors, so the
per-member walk survives only as the **visibility gate**: a region
whose brightest member is under the magnitude limit goes unnamed,
and the apparent magnitude that decides it depends on the camera
position (88 constellations × ~30 members, `Math.pow` per member).
It barely moves under camera translation, since a constellation
spans hundreds of pc and the camera typically moves ≪ 1 pc per
frame.

Cache `minAppMag` per constellation and walk only when:

- No name is drawn at all — the declutter floor withholding
  `chartConstellationNames` — in which case the walk is skipped
  outright, not cached.
- Otherwise: camera moved more than
  `√BRIGHTEST_RECOMPUTE_DIST_SQ ≈ 0.5 pc` since the last walk, or
  the filter version bumped (via `stellata.on('filter', …)`).

The **sentinels are stamped only where the walk actually runs.**
Stamping them on a skipped walk leaves `minAppMag` at its `Infinity`
seed while the cache reads as fresh, so names re-enabled within the
0.5 pc threshold and without a filter change draw nothing —
`chart-labels.test.ts` pins both halves.

Anchors are still re-projected every frame (89 cheap matrix
transforms); it is the inner per-member loop that's elided.

`startChartLabels()` initialises `lastBrightestCamPos` to NaN so the
first frame after entering chart mode always walks.

### Chart-labels: pre-binned eligibility lists for variables + binaries

`chart-labels.ts:120`. The variable / binary index lists run to a
few thousand entries. Each frame the previous code walked the full
list, applied the spectral-mask + min/max distance-from-Sol gates
(static parts of `renderableAppMag`), then projected.

Pre-bin into `variableEligible` / `binaryEligible` on filter change
(via `stellata.on('filter', …)`); the per-frame loops drop the
spectral + distance-from-Sol checks because eligibility already
encodes them, and the cheap remaining work (magnitude gate +
projection) only runs against the pruned set. Restrictive filters
typically cut the eligible set by 80–90%.

This pass also reordered the loops so the `appMag > drawCutoffMag`
test runs *before* projection (free win — pure reorder).

### Chart-labels: dirty-tracked SVG attribute writes

`chart-labels.ts:132`. `setAttribute` triggers SVG attribute
parsing + style invalidation even when the new value matches the
old. The pooled label / circle / line objects now cache the last
written `x` / `y` / `cx` / `cy` / `r` / `x1` / `x2`. Skip the
write when the new value differs by less than `ATTR_DIRTY_PX = 0.05`
(matches the `.toFixed(1)` display precision so visually identical
attributes are coalesced). Drives `chart.dom` toward zero on a
stationary camera.

### Chart-labels: full-tick skip when nothing changed

`chart-labels.ts`. The chart label engine's output is purely a
function of camera pose, filter state, viewport size, and the
advanced catalog epoch (`stellata.advancedEpochJyr` — time scrubbing
re-advances star positions with the camera still, and the glyphs
must follow) — variable pulsation animates on the GPU, the CPU
labels don't otherwise move. Hash that tuple at the top of `tick()`:

```ts
camera.position.equals(lastTickCamPos) &&
camera.quaternion.equals(lastTickCamQuat) &&
filterVersion === lastTickFilterVersion &&
w === lastTickViewportW &&
h === lastTickViewportH &&
epochJyr === lastTickEpochJyr
```

When all six match, the entire body returns early before any
projection. NaN sentinels on `startChartLabels()` entry guarantee
the first frame after engaging chart mode always runs.

This is the asymptote: idle chart-mode CPU cost approaches
navigate-mode idle cost.

## What we deliberately did *not* do

Each was considered and rejected; flagged here so it does not get
re-prosecuted.

- **Throttle the chart engine to 30 Hz.** Tempting on idle, but
  observe-mode look-around drag is the case where the engine is
  most active, and 30 Hz labels against 60 Hz GPU render stutter
  visibly. The full-tick skip (above) gets the same idle win
  without the regression risk.
- **Move label projection to GPU (transform feedback / compute).**
  Would require rebuilding chart-mode rendering as instanced quads
  with a glyph atlas, throwing away CSS theming, crisp DPI scaling,
  and accessibility text. The CPU side is close enough to free with
  dirty tracking.
- **Optimise the O(n²) collision pass.** Bounded by accepted-label
  count (a few hundred); not the bottleneck. `chart.collision`
  consistently shows up below `chart.dom` in HUD readings.
