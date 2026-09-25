# Local Group layers — wireframes + volumetric emission

Two sibling renderers over one catalog: an always-on reference overlay
rendering ring outlines for the Magellanic Clouds, Sagittarius
dSph, classical dSphs and ultra-faints within 250 kpc, plus M31, M33,
the M31 satellite subgroup, and the outer-band dwarfs (NGC 6822,
IC 10, IC 1613, Leo A, WLM, Sextans A/B, …) out to the canonical 2 Mpc
Local Group boundary — and a volumetric emission layer that makes each
object glow at its physically correct apparent V magnitude from any
camera position ([Emission layer](#emission-layer) below). Also the Milky Way label
(the disc itself lives in `../galactic/`; only the SVG label lives
here).

## Visibility model — no dedicated toggle, no URL flag

Inherits the MW disc's model: on in dark mode, hidden in chart mode,
opacity tracks the same fade curve so the two layers reveal in lockstep
as the camera pulls away from Sol. The curve itself is
`farFieldFadeOpacity` and the band constants `FADE_INNER_PC` (500 pc) /
`FADE_OUTER_PC` (5 kpc) live with it in the shared `galactic-fade.ts`
module — hoisted there at the second usage, not the third, and the base
opacity is its argument so neither layer carries a copy
([Distance fades](../galactic/README.md#distance-fades)).

The layer has no *dedicated* checkbox, but it IS part of the declutter
cycle (`../scene/declutter/README.md`): the wireframes are `lgWireframes` (floor
`representational`) and the per-object + Milky Way labels are
`lgObjectLabels` / `mwLabel` (floor `all`). Below those detail levels the
respective element is hidden — the wireframe via the warp-gated update's
detail check, the labels via `detailPermits(...)` in their visibility
predicate.

Chart mode hides the layer entirely. Chart-mode's paper-aesthetic
treatment for galactic structure is `stellata-m40`'s remit; this layer
turns off cleanly until that lands.

**One registration covers both halves, so the contribution verdict is a
conjunction.** `lg-module.ts` declares
`contribution: { kind: 'gated' }` and skips only when the wireframe's
distance fade has reached zero (`lgWireframeOpacity`, inside
`FADE_INNER_PC` — which is the app's own default view) **and** the glow's
peak is under the display floor ([The brightest rendered pixel](emission/README.md#the-brightest-rendered-pixel)).
The reason reported is the glow's `'brightness'`: the
wireframe is one stroke, and the glow is a whole-frame raymarch plus two
whole-frame attachment writes. Hiding the wireframe group on the way out
also closes its pick, which reads that flag.

## Runtime layer

The lg kind module (`lg-module.ts`) owns the runtime lifecycle: its
`load` fetches `public/local-group.json` (format version 2) via
`local-group-loader.ts`, and its `attach` constructs the wireframe +
emission layer pair at the kind's roster position. Each object carries
a frozen Stellata ID (`sid`, [§ 7](/docs/sid.md#7-storage--sid-in-every-artifact)); the loader rejects the
artifact (warn + null) when the version mismatches or any sid is
missing or duplicated — a stale or pre-stamp `local-group.json` needs
`pnpm run build:local-group`. The `lg` SID domain is the module's
`sids()` leg, attached by main.ts's roster loop (see
`../util/sid-resolver/README.md`).

Each object also carries an `emission` block — the solved luminosity
model (per-family profile params + density0; [Local Group luminosity model](/docs/science-local-group.md#local-group-luminosity-model),
solver contract in
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
  input the emission geometry is built from; they are not what
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
tradeoff [Wireframe extent](#wireframe-extent--two-isophotes-on-purpose) is making deliberately.

`local-group.ts` exports `LocalGroupLayer`. Per object:

- **disc**: a midplane ring plus a thickness pair offset ±c along
  the disc normal. Three rings total.
- **ellipsoid**: three orthogonal meridian rings on the principal axes
  (xy, xz, yz). Reads as an ellipsoid silhouette from any angle.

**The whole catalogue is one draw.** Every object's rings go into a
single `../util/orbit-line.ts` `makeOrbitRingSegments` buffer — one
vertex per ring corner, in `RING_SEGMENTS` blocks, with the index
closing each ring onto its own first vertex. That closure is the whole
correctness surface: an entry short leaves a gap in the outline, and one
that ran on into the next ring's base would draw a spoke between two
objects megaparsecs apart. Both are pinned on the index rather than on
vertex positions.

**The merge is free because the layer holds no per-object render state.**
Vertices are pre-rotated by each object's quaternion and translated by
its `centerAbs` at construction, so the buffer is absolute ICRS pc and
the group's per-frame rebase to `-worldOffset` carries all of it at
once; and one shared stroke from the chrome line seam
(`../chrome-lines/README.md`) already served every ring, so the
per-frame opacity write still hits one slot. Nothing fades, hides or
moves an object on its own — a feature that needed to would have to add
a per-instance attribute rather than split the geometry back up.

At 123 objects the buffer holds 23,616 vertices: 277 KiB of positions
plus a 92 KiB 16-bit index, so 369 KiB against the 324 KiB the per-ring
geometries held — 45 KiB for 368 fewer draw submissions. **The index
width turns on the vertices addressed, never on the entry count**, and
23,616 sits well inside the 65,535 a 16-bit entry reaches; the roster
would have to pass 341 objects before the index widens and the buffer
jumps ~92 KiB. Folding the shared endpoints out instead — the un-indexed
`makeOrbitLineSegments` the constellation figure and boundary arcs take,
whose segments are not uniform closed rings — would cost 554 KiB.

## Emission layer

Its own folder and README (`emission/`): the two instanced raymarch
passes, the derived emission scale and its acceptance test, the two
population tints, and the sub-pixel flux floor. Live and unconditional —
`showLgEmission` and URL bit 22 are the only gates.

The wireframe and the glow deliberately draw different surfaces
([Wireframe extent](#wireframe-extent--two-isophotes-on-purpose)), and `emission.color` in `overrides.tsv` is the
per-object override on the family tints.


## Label engine

`createMilkyWayLabel` and `createLocalGroupLabels` both use the shared
silhouette label engine ([The two label halves](../overlays/README.md#the-two-label-halves)).
Each label binds to:

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

The ranking below decides which labels compete for the screen; the
engine's own occlusion gate (`../occlusion/README.md`) then hides any
whose support point sits behind a near body. The two are independent —
apparent size says a label is worth showing, occlusion says the pixels
under it belong to something nearer.

### Ranking policy — `computeVisibleLabelsInto`

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

The ranking lives in the `computeVisibleLabelsInto(candidates, params,
out)` helper (testable in isolation — it takes every viewing parameter as
an argument, but it is not pure: it ranks through module-level buffers).
A per-frame handler runs it over the shared `visibleLabelIds` Set;
per-label predicates query that Set.

**The pass allocates nothing per frame, and three separate things buy
that.** The helper clears and refills the caller's Set rather than
returning a new one; the survivors go into two module-level parallel
arrays used as a fixed-size top-N by insertion, so there is no
`{id, px}` literal per candidate and no per-frame sort; and the
`RankingParams` object is built once per subscription in
`acquireRankingHandler` and refreshed field by field, rather than
re-created as a literal each frame. Ties still break toward the earlier
candidate, which is what the stable sort it replaced did. The buffers are
module state, so a second concurrent caller would need its own; one
handler serves every label family ([Label engine](#label-engine)), which is what makes
that safe.

Three invariants here are pinned by tests rather than by inspection,
because none of them is visible in a single call's return value: that the
caller's Set is *cleared* and not unioned into (a missed clear latches
labels on permanently), that the survivor buffers leak nothing past
`count` when a later frame ranks fewer objects, and that a tie at the cap
boundary evicts the *later* candidate.

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
by `createLocalGroupLabels` from the loaded catalog — `obj.name` as-is,
with no runtime name resolution. **The proper-name-first ordering every
label reads is settled at build time** ([Display-name rules](/scripts/local-group/README.md#display-name-rules)):
`DISPLAY_NAME_OVERRIDES` expands LVDB's `LMC` /
`SMC` shortform to `Large Magellanic Cloud` / `Small Magellanic Cloud`,
then `aliases.tsv`'s `canonical` column promotes a common name over a
catalogue designation where one exists — M31 labels as "Andromeda
Galaxy", NGC 6822 as "Barnard's Galaxy". The demoted designation stays
in `aliases`, which is also emitted in precedence order and in
conventional written form, one entry per designation ("M31 · NGC 224").

`designationVariants` (`lg-module.ts`) is the one naming rule that runs
at runtime rather than at build time: it re-expands each conventional
Messier form into the spellings a user might type ("M 31", "Messier 31")
as the search corpus is assembled. Those spellings are deliberately
absent from the catalog — storing three spellings of one designation is
what made the focus card's alias row repeat itself.

## What's deliberately out of scope

- **Galaxy groups past 2 Mpc** — IC 342 / Maffei groups, Sculptor
  Group, M83 group, etc. Could be a future "broader neighbourhood"
  layer but isn't part of the Local Group brief.
- **M31 / M33 stellar streams + the Sagittarius stream** —
  invisible / stellar-scale, not a wireframe primitive.
- **Star catalogues for LMC/SMC/Sgr stellar populations** — AT-HYG
  depth doesn't reach LMC/SMC reliably; Sgr dSph red giants are
  marginal. See [Scope principles](/SCIENCE.md#scope-principles) — Detail gradient.
- **Chart-mode glyphs for Local Group / dSph members** — owned by
  `stellata-m40.4`.
- **Galactic-disc fade-curve rework** — the current 500 pc / 5 kpc
  band reveals both layers in a single coherent step.

## References

- [**Pace et al. 2025**](/data/papers/index.md#pace2025) — *Local Volume Database*. CC0.
  <https://github.com/apace7/local_volume_database>
- [**Pietrzyński et al. 2019**](/data/papers/index.md#pietrzynski2019) — LMC distance.
- [**van der Marel & Kallivayalil 2014**](/data/papers/index.md#vandermarel2014) — LMC structure.
- [**Graczyk et al. 2020**](/data/papers/index.md#graczyk2020) — SMC distance.
- [**Subramanian & Subramaniam 2012**](/data/papers/index.md#subramanian2012) — SMC structure.
- [**Ibata et al. 1997**](/data/papers/index.md#ibata1997) —
  Sagittarius dSph structure: prolate 3:1:1, line-of-sight depth.
- [**McConnachie et al. 2018**](/data/papers/index.md#mcconnachie2018) — M31 inclined-disc
  structure from the PAndAS survey (i ≈ 77°, PA ≈ 37°).
- [**Gieren et al. 2013**](/data/papers/index.md#gieren2013) —
  M33 Cepheid distance (µ = 24.62 ± 0.07, 840 ± 27 kpc).
- [**Corbelli et al. 2014**](/data/papers/index.md#corbelli2014) —
  M33 disc orientation (tilted-ring fit) and 1.8 kpc scale length.
- [**McConnachie 2012**](/data/papers/index.md#mcconnachie2012) — Local Group structural
  review used for the M 32 + NGC 205 override entries.
