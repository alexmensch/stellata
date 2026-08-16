# Chart mode

Paper-aesthetic alternate render path inspired by Sky Atlas 2000.0
(chart 22 reference). Activated by `M` keyboard or
`setFilter({ chart: true })`. **Observe-only** — the `chart-mode.ts`
orchestrator listens to the `'cameraMode'` event and auto-clears the flag
on observe→navigate. URL state persists `chart=1` only when both flags
are set (FLAG_CHART = 1 << 6 in the flags byte).

## Files in this area

```
src/client/chart-mode/
  chart-mode.ts                   Orchestrator. Toggles body.chart class,
                                  mono theme, Milky Way isobar handoff,
                                  chart-labels engine, and the
                                  constellation figure's
                                  draw-all-asterisms mode.
  chart-labels.ts (+ test)        `ChartLabels` — per-frame label engine:
                                  proper names, Bayer Greek glyphs,
                                  constellation Latin labels, cloud labels.
                                  Dirty-tracked SVG writes + centroid cache
                                  + sorted apparent-size top-N — see
                                  src/client/debug/README.md § What got
                                  optimised.
  chart-disc-pure.ts (+ test)     Pure helpers for the magnitude →
                                  pixel-size mapping in chart mode.
  chart-palette.ts                Authored ink values of the paper palette,
                                  shared by the layers that swap into it
                                  (§ Chart palette).
```

## Chart palette

`CHART_REFERENCE_INK` (`#3a3530`) is the ink for chart-mode *reference*
geometry — the galactic coordinate sphere (`../galactic/coord-spheres/README.md`) and the
IAU constellation boundaries (`../constellation-boundaries/README.md`),
which take it at half weight and dotted. It sits deliberately lighter than the
near-black figure / label ink so reference lines read as a layer under the
chart's content. One token, because two modules authoring the same hex is
how the two drift apart.

Colours reach the GPU through `setBuiltinChromeColour`'s **chart** variant:
chart mode bypasses the HDR resolve, so the tone-map inverse the realistic
path applies must not be (`../hdr/README.md` § Chrome).

`chart-mode.ts` toggles four things on entry:

1. `body.chart` class for CSS palette swaps (paper background, ink
   labels, monochrome topbar / brand box / typeahead).
2. `applyTheme('mono')` — flips the existing dark-mode palette to the
   mono palette (already in `theme-toggle.ts`). Its `setMonochrome`
   fan-out is what swaps the cloud layer into its chart treatment
   (stippled silhouette outlines — `../molecular-clouds/README.md`
   § Rim shell render); the milky-way band↔isobar swap instead rides
   `applyDetailPreset` (step 3) through the `milkyWayIsobar` detail bind.
3. `applyDetailPreset(getDetailLevel())` — re-derives the permitted set
   from the chart floor column (see `../scene/README.md` § Detail-level
   declutter cycle). Drives the MW isobar swap, hides realistic-only
   structure, and gates the label tiers in step 4.
4. `stellata.chartLabels.start(ctx)` — spins up the per-frame label engine
   (`chart-labels.ts`), whose tiers are gated by the detail cycle.
5. Constellation figure flips to "always draw every constellation"
   (vs. only the highlighted one) so the chart shows the full asterism
   network. Passive — the WebGL `constellation-figure/` layer is rebuilt
   by the shell off the same `chart && observe` predicate, not toggled
   here. Whether it draws at all is the declutter floor's call
   (`constellationFigures` / `chartConstellationNames`) — there is no
   master toggle over it.

Exit reverses each step — `stop()` detaches the engine's bus
subscriptions and drains its SVG pools while keeping the catalog-derived
caches for the next entry; `dispose()` (the shell's teardown leg) drops
those too.

> **Shelved layer.** The Milky Way isobar is disabled —
> `Milkyway.setIsobar(true)` hard-hides the disc + bulge meshes
> instead of emitting the contour. The blending / `uChartIsobar` switch
> is preserved in code so the contour pass can return after refinement.

## Star disc sizing — magnitude-driven

In chart mode the vertex shader replaces `max(appSize, physSize)` with
a **linear-in-magnitude** mapping (= log10-in-flux by definition of
magnitude). **Planet bodies take the identical treatment** (uadc.3
decision: magnitude disc + star-style name label, no glyph
vocabulary): `planet.vert.glsl` carries the same chart branch driven
by the same shared uniforms, the reflected-light appMag feeds the same
formula, and `PlanetBodyField.setMonochrome` swaps blending exactly
like the star pipeline's `setMonochromeBlend` (the spheroid mesh LOD
and the local depth pass idles in chart — rings
are hidden on paper). Planet name labels ride the chart-labels engine
(`kind-planet`, proper-name priority tier); `planet-labels.ts` stays
chart-hidden as before.

```glsl
chartT = clamp(
  (appMag - uChartMagBright) / max(uLimitMag - uChartMagBright, 0.001),
  0, 1);
pxSize = mix(uChartDiscMaxPx, uChartDiscMinPx, chartT);
vPhysRatio = 1.0;  // force the frag shader's disc-pass branch
```

Three tunable uniforms shared with JS via `getChartDiscParams()`:

- `uChartDiscMaxPx` (default 28 px) — diameter at the bright end.
- `uChartDiscMinPx` (default 1.5 px) — diameter at the faint end.
- `uChartMagBright` (default −2.0) — magnitude that maps to MAX
  (covers Sirius/Vega/etc. at any vantage short of standing-on-a-
  bright-star).

The mapping is **range-aware** — sliding the magnitude limit from 6.5
to 15 spreads the same disc-size range across more stars instead of
crowding everything to one corner. Variability magMod is added to
`appMag` *before* this formula runs so the inner disc keeps pulsing.

## Chart-mode disc rendering — flat hard-edged + per-vertex AA

The fragment shader's `uMonochrome > 0.5` branch renders a flat
disc (no super-Gaussian profile, no halo, no luminosity-class
softening) with a **one-pixel antialiased outer edge**:

```glsl
float aa = max(vAaWidth, 1e-3);
float disc = 1.0 - smoothstep(0.5 - aa, 0.5, r);
outColor = vec4(vec3(1.0 - disc), 1.0);  // black ink under MultiplyBlending
```

The ink only lands because the material is in `MultiplyBlending` — and
three.js **refuses that blending unless `premultipliedAlpha` is true**,
logging but issuing no `blendFunc` at all while still caching the swap as
applied. The draw then inherits the previous material's blend state, so
the failure is order-dependent rather than consistent: it shipped as
chart discs rendering white when chart was toggled on from observe, while
entering chart directly on load happened to inherit a benign state. Every
emitter that inks on paper takes the swap through
`applyMonochromeBlend` (`../star-pipeline/star-pipeline.ts`) for that
reason — the flag is not optional decoration.

`vAaWidth = 1 / pxSize` is computed per-vertex and passed as a
varying. **Don't switch to `fwidth(r)`** — `length(vUv)` has an
undefined screen-space derivative at the quad centre (vUv = (0,0)),
which produces faint or invisible discs at any size. Per-vertex AA is
stable because the value is independent of the fragment's UV
position. The vertex shader sets `vAaWidth` in every return path
(early-out, hide-focus, invisible cull, both pxSize branches) so the
varying is always defined.

The disc-pass branch hard-clips at `vAppMag > uLimitMag` (no soft
taper, since a sub-pixel fade-in band reads as a hard cutoff anyway
on a paper chart). Chart reads the *instrument* limit, not the
trim-following `uThresholdMag`: it is deliberately non-photometric and
inherits no exposure state at all.

## Chart treatments — Milky Way isobar + cloud outlines

- **Milky Way** (`milkyway.frag.glsl`): an `if (uChartIsobar > 0.5)`
  branch renders a single thin line, `line = 1 - smoothstep(fw*0.5,
  fw*1.5, |appMag - uLimitMag|)` where `fw = fwidth(appMag)`. The
  contour tracks "where the integrated brightness would equal the
  instrument's limiting magnitude" — change instrument and the contour
  moves through the band like a topographic line. Discarded outside the
  line so depth stays clean. Solid black ink (`uMonoColor`), toggled by
  `MilkyWay.setIsobar` with the shared `uLimitMag` uniform reference.
- **Molecular clouds** (`../molecular-clouds/cloud-rim.frag.glsl`): the
  rim-shell material's chart branch draws a **stippled silhouette
  outline** of each cloud's isosurface mesh — the SkyAtlas 2000 nebula
  convention — via `MolecularClouds.setMonochrome` (the registry
  fan-out), not an orchestrator call. The absorption pass hides
  entirely on paper.

## Label engine + glyphs (`chart-labels.ts`)

Per-frame engine that fills three SVG layers under `#overlay`. Each tier is
gated by the detail cycle — `tick()` reads `detailPermits(id)` per group
(star names + planets → `chartStarNameLabels`, Bayer → `chartBayerGlyphs`,
rings + wings → `chartVariableRings`, constellation names →
`chartConstellationNames`, cloud names → `chartCloudNames`) and skips the
group's build loop when the current level doesn't reach its chart floor.
See `../scene/README.md` § Chart-content wiring for the couplings.

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

**Greedy collision pass** with axis-aligned bounding rectangles, sorted
by priority (proper name 1 → Bayer 2 → cloud 3). Constellation names
**bypass** the collision pass entirely — they always render at
`#chart-labels .chart-label.kind-con`'s sparse semi-transparent outline
typography, allowed to overlap small star symbols underneath à la Sky
Atlas; see styles.css for the live size / weight / letter-spacing.

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
(`../constellation-boundaries/README.md` § Label anchors) — baked to the
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
the end of each tick.

## Picking under chart mode

Click-pick tracks **render visibility** identically for every kind: a
body is click-pinnable iff it is currently drawn. Chart mode hard-clips
the star disc at `uLimitMag` (no soft taper — § Star disc sizing), so
`pickStar`'s cutoff drops the `SOFT_TAPER_MARGIN_MAG` it adds in
navigate. **Both** kinds size the hit radius from the chart disc px
(`chartDiscPxForAppMag`) rather than the physical/perceptual disc —
`PlanetBodyField.pick` inline, the star path through `resolveStarPick`,
whose radius is the ink disc the chart actually draws. Sizing stars off
the realistic footprint is what let a resolved primary swallow every
nearby hit. The catalog-wide prefilter still prunes on the realistic
footprint, so in chart it must bound the ink disc too
(`../camera/controls/README.md`). The shared cutoff constant lives in
`solar-system/perceptual-magnitude.ts`.

`Picker.pickStar` (`camera/controls/picker.ts`) three fixes for the small-disc /
variable case:

1. **Variable bright-extreme filter.** Filter check uses
   `appMag - amplitude/2` so a variable whose disc is only visible at
   peak phase remains pickable across the whole cycle. Without this,
   GPU shows the disc but the picker can't see it.
2. **Disc hit-radius floor.** `MIN_DISC_HIT_RADIUS_PX = 4`. Tiny
   chart-mode discs (1–2 px) get a 4 px hit target so the cursor can
   realistically land within it; larger discs are unaffected. The
   14 px proximity fallback is unchanged but only fires if no other
   disc has won, which on a crowded chart it often has.
3. **pickScore tiebreak.** Within the prime tier (cursor inside a
   rendered disc), the cursor's pixel distance to each candidate's
   projected centre wins (`pickScore = pxDist + appMag *
   PICK_MAG_BIAS_PX_PER_MAG`, with `PICK_MAG_BIAS_PX_PER_MAG = 0.05`
   in `star-geometry.ts`). Visually-resolved pairs whose hitboxes
   overlap stay independently clickable — the Double Double (ε¹/ε²
   Lyr) is the canonical case. The sub-pixel mag bias tiebreaks
   coincident catalog companions sharing x/y/z, e.g. Alula Australis
   A/B (Gl 423A/B at identical coordinates). Camera distance is
   deliberately ignored in this tier — see the `pickScore` docstring
   for the trade-off.

## Binary indication coverage

Wings are driven by `flags` bit 4. Three build-time passes set that bit:

- **Geometric inference** in `build-catalog.ts` — finds AT-HYG rows
  where both components of a pair survive the classic_ids cut
  (~14 systems; α Cen-style cases).
- **CCDM + MultFlag HIP-keyed cross-match** — every Hipparcos star
  carries a `CCDM` column linking it to the Catalog of the
  Components of Double and Multiple stars (Dommanget & Nys 1994).
  CCDM alone is too permissive (tags ~19k stars including many
  wide line-of-sight optical pairs like Vega and Pollux), so the
  build gates it with Hipparcos's own `MultFlag` — keep only
  `{C, G, O}` (component / resolved-in-field / orbit-known); drop
  blank, `V`, and `X`. A small curated `KNOWN_VISUAL_DOUBLES` map
  in `build-catalog.ts` recovers canonical pairs Hipparcos
  modelled as single stars (Polaris, ε¹ Lyr, 61 Cyg A/B). Surfaces
  Sirius, Mizar, Castor, α Cen, Albireo, γ And, ε Lyr, 70 Oph,
  Procyon, Algol, etc. without the optical-pair tail.
- **Eclipsing binaries** — every `VAR_TYPE_ECLIPSING` record (GCVS
  EA/EB/EW/ELL/E; EP eclipsing-by-planet excluded) that the two
  passes above didn't already flag. An eclipser's variability is
  the geometry of a stellar multiple, so it earns wings, not a
  variable ring (see § Label engine — variable rings above).

All three passes hit the same flag bit, so chart-mode rendering is
agnostic to which source flagged a given star. The build-time filter
rationale + parser format are in the catalog build's CCDM cross-match
section.
