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

The lg kind module (`lg-module.ts`) owns the runtime lifecycle: its
`load` fetches `public/local-group.json` (format version 2) via
`local-group-loader.ts`, and its `attach` constructs the wireframe +
emission layer pair at the kind's roster position. Each object carries
a frozen Stellata ID (`sid`, docs/sid.md § 7); the loader rejects the
artifact (warn + null) when the version mismatches or any sid is
missing or duplicated — a stale or pre-stamp `local-group.json` needs
`pnpm run build:local-group`. The `lg` SID domain is the module's
`sids()` leg, attached by main.ts's roster loop (see
`../util/sid-resolver/README.md`).

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

### Wireframe extent — two isophotes, on purpose

The wireframe and the glow do **not** draw the same surface, and which
one an object gets depends on its family:

- **Disc family (LMC, M31, M33) — the wireframe IS the emission
  envelope.** Derived by `renderedWireframeAxes`
  (`scripts/local-group/README.md`), not hand-entered, so it cannot
  drift. `overrides.tsv`'s `a_pc/b_pc/c_pc` remain the *structural*
  input the emission geometry is built from; they are no longer what
  gets drawn. This exists because the overhang was structural rather
  than incidental: `z_d = c/3` makes the vertical envelope `4·z_d =
  4c/3`, so the glow spilled a third of the disc's thickness past its
  own outline from every edge-on viewpoint, and M31 ran 41 % past it
  radially too (`4·R_d = 21.2 kpc` against a hand-set 15 kpc — which
  also happens to put the new outline at M31's R₂₅).
- **Spheroid family (everything else) — the wireframe stays the
  half-light ellipsoid** (LVDB `rhalf_physical`), and is therefore
  ~4.6× *smaller* than the u₉₉ emission mesh at n = 1. That gap is
  correct and deliberate: light outside a half-light radius is what
  "half-light" means, and matching the two would ring a mostly-empty
  volume at a surface brightness nobody can see, while inflating every
  pick target and label silhouette. Read these rings as a **contour,
  not a containment shell**.

The Milky Way follows the disc rule through the same reasoning —
`../galactic/README.md` imports its ring extents straight from the band's
proxy meshes.

**`axes` is the object's extent everywhere, not just its outline.** The
same field feeds `maxSemiAxisPc` → `lgViewingDistancePc` (park radius and
the focus `dMinFloor`), the label ranking's apparent-size test, and the
pick ellipsoid. So the disc family's new envelope also parks the camera
further out — M31 by 41 %. That is the intended reading: what should stay
invariant is **the whole object fitting on screen**, and the whole object
is now correctly the volume that emits. A disc-family object's `axes`
therefore means a different isophote from a spheroid's, which is the
tradeoff § Wireframe extent is making deliberately.

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

Its own folder and README (`emission/`): the two instanced raymarch
passes, the derived emission scale and its acceptance test, the two
population tints, and the sub-pixel flux floor. Live and unconditional —
`showLgEmission` and URL bit 22 are the only gates.

The wireframe and the glow deliberately draw different surfaces
(§ Wireframe extent), and `emission.color` in `overrides.tsv` is the
per-object override on the family tints.


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

The ranking lives in the pure `computeVisibleLabelsInto(candidates,
params, out)` helper (testable in isolation). A per-frame handler runs it
over the shared `visibleLabelIds` Set; per-label predicates query that Set.

**It allocates nothing per frame, and the shape is what buys that.** The
helper clears and refills the caller's Set rather than returning a new one,
and the survivors go into two module-level parallel arrays used as a
fixed-size top-N by insertion — no `{id, px}` literal per candidate, no
per-frame sort. Ties still break toward the earlier candidate, which is
what the stable sort it replaced did. The buffers are module state, so a
second concurrent caller would need its own; one handler serves every
label family (§ Label engine), which is what makes that safe.

**The pass is ref-counted, not owned by either caller.** MW and the LG
objects compete for the same top-N slots, so one handler serves both:
`createMilkyWayLabel` and `createLocalGroupLabels` each acquire it, the
first acquisition subscribes, and the last release unsubscribes and
clears the verdict. The lg module releases from its scene layer's
`dispose`; the MW label holds for the page's lifetime. Skipping the
release would latch a disposed host's `visibleLabelIds` and silently
hide every label a re-created host mounts.

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
