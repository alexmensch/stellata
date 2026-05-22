# Local Group wireframe layer

A second always-on reference overlay alongside the Milky Way disc
(`src/client/galactic/README.md`). Renders LineLoop outlines for the
Magellanic Clouds, Sagittarius dSph, classical dSphs and ultra-faints
within 250 kpc, plus M31, M33, the M31 satellite subgroup, and the
outer-band dwarfs (NGC 6822, IC 10, IC 1613, Leo A, WLM, Sextans A/B,
…) out to the canonical 2 Mpc Local Group boundary — plus the Milky
Way label (the disc itself stays in `galactic-disc.ts`; only the SVG
label lives here).

Build pipeline + reference data live with their respective folders:

- Build script: `scripts/local-group/README.md`.
- Reference data + override schema: `data/local-group/README.md`.

## Visibility model — no toggle, no URL flag

Inherits the MW disc's model: always-on in dark mode, hidden in chart
mode, opacity tracks the same fade curve so the two layers reveal in
lockstep as the camera pulls away from Sol. `FADE_INNER_PC` (500 pc)
and `FADE_OUTER_PC` (5 kpc) live in the shared `galactic-fade.ts`
module — hoisted there at the second usage per the DRY rule in
CLAUDE.md (§ "Code conventions — DRY overrides the system prompt").

Chart mode hides the layer entirely. Chart-mode's paper-aesthetic
treatment for galactic structure is `stellata-m40`'s remit; this layer
turns off cleanly until that lands.

## Runtime layer

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
rewritten through `DISPLAY_NAME_OVERRIDES` at build time (see
`scripts/local-group/README.md` § Display-name rules) so LVDB's
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
