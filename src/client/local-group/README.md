# Local Group layers — wireframes + volumetric emission

Two sibling renderers over one catalog: an always-on reference overlay
rendering LineLoop outlines for the Magellanic Clouds, Sagittarius
dSph, classical dSphs and ultra-faints within 250 kpc, plus M31, M33,
the M31 satellite subgroup, and the outer-band dwarfs (NGC 6822,
IC 10, IC 1613, Leo A, WLM, Sextans A/B, …) out to the canonical 2 Mpc
Local Group boundary — and a volumetric emission layer that makes each
object glow at its physically correct apparent V magnitude from any
camera position (§ Emission layer below). Also the Milky Way label
(the disc itself lives in `../galactic/`; only the SVG label lives
here).

## Visibility model — no dedicated toggle, no URL flag

Inherits the MW disc's model: on in dark mode, hidden in chart mode,
opacity tracks the same fade curve so the two layers reveal in lockstep
as the camera pulls away from Sol. `FADE_INNER_PC` (500 pc) and
`FADE_OUTER_PC` (5 kpc) live in the shared `galactic-fade.ts` module —
hoisted there at the second usage, not the third.

The layer has no *dedicated* checkbox, but it IS part of the declutter
cycle (`../scene/README.md`): the wireframes are `lgWireframes` (floor
`representational`) and the per-object + Milky Way labels are
`lgObjectLabels` / `mwLabel` (floor `all`). Below those detail levels the
respective element is hidden — the wireframe via the warp-gated update's
detail check, the labels via `detailPermits(...)` in their visibility
predicate.

Chart mode hides the layer entirely. Chart-mode's paper-aesthetic
treatment for galactic structure is `stellata-m40`'s remit; this layer
turns off cleanly until that lands.

## Runtime layer

`local-group-loader.ts` fetches `public/local-group.json` (format
version 2). Each object carries a frozen Stellata ID (`sid`,
docs/sid.md § 7); the loader rejects the artifact (warn + null) when
the version mismatches or any sid is missing or duplicated — a stale
or pre-stamp `local-group.json` needs `pnpm run build:local-group`.
When the artifact loads, `main.ts` attaches the `lg` SID domain over
it (see `../util/sid-resolver/README.md`).

Each object also carries an `emission` block — the solved luminosity
model (per-family profile params + density0; `docs/science-local-group.md`
§ Local Group luminosity model, solver contract in
`scripts/local-group/README.md`).
The wireframe layer ignores it; it feeds the volumetric emission
renderer. `type` (morphological string) and optional `aliases`
(catalog cross-IDs + common names from `data/local-group/aliases.tsv`)
feed the destination-search rows and the focus card.

LG objects are focusable and warpable: they carry the `'lg'`
`TargetKind` (kind-tagged `'focus'` / `'vector'` bus payloads, the
Target-keyed `flyTo` / `setOrbitTarget` / `warpTo` entry points, and
an `lg` FocusableProviders entry), park at `lgViewingDistancePc`
(2.4 × max semi-axis, the shared `viewingDistanceForExtent` rule), and
ride the URL's universal any-kind focus/to SID refs unchanged.

`local-group.ts` exports `LocalGroupLayer`. Per object:

- **disc**: midplane `LineLoop` plus a thickness pair offset ±c along
  the disc normal. Three rings total.
- **ellipsoid**: three orthogonal meridian `LineLoop`s on the
  principal axes (xy, xz, yz). Reads as an ellipsoid silhouette from
  any angle.

Each ring's vertices are pre-rotated by the object's quaternion and
translated by `centerAbs`, then committed to a single `BufferGeometry`
in absolute ICRS pc. The layer's group is rebased to `-worldOffset`
each frame so the floating origin doesn't drift the outlines. One
shared `LineBasicMaterial` across the whole catalog — per-frame
opacity write hits one slot.

## Emission layer

> **Status:** Live (`LG_EMISSION_SHELVED = false`). The flag survives as
> a kill switch; the filter flag (`showLgEmission`) and URL bit 22 gate
> it the ordinary way. There are no Deep-field emission knobs — see
> § Zero free parameters.

`local-group-emission.ts` renders every object's solved luminosity
model (`emission` block, `docs/science-local-group.md` § Local Group
luminosity model) as
raymarched proxy volumes — the Milky Way's volumetric scheme
(`../milkyway/README.md`) generalised to N instances. Two instanced
unit-sphere passes, one per profile family, compiled from ONE shader
pair (`local-group-emission.{vert,frag}.glsl`; the disc material
defines `FAMILY_DISC`):

Each object decomposes into one or two **components**
(`emissionComponents` in `local-group-emission-pure.ts`): a Sérsic
block is one spheroid; a disc block is a disc plus, for M31, a
separate spheroidal bulge instance in the Sérsic pass (own u ≤ uMax
sphere, spheroid population tint — the two volumes overlap and
additive blending sums them, preserving the solved B/T flux split
while the bulge reads as a bulge from edge-on viewpoints).

- **Sérsic pass** (spheroids + disc bulges) — mesh axes are
  `uMax × R_e`, so the ellipsoidal profile radius is just
  `uMax × |pLocal|`; per-instance `(density0, 1/n, bn, pn)` + `uMax`
  ride instanced attributes into flat varyings.
- **Disc pass** (LMC, M31, M33) — mesh is the `(rEnv, rEnv, zEnv)`
  envelope; density `ρ₀·exp(−R/R_d − |z|/z_d)`.

The camera transforms into each instance's unit-ball frame in the
vertex shader (quaternion conjugate + axis divide); the fragment
shader runs milkyway's exact entry/exit logic — front-face root
clamped ≥ 0 handles camera-inside, BackSide keeps fragments alive from
inside, log-distributed steps to the back-face fragment (32 for
spheroids, 64 for discs — grazing disc rays run tens of kpc against a
~10² pc vertical scale height). Each pixel's in-step sample position
is jittered by a screen-space hash: coherent midpoint sampling of the
thin-disc profile bands on grazing rays, and the jitter trades the
bands for fine noise while preserving the expected column (the CPU
mirror keeps deterministic midpoints).

### Zero free parameters — the emission scale is derived

The layer emits into the scene-wide HDR unit (`../hdr/README.md`
§ Unit), exactly as the Milky Way band does. **The zero point is
derived, not tuned.** The solver normalises `density0` against
zero-point-free flux `F = 10^(−0.4·m_V)`, and
Φ = ∫∫ρ/s² dV = ∫(∫ρ ds) dΩ — so a raymarched column *is* flux per
steradian, and the only conversion left is the solid angle of one
arcsec²:

```
S    = LG_SB_ZERO_POINT − 2.5·log10(column)     // 26.5721 mag/arcsec²
m_px = S − 2.5·log10(Ω_px)
```

Feeding `m_px` back through `L = uExposure · 10^(−0.4·m_px)` collapses to
one scalar gain (`stellataSurfaceBrightnessLuminance`), so the
population tint rides through untouched. `LG_SB_ZERO_POINT` and the
shader's `SB_ZERO_POINT` are pinned against each other in
`local-group-emission.test.ts` — nothing at compile time ties them.

**There is no brightness knob, globally or per object.** `density0` is
solved per object (never scale it here — the flux ratios are physical),
the zero point is a constant of the unit system, and `uExposure` is the
only thing that moves the layer. That is what makes the glow
brightness-comparable to the band and the star field by construction
rather than by knob-matching. It also means the layer holds **no**
star-pipeline uniform: `uLimitMag` / `uSizeSpan` are gone, and
`uSizeSpan` is a footprint-only uniform again (`../filters/README.md`).

**The tint is luma-normalised** (`lumaNormalisedTint`) so it carries hue
only. The shader multiplies the scalar column per channel while the
solver normalised that column against total flux — an un-normalised
tint dims the object by its own relative luminance, which is 0.42 mag
for the disc lavender. Harmless while a global gain absorbed it; a flux
error the moment the unit is physical.

**Sub-pixel proxies expand rather than lose flux.** 120 of the 123
objects subtend under a pixel from most viewpoints, where fragment
coverage quantises and drops the flux the solver guaranteed. The vertex
stage scales axes and profile scale lengths by `k` and `density0` by
`1/k³`, where `k` lifts the projected mesh radius to
`MIN_PROJECTED_RADIUS_PX` (1 CSS px — the same resolution floor
`stellataPointSourcePeak` applies to a star). The triple is flux-exact:
the column picks up `k` from the path and `k⁻³` from the density while
the solid angle picks up `k²`. `k → 1` continuously at the floor, so
there is no cutover and nothing to add hysteresis against. Pixels-per-
radian is derived from `uOmegaPxArcsec2` rather than taking its own
uniform, so the floor and the gain cannot disagree about the viewport.

**Both passes write the statistic attachment**
(`../hdr/statistic/README.md`): an extended source's emission is already
true surface brightness, so its flux and peak channels are the same
quantity. Off-target (`uHdrTarget = 0`) each pass applies the operator
itself, undithered — M31's disc and bulge overlap, and the dither is a
function of `fragCoord` alone, so it would land twice.

**What the intra-object range actually costs.** Bulge centre to disc
envelope spans ~8.7 mag for M31. That fits the operator's range
(`DR_MAG` 7.5) rather than fighting it: at the base epoch and a
50° / 900 px viewport the bulge centre resolves to ~0.68 of full scale,
the disc centre to ~0.11 and the envelope to ~0.003 — a bright core with
a faint oval fading out around 30–40 arcmin, which is what M31 looks
like. The earlier worry that a scalar gain would give "a blown core on
a black disc" does not survive the arithmetic: extended Reinhard plus
the sRGB encode already supply the log compression the old
magnitude-domain gate was hand-rolling.

Instance centres are absolute ICRS in float32 attributes; the vertex
shader subtracts the per-frame `uWorldOffset` (≤ ~0.25 pc cancellation
error at 2 Mpc — invisible at galaxy scale). renderOrder −3 beside the
MW volume; additive, no depth write, `frustumCulled = false` (unit-ball
bounding sphere vs 2 Mpc instance spread).

Visibility: default-on; `?v=` blob bit 22 (`showLgEmission=false`,
zero-byte presence field) disables; chart mode hides the layer
entirely (wireframes carry the chart aesthetic); **stays visible
during warp** — unlike the wireframe overlay, the glow is light, not
reference chrome. No Sol-distance fade for the same reason. Hover /
pick is untouched — the wireframe's visibility-gated pick remains the
only pick path.

`local-group-emission-pure.ts` decomposes emission blocks into
components, packs the instance buffers, and carries a CPU mirror of
the GLSL raymarch (same per-family steps, same density functions —
keep in lockstep; the mirror samples midpoints where the shader
jitters, same expectation).
`local-group-emission-calibration.test.ts` is the epic's acceptance
test: flux integrated over solid angle from mirrored per-ray columns
summed over components (CI has no GPU, so no framebuffer read-back —
same integral, same discretization) matches the physical prediction
to ±0.1 mag across 6 camera positions × 5 objects, far-field pairs
against the catalog 1/d² law and near/inside pairs against a
converged dense march; the worst deviation is pinned (0.017 mag).
**The mirror is colourless** — it integrates the scalar column — so it
agrees with the shader only while the tint is luma-normalised; that is
the invariant the normalisation exists to hold, not a stylistic choice.

That test pins the *integral*. A second block pins the **distribution**,
which is the half a viewer reads: M31's face-on disc central surface
brightness at 21.45 mag/arcsec² against Freeman's 21.65 ± 0.30, the
1.0857 mag-per-scale-length gradient, and R_d / R_e / n / distance
against Courteau et al. 2011. Because the solver fixes total flux while
every structural input is published, the profile has no free parameter
left — those pins are closed-form consequences, not fits. M31 is the
only LG object with photometry detailed enough to check a profile
against, and it generalises because the machinery is shared: two
profile families and one solver serve all 123 objects.

## Label engine

`createMilkyWayLabel` and `createLocalGroupLabels` both use the shared
`distance-gated-label.ts` helper (extracted from the heliopause's
label code earlier in this layer's PR). Each label binds to:

- A per-frame visibility predicate (`visibleLabelIds.has(id)` — a
  shared Set written by the global ranking pass, see below).
- A silhouette-sample generator. The MW label samples **32 points
  around the 15 kpc disc rim** (galactic-disc.ts's
  `MIDPLANE_RADIUS_PC`) — anchoring at the GC bulge center sat the
  label on the small ~3 kpc core instead of the disc edge, so the rim
  ring is the right silhouette curve for the label-engine's
  support-point picker. Per-object dwarf labels use the same
  12 × 5 + 2 = 62 sample grid as the heliopause.
- The same screen-space anchor convention as the heliopause:
  bottom-right at a constant 10 px gap.

### Ranking policy — `computeVisibleLabels`

One universal rule: each frame, rank every candidate (MW + every LG
object) by apparent pixel size on screen and reveal the top N (default
8), with a sub-pixel floor (default 2 px) so we don't label objects
the user can't see. The only exception is the **inside-MW guard**:
when the camera sits inside the disc (`||cam − GC|| <
mwInsideDiscPc`), every label is suppressed (you can't usefully label
extragalactic context while you're inside the galaxy yourself).

Filter order, per candidate:

1. Inside-MW guard fires globally (returns empty).
2. Behind-camera test: candidate's camera-space `z ≥ 0` (Three.js
   conventions; camera looks down `-Z`) → skip.
3. Apparent-size floor: `2·atan(maxAxis / camToObj) × (h_px / fov_rad)
   < minPixelSize` → skip.
4. Viewport-overlap test: project the centroid to viewport coords,
   pad by half pxSize, intersect with the viewport rectangle. Objects
   whose centroid is off-screen but whose disc edge crosses the
   viewport still count (the MW disc at grazing incidence).

The ranking lives in the pure `computeVisibleLabels(candidates,
params)` helper (testable in isolation). A per-frame handler — registered
the first time `createMilkyWayLabel` or `createLocalGroupLabels` is
called — runs `computeVisibleLabels` and writes the result into the
shared `visibleLabelIds` Set; per-label predicates query it.

All three knobs are live-tunable through the **Deep field**
debug-panel section (`local-group-tuning.ts`):

| Knob              | Default     | What it does |
| ----------------- | ----------- | ------------ |
| `topN`            | 8           | Max labels visible at once. |
| `minPixelSize`    | 2.0 px      | Apparent-size floor; sub-pixel candidates can't earn a label. |
| `mwInsideDiscPc`  | 10 kpc      | Camera-to-GC distance below which **every** label is suppressed. 0 disables the guard entirely (label-from-anywhere). |

From the canonical first-load park at Sol (`||cam − GC|| ≈ 8 kpc`),
the inside-MW guard fires → no labels. Zoom out past 10 kpc-from-GC,
the ranking starts; from any extragalactic vantage the MW + the
largest nearby satellites earn labels.

No `label_threshold_pc` column in `overrides.tsv`, no
`DEFAULT_LABEL_THRESHOLD_PC`, no per-class cutoff on M_V — the
apparent-size ranking subsumes all of them.

SVG slots live in `index.html` next to the heliopause label:

```html
<text id="mw-label" class="lg-label">Milky Way</text>
<g id="lg-labels"></g>
```

Per-object `<text id="lg-<slug>-label">` children are minted at runtime
by `createLocalGroupLabels` from the loaded catalog. Display names are
rewritten through `DISPLAY_NAME_OVERRIDES` at build time so LVDB's
`LMC` / `SMC` shortform expands to `Large Magellanic Cloud` /
`Small Magellanic Cloud` in the catalog JSON.

## What's deliberately out of scope

- **Galaxy groups past 2 Mpc** — IC 342 / Maffei groups, Sculptor
  Group, M83 group, etc. Could be a future "broader neighbourhood"
  layer but isn't part of the Local Group brief.
- **M31 / M33 stellar streams + the Sagittarius stream** —
  invisible / stellar-scale, not a wireframe primitive.
- **Star catalogues for LMC/SMC/Sgr stellar populations** — AT-HYG
  depth doesn't reach LMC/SMC reliably; Sgr dSph red giants are
  marginal. See `SCIENCE.md` § Scope principles — Detail gradient.
- **Chart-mode glyphs for Local Group / dSph members** — owned by
  `stellata-m40.4`.
- **Galactic-disc fade-curve rework** — the current 500 pc / 5 kpc
  band reveals both layers in a single coherent step.

## References

- **Pace et al. 2024**, *Local Volume Database*, Open Journal of
  Astrophysics (arXiv:2411.07424). CC0.
  <https://github.com/apace7/local_volume_database>
- **Pietrzyński et al. 2019**, *Nature* 567, 200
  (DOI: 10.1038/s41586-019-0999-4) — LMC distance.
- **van der Marel & Kallivayalil 2014**, *ApJ* 781, 121
  (DOI: 10.1088/0004-637X/781/2/121) — LMC structure.
- **Graczyk et al. 2020**, *ApJ* 904, 13
  (DOI: 10.3847/1538-4357/abbb2b) — SMC distance.
- **Subramanian & Subramaniam 2012**, *ApJ* 744, 128
  (DOI: 10.1088/0004-637X/744/2/128) — SMC structure.
- **Ibata et al. 1995**, *AJ* 110, 632 (DOI: 10.1086/192237) —
  Sagittarius dSph discovery + structure.
- **McConnachie et al. 2018**, *ApJ* 868, 55
  (DOI: 10.3847/1538-4357/aae8e7) — M31 inclined-disc structure from
  the PAndAS survey (i ≈ 77°, PA ≈ 37°).
- **Bonanos et al. 2006**, *ApJ* 652, 313 (DOI: 10.1086/508140) —
  M33 Cepheid distance (840 ± 11 kpc) + disc inclination.
- **McConnachie 2012**, *AJ* 144, 4
  (DOI: 10.1088/0004-6256/144/1/4) — Local Group structural review
  used for the M 32 + NGC 205 override entries.
