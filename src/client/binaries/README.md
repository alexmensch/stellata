# src/client/binaries/ — multi-star runtime layer

Runtime support for binary / multiple-star systems. The loader here
parses `public/binaries.bin` (written by
`scripts/binaries/build-runtime-binaries.py`) into a typed record-set
that `BinaryOrbitField` walks per frame to apply orbital motion to
star catalog records.

## Subfolders

- `eclipse/` — the per-frame geometric-occlusion dim on a binary's back
  component. Depends one-directionally on the loader and relation cache
  here; nothing in this folder imports it back.
- `orbit-paths/` — `BinaryOrbitPathLayer`, the drawn two-ellipse orbital
  paths of the focused system. Same one-directional shape as `eclipse/`.

## Files

- `binaries-loader.ts` — parses the v1 `BIN1` format (§ Format contract)
  into a `BinariesData` struct: per-pair Kepler elements + `sep_arcsec` /
  `pa_deg` for the static-placement fallback, plus the index maps
  `primaryIdxToRelations` / `secondaryIdxToRelations`. Both are
  **one-to-many** — a star can be the measured secondary of several
  primaries (α Cru C off both A and B).
- `binary-orbit-pure.ts` — Kepler / Thiele-Innes math, no state. Tier 1
  (`evaluateOrbitSkyAU` + `projectSkyToICRS`) gives the full 3D offset
  including the line-of-sight component, so orbits have real depth from
  any vantage; Tier 2 is the galactic-plane fallback
  (`evaluateOrbitInPlaneAU` + `projectGalacticPlaneToICRS`). See
  § Tier mapping for why the fallback costs only the offset's
  *direction*.
- `orbit-relation-cache.ts` — `keplerRelationParams` (the has_orbit +
  finite-elements gate → tier + elements), the per-attach cache builder
  (`buildOrbitRelationCaches`, which adds the baseline
  `R(sep_pa_epoch_jd)`), and the per-frame
  `evaluateOrbitRelationDeltaPc` dispatch, plus `orbitMemberSlots` — the
  ascending slot set the walk can write, which § Partial re-upload
  diffs. Both runtime fields consume
  it, and so do the hover / focus card formatters
  (`../format/star-companion-format.ts`) — the gate is what stops a card
  advertising Kepler elements for a record the walk refuses to animate.
- `binary-orbit-field.ts` — per-frame position field. `update(t, camera,
  …)` walks `BinariesData.relations` in topological order, applies the
  LOD cascade, and rewrites the active slots of `localPositions` plus
  `compositeSuppress`; `recenter(newOrigin)` updates the cached world
  offset. The static-frame skip, the `markBaselinesDirty()` contract and
  `cadenceReport` each have a section below.
- `focal-chain.ts` — `focalChainRelationSet(binaries, focalIdx)`: the
  relation-index set on a focal star's slot-chain (focal as primary or
  secondary, plus `parentRelation` ancestors). Shared by
  `BinaryOrbitField`'s LOD-exemption walk and the orbit-path layer.
- `binary-system-membership.ts` — the multi-star implementation of the
  kind-generic system-membership contract
  (`../system-membership/README.md`): the star-companion graph walk +
  the orbit walk's live composite-suppress verdict, wrapped as
  `membersOf` / `collapsedClusterOf` for the hover roster card and the
  Picker's collapsed-lead resolution.
- `binary-tuning.ts` — `VISIBILITY_HORIZON_PC`,
  `SUB_PIXEL_THRESHOLD_PX`, `ECLIPSE_DIM_TAU_S` named constants the
  fields read and tests pin.
- `binary-relation-fixture.ts` — `makeRelation` / `makeBinaries`, the
  shared test builders.

`ECLIPSE_DIM_TAU_S` lives in `binary-tuning.ts` rather than `eclipse/`
because the tuning module is the one place every runtime constant this
layer reads is pinned by tests.

## Format contract

The v1 wire format is the single contract between the Python writer
(`scripts/binaries/build-runtime-binaries.py`) and this loader:

- Header (16 B): `BIN1` magic + uint32 version + uint32 count + 4 B
  reserved.
- Record (72 B): see `RECORD_LAYOUT` in `binaries-loader.ts` for the
  per-field byte offsets. Float64 fields land on 8-byte boundaries.
  Trailing 8 bytes are reserved for forward-compat.

Flag bits on each record (`flags` uint32):
- `0x1` has_orbit — every element BinaryOrbitField consumes is finite:
  P, T, e, a, ω, q. (Ω is optional — `relationToElements` falls back
  to 0 when absent; only Tier 1 reads it.) `build-runtime-binaries.py`
  refuses to set this bit when any required element is `None`, so a
  pair surfacing this flag is guaranteed Kepler-evaluable.
- `0x2` has_inclination — inclination i_rad is valid (Tier-1 canonical
  Kepler). When unset, runtime uses the galactic-Z fallback orbit normal
  (Tier 2).
- `0x4` is_inner_of_hierarchy — pair sits inside another pair (Algol
  Aa1,Aa2 inside Aa,Ab). `parentRelation` then points at the outer
  pair's record index.

Records are walked in topological (outer-before-inner) order, so a
single forward pass through `relations` is enough for the runtime to
evaluate parents before children.

## Tier mapping

The runtime layer reads this artifact under three tier rules (set by
the per-pair flags):

- **Tier 1** (`has_orbit & has_inclination`) — full Kepler +
  Thiele-Innes + sky→ICRS projection. The separation
  `(north, east, radial) AU` at time t projects through the system's
  ICRS (α, δ) tangent basis (radial along the Sol→system direction) to
  ICRS Δxyz. R at the stored sep+PA epoch (`sep_pa_epoch_jd`; J2000
  fallback when the record carries none) is cached per relation both as
  the ΔR baseline and — projected to a float64 ICRS pc vector — as
  `baseDiffPc`, so each frame is one Kepler solve + one add. Pure-visual
  ORB6 orbits carry a ±180° ascending-node ambiguity — the radial
  component's SIGN (which member is nearer at conjunction) follows the
  published node's convention, not an observation.

  **Rendered relative offset = R(t), from the elements alone.** Both
  consumers place the pair's relative offset at `baseDiffPc + ΔR(t)` =
  `R(epoch) + (R(t) − R(epoch))` = `R(t)` exactly. It is never a
  subtraction of two float32 catalog slots: that difference carries any
  WDS/Kepler placement disagreement — interferometric quadrant
  ambiguity, or the tangent-only WDS bake's missing radial term — into
  the rendered orbit centre, and float32-quantises to grid noise for
  tight pairs. That was the displaced-centre bug: the companion orbited
  an empty point and could sweep through the primary once per period
  (Alsephina Ab at 0.562 AU vs apoapsis 0.52 AU). The baked catalog
  position is now purely a static record + the LOD fallback (§
  Walk-active LOD). Sub-resolution pairs (WDS ρ 0.000 / unmeasured)
  collocate bit-identically on the primary — a placement choice for the
  fallback, not a runtime signal; they render R(t) around the primary
  like every other pair, no special baseline path.
- **Tier 2** (`has_orbit & !has_inclination`) — Kepler eval with the
  orbit normal forced to the galactic Z axis. The in-plane (x, y) AU
  position rides directly into the galactic XY basis, which
  `GAL_TO_ICRS` then rotates into ICRS Δxyz. Everything except the plane
  is measured: P, T, e, a, ω, q all come off the record, so the period,
  eccentricity and instantaneous separation are real and the cards quote
  them — only the offset's direction is a convention, which is why the
  companion line reads "unknown orbital plane" and not "unknown orbit".
- **Tier 3** (`!has_orbit`) — no per-frame Kepler eval. The companion's
  static placement is already baked into `catalog.bin` by the
  build-time companion-promotion pass (see
  `scripts/catalog/companions/companion-promotion.ts`), so the runtime layer can
  skip these records entirely.

For Tier 1 and Tier 2 the offset is split q : (1−q) between primary
and secondary about the system barycentre — primary moves by
`−q·ΔR(t)`, secondary by `+(1−q)·ΔR(t)`, where q = M_s/(M_p + M_s) is
the mass-fraction stored on each record.

### Composition with proper-motion propagation

The epoch-advance (`loaders/epoch-advance-pure.ts`) shifts
`catalog.positions` by each star's baked space-motion velocity *before*
`BinaryOrbitField` runs, so the pair's systemic drift is already in the
primary slot this field reads. That ordering holds per frame under time
scrubbing too: `maybeReAdvanceEpoch` runs at the top of `animate()`,
rewriting `catalog.positions` + `_localPositions` off the immutable
J2016.0 baseline, and this field's walk then re-perturbs its active
slots on top of the fresh baselines in the same frame. Unfocused, that
slot-reset baseline is reconstructed in float64 off the J2016.0 baseline
+ velocities rather than read from the float32 `catalog.positions`
(§ Walk-active LOD). When a star is focused every relation instead resets
from `catalog.positions`, so the whole scene rides the same absolute the
shell's epoch-follow moves the camera by (`focalPerturbationInto`'s
`bakedDiff` also reads the live `catalog.positions`) — the two cancel and
the focal stays pinned. The systemic-velocity invariant keeps every
`has_orbit` pair's baked diff constant under the advance, so no cache here
is epoch-keyed. (The one deliberate exception: `baseDiffPc`'s ICRS
tangent basis is built from the primary's attach-time direction — stale
by sub-milliarcseconds over the full scrub range, orders below the
elements' own uncertainty.) Because the walk places a Tier-1/2 secondary
at `primary + baseDiffPc + ΔR(t)` from the **elements alone** (never
`abs[s] − abs[p]`), the rendered relative offset is invariant under the
advance regardless of the members' baked velocities — orbital motion stays
owned by this Kepler layer with no double-counting. The velocity coherence
therefore matters only for **Tier-3 static** companions (skipped here): they
ride their baked velocity directly, so a promoted companion with no own PM
inherits its primary's systemic velocity at build time
(`scripts/catalog/companions/companion-promotion.ts`) or it would freeze at `v=0` and
shear from a drifting primary. Full systemic coherence for *every*
binaries.bin pair — keyed on this file's authoritative resolved pairing,
which the catalog build can't replicate — is `stellata-zau1`; until it
lands, the ~950 divergent-velocity Tier-3 wide pairs shear up to tens of
arcminutes at the scrub-range extremes (SCIENCE.md § Current-epoch star
positions).

### Focal-frame ride (no rebase)

The walk applies the barycentric split in EVERY regime — there is no
focal rebase. Focusing a pair member writes byte-identical positions to
being unfocused, so focus→unfocus is a pure state change with no
position discontinuity. Instead of rebasing the focal to the local
origin to match the disc shader's `uPinFocusToCenter`, the **camera
rides the focal star's perturbed position**: the integration shell
(`stellata.ts`, `applyFocalFrameRide`) translates `camera.position` +
`controls.target` (and any in-flight camera-transition pose caches) by
the focal's per-frame orbital drift, so `controls.target` stays glued to
the star and `lookAt(target) == star` keeps the pin substitution valid.

Both rides reach the camera through one `applyRideDelta` helper, which
also hands the delta to the gate and the cadence
(`../render-gate/README.md` § The focal ride).

`focalPerturbationInto(focalIdx, t, out)` supplies that drift in
**float64**: it replays the focal's slot-chain (§ Walk-active LOD) in
double precision and returns the focal's total displacement from its
catalog baseline — matching the walk's float32-written slot within the
position quantum, continuous in `t`. `setFocus` reads it to snap
`controls.target` onto the star's live position; a per-frame delta then
drives the ride. On the frame the focal changes, the ride re-snaps
`controls.target` onto the star's **live `_localPositions` slot** rather
than trusting that focus-entry snap — under fast scrub sim-time advances
between the focus event and the next frame, so the event-time sample goes
stale and would leave the star a fixed offset off-centre. That re-snap
is suppressed in observe mode: there `controls.target` is the
look-direction pin one parsec ahead of the camera (not on the star),
and re-snapping against it would drag the star-parked camera a parsec
off the focal — the cold-load observe URL-restore bug. The pure step
math is `focal-ride-pure.ts:focalRideStep`. CPU consumers (focus ring,
distance vector, HUD shafts, hover picker) read the perturbed
`_localPositions` and project through the same `lookAt(target)` camera,
so they land on the disc without any rebase. The ride is skipped during
warp (the warp owns the camera and tracks the live buffer itself).

**Origin-follow (drift recentre).** The ride translates the camera to
follow the focal, so under fast scrub a far-orbiting focal (a planet
across its orbit; a wide binary) drags the camera tens of AU from the
fixed focus-time origin — reviving the float32 modelview cancellation
the floating origin exists to prevent (a growing wobble on the focal
body). The focal anchor policy
(`../camera/focus/focal-anchor-policy.ts`, applied by
`FloatingOrigin.tick()` each frame) recentres the origin back onto the
look target once camera-from-origin exceeds
`FOCAL_ORIGIN_DRIFT_RATIO × eye distance` (`focal-ride-pure.ts`),
restoring camera-from-origin ≈ eye distance. It is kind-agnostic —
keyed on camera geometry, not the focus kind — so every hard focus
benefits with no per-kind code. The shared origin is the one precision
lever a per-shader pin (`uPinFocusToCenter`) can't generalise; that pin
still handles the separate close-approach-at-origin case (§ focus/README
§ Pin-to-center).

## Walk-active LOD

Each frame the walk first resets every relation's primary + secondary
local slots to their unperturbed systemic baseline (then the passes
below ADD orbital perturbation on top). **Unfocused** that reset is
`(base + v·Δt) − worldOffset` computed in float64 (`writeAdvancedLocal`
off the immutable J2016.0 baseline + velocities), NOT `catalog.positions
− worldOffset`: the float32 absolute ULP is ~0.4 AU at 28 pc, so the
rounded-absolute path snaps a drifting system onto that grid under time
scrub (the reported unfocused-system teleport). **When a star is focused**
every relation resets from `catalog.positions` instead — see § Composition
with proper-motion propagation for why the whole focused scene must ride
the absolute.

Two filters on top of the instrument's visibility bound gate per-frame Kepler
evaluation:

1. Primary's apparent magnitude vs `uThresholdMag + 0.5` — the star
   shader's soft-taper kill condition, mirrored through
   `drawCutoffMag`.
2. Primary's camera distance vs `VISIBILITY_HORIZON_PC` (= 1000 pc).
   Past that the orbit subtends a fraction of a milliarcsecond even
   for wide-separation pairs.

Beyond that, the screen-separation gate fires before Kepler runs:

3. Peak angular separation `a·(1+e)/d_cam_pc · ARCSEC_TO_RAD · pxPerRad`.
   When the worst-case peak is below `SUB_PIXEL_THRESHOLD_PX` (= 1.5 px)
   the relation skips Kepler entirely and sets
   `iCompositeSuppress[secondaryIdx] = 1`. The star shader's existing
   off-screen-sentinel block then collapses the disc (mode 1) and core
   depth-mask (mode 2) passes for that instance; the additive glow
   pass (mode 0) still runs so the two near-coincident point sources
   sum brightness correctly under AdditiveBlending.

   The gate still writes the secondary's slot — it collapses onto the
   primary's CURRENT position plus `baseDiffPc`
   (`local[pBase] + baseDiffPc`), dropping only the orbital `ΔR`. This is
   the SAME anchor the active walk uses, so crossing the gate never steps
   the secondary by `baseDiffPc − bakedDiff` — the drop is just `ΔR`,
   itself sub-pixel by the gate's own test. Anchoring on the baked slot
   diff instead would reintroduce a `baseDiffPc − bakedDiff` snap for the
   pairs whose baked placement disagrees with `R(epoch)` (the very
   population this layer renders elements-alone to avoid). This also
   matters for a **hierarchical inner pair**: the shared primary slot
   already carries the parent pair's `−q_outer·ΔR_outer`, so the inner
   secondary must inherit it. Leaving the secondary at its raw reset
   baseline (as the gate once did) detached it from the parent-perturbed
   primary by `q_outer·ΔR_outer` — an AU-scale, super-pixel snap when the
   tight inner pair crossed the gate on zoom-out (Algol Aa2 at ~60-75 AU).

   Relations on the **focal star's slot-chain** are EXEMPT from ALL
   THREE gates (horizon, magnitude, sub-pixel). The chain is every
   relation that writes the focal's slot — focal as primary or secondary
   — plus their `parentRelation` ancestors (precomputed when `focalIdx`
   changes). Their ΔR feeds the focal-frame ride, so it must stay
   continuous in `t`: a gate firing mid-focus would snap the focal to its
   baseline and jolt the camera (the old hard switch step-jumped the
   partner at a per-system camera distance on zoom-out — ~75 AU for
   Algol's tight pair, ~800 AU for Capella's). A ≤3-relation chain's
   Kepler solves are cheap. Non-chain relations gate freely — they can't
   touch the focal's slot.

**Static-frame skip.** When the previous `update()` evaluated zero
Kepler relations (everything gated out or sub-pixel-suppressed — the
shipping idle state at any wide view), every buffer write is a pure
function of (camera, slider, viewport, fov, focal), so an `update()`
with identical inputs skips the walk itself. It saves the CPU pass only;
what the frame uploads is decided separately (§ Partial re-upload).
Focal-chain relations are always Kepler-active (they bypass the gates
above), so a focused orbit never skips. `recenter()` and
`markBaselinesDirty()` — the latter called by the shell whenever it
rewrites `localPositions` wholesale (epoch re-advance, origin recentre)
— force the next walk, so suppressed secondaries get their `baseDiffPc`
placement re-applied on top of the fresh baselines.

## What the render cadence reads

`cadenceReport(ctx)` prices the pairs the walk animated, off `ΔR`
differenced over the last rendered frame rather than the periapsis peak
the LOD gate holds. `../render-gate/cadence/README.md` owns it.
## Partial re-upload

The walk can only touch the ~6.5k catalog slots that are members of a
Kepler-evaluable relation (`orbitMemberSlots`) — 2% of the rows backing
`iPosition` (~4 MB) and `iCompositeSuppress` (~1.3 MB). Both
attributes flush through a `DirtyItemUploader`
(`../util/attribute-upload.ts`), which diffs those slots against the
previous flush and adds three.js update ranges over the ones whose
float32 bits actually moved. **A frame reproducing the previous values
uploads nothing at all**, so camera motion and a focused binary — neither
of which can satisfy the static-frame skip — no longer re-arm the full
~5 MB. At 1× the walk's Kepler writes are mostly sub-ULP (the median
pair's period is ~48 yr against a ~10⁻⁷ pc position quantum), so what
survives the diff is the handful of short-period pairs and the relations
crossing an LOD gate that frame. Past `MAX_PARTIAL_RANGES` scattered
ranges the whole buffer goes up instead — the fast-scrub regime, where
the data genuinely did move everywhere.

Two rules keep that honest, both because three.js honours a non-empty
range list *over* the full array:

- **A wholesale rewrite must upload in full — `iPosition` only.**
  `markBaselinesDirty()` / `recenter()` mark the next *position* flush
  full: the shell's rewrite reaches every star, not just the member slots
  this uploader tracks, so ranges over the members would strand the rest
  at their old GPU values. The shell's own `onLocalPositionsWritten` goes
  through `uploadFull` for the same reason — it discards ranges a
  previous flush left pending. `iCompositeSuppress` has no writer outside
  this field, so it always flushes partial; forcing it full alongside
  would re-send its ~1.3 MB on every epoch-bucket crossing and recentre,
  which is the fast-scrub regime this exists for.
- **Ranges accumulate until a render consumes them** (the renderer clears
  the list on upload), so a flush appends rather than replacing, and
  falls back to a full upload once the accumulation exceeds the budget.

Camera-epsilon and Kepler-chain-aware variants of the static-frame skip
were considered and rejected: while genuinely navigating, the camera
moves far more than any epsilon that would still keep the LOD gates
honest, so neither reaches the regime this diff covers.

## Hierarchical walk

Inner pairs (Algol Aa1↔Aa2 inside Aa↔Ab) walk after their parent in
topological order. Each relation reads the primary's CURRENT
`localPositions` slot as the anchor — for a hierarchical inner pair
that anchor already carries the parent pair's `−q·ΔR_outer`
perturbation. The secondary slot then takes
`local[pBase] + baseDiffPc + ΔR` so the secondary inherits the SAME
parent perturbation the primary carries; the inner pair's relative
offset stays clean of the parent. (`sCoeff − pCoeff =
1` — one formula, one regime — the barycentric split, with no focal
special-case.)

`focalPerturbationInto` reconstructs a hierarchical focal's float64
displacement the same way: it walks the focal's chain (the writing
relation plus its `parentRelation` ancestors) in topological order,
accumulating `−q·ΔR` onto each primary slot and assigning
`primary + ΔR + (baseDiffPc − bakedDiff)` to each secondary. The trailing
`corr = baseDiffPc − bakedDiff` is the elements-alone anchor shifting the
secondary off its baked placement — for Algol's collocated Aa2 that is
the full `baseDiffPc_inner`. It is the same value the walk writes into
the buffer (the walk anchors the secondary on `baseDiffPc` too), so the
ride tracks the true perturbed position; without `corr` the ride would
leave `controls.target` off a focused secondary of a mismatched pair by
that constant, silently disengaging the pin (§ focus/README).
