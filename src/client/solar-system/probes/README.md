# Deep-space probes

The five Sun-escape probes — Pioneer 10, Pioneer 11, Voyager 1, Voyager 2,
New Horizons — rendered at their position for the model clock as a
fixed-size marker plus the traversed segment of their trajectory. Data
contract, provenance, and the frame/unit facts live in
`../../../../data/probes/README.md`; the fetch pipeline in
`../../../../scripts/probes/README.md`.

A probe is a real object rendered by a **representation** of one: the
spacecraft subtends no angle at any range, so what draws is a glyph
standing in for it, and the declutter cycle classes markers accordingly
(§ Declutter and chart mode). What the marker inherits from a physical
body is that it is **not focus-gated** — it draws regardless of which
object the camera is focused on, and its motion comes wholly from a `t`
sampler. Only the trail gates on focus.

Probes are full interaction citizens — a third hard focus kind alongside
stars and planets (§ Focus), searchable, hoverable, clickable, pinnable,
and valid observe anchors.

## Files in this area

```
src/client/solar-system/probes/
  probe-trajectory.ts (+ test)    Wire file → typed arrays, plus the pure
                                  sampler: probeStateAt / probeSampleIndexAt
                                  / probeSignalLost / probeLabelText.
                                  See § Sampler.
  probe-loader.ts                 Parallel fetch of the roster's JSONs from
                                  public/probes/. A missing file drops that
                                  probe; it is never an error.
  probe-field.ts                  ProbeField — the instanced marker quads,
                                  the per-frame sampler pass, and the
                                  ProbeFrameSample record every other
                                  consumer reads. See § Marker field.
  probe-path-layer.ts             ProbePathLayer — one open polyline per
                                  probe, launch → position(t). See § Trails.
  probe-path-layer.test.ts        Trail focus gate + the field's
                                  visible-vs-sampled split.
  probe-labels.ts                 Per-probe SVG labels. See § Labels.
  probe.vert.glsl,
  probe.frag.glsl                 Fixed-pixel-size diamond glyph.
  probe-encounter-coherence.test  Planet-encounter + heliopause-crossing
    .ts                           corpus. See § Coherence, not precision.
```

The interaction surfaces live with their subsystems, not here:
`../../camera/focus/` (focus paths + park geometry),
`../../camera/controls/picker.ts` (`pickProbeHit`),
`../../hover/probe-hover-provider.ts`,
`../../focus-card/probe-focus-provider.ts`,
`../../format/probe-format.ts` (the mission-stat formatters both card
tiers share), `../../typeahead/search.ts` (corpus entries), and
`../sol-object-sids.ts` (the frozen SIDs).

## Sampler

`buildProbeTrajectory` converts the wire file's AU / AU-per-day rows into
parsecs and parsecs-per-second once, at load, so nothing downstream carries
a unit conversion. Positions stay **ICRS equatorial** — the same axes as
`catalog.bin` — so a probe's renderer-local position is Sol's local
position plus the sampled offset, with **no ecliptic rotation**. This is
the opposite of `../ephemerides/`, which resolves planets in the ecliptic
and rotates at the caller.

Three contracts the code alone won't tell you:

- **Visibility gates on the first ephemeris sample, never on launch.**
  Voyager 1's SPK starts 1977-09-06, a day after its 1977-09-05 launch, so
  a launch-keyed gate would show a probe whose position is undefined.
  `probeStateAt` returns `false` below the first sample and leaves `out`
  untouched; every consumer treats that as "not in the scene yet".
- **Past the ephemeris end the sampler coasts.** The files stop at 2050 and
  the model clock reaches 3000 AD, so the final sample's stored velocity
  extrapolates linearly. Beyond Neptune that is physically right to well
  inside the coherence budget, and the alternative — clamping — would
  freeze a probe in place while the planets kept moving.
- **`launchUnixMs` / `lastContactUnixMs` are milliseconds.** The model clock
  `t` is Unix *seconds*; the loader divides once and stores `lastContactT`
  in seconds. Nothing downstream should touch the wire fields.

The stored velocity is also why the sampler reports velocity rather than
finite-differencing: sample spacing runs from 88 s to six months
(`../../../../data/probes/README.md` § Sampling), so a difference quotient
would be a different quantity in each part of a trajectory.

## Marker field

A metre-scale spacecraft has no angular diameter to resolve and no
reflected-light magnitude that could cross the slider, so the marker is
deliberately **not** a body: `PROBE_MARKER_PX` is a fixed CSS-pixel size at
every range, drawn as a diamond so it doesn't read as one more star point.
The reflected-light model in `../perceptual-magnitude.ts` is not reachable
from here on purpose.

- **Own instance space.** The domain index IS the instance index — the
  roster is flat and fixed at attach, with no host indirection like
  `PlanetBodyField`'s (host, planet-within-host) mapping.
- **Sol anchor.** Sol is the catalog origin, so its renderer-local position
  is `-worldOffset` — non-zero under any focus other than Sol. `recenter`
  is the only thing that moves it, same as the heliopause shell.
- **One fleet-scale distance cull, not a per-probe one.** The markers hide
  together once `HELIOPAUSE_EXTENT_PC` (the 200 AU downwind apex) stops
  clearing the shared `FEATURE_LEGIBILITY_MIN_PX` floor at the camera's
  distance from Sol — i.e. exactly when the solar system stops reading as a
  structure and the whole fleet collapses toward a point. Anchoring the
  test on the heliosphere rather than each probe's own distance is what
  keeps a *just-launched* probe inside 1 AU visible while the camera is in
  the inner system.
- **`ProbeFrameSample` is the single per-frame evaluation.** The field
  samples each trajectory once per frame and the trail layer, the label
  overlay, the picker, the hover card, and the focus card all read that
  record — nobody re-samples, so none of them can disagree about where a
  probe is, how fast it is going, or whether it is drawn. The card's
  speed row is the sampler's own interpolated velocity for exactly this
  reason; a finite difference across frames would be a different
  quantity in each part of a trajectory (§ Sampler).
- **`resampleAt` is the out-of-frame seed, and focus needs it.** A URL
  restore attaches the roster, jumps the clock, and applies its focus all
  before the first frame runs, and `focusProbe` bails on a false
  `localPositionInto` — so a record only `update` had written would drop
  every shared probe link back to Sol. `attach` seeds at the current `t`
  and `Stellata.setT` reseeds at the new one, which is the same immediate
  fill `PlanetBodyField.attachHost` does. `update` then owns only the
  camera-dependent half (visibility, alpha, the instance buffers).
- **`recenter` rebases every `localPc`, not just Sol's.** `setProbeFocus`
  reads `localPositionInto` immediately after the recentre it triggered;
  samples left in the pre-recentre frame would shift the camera by the
  whole recentre delta. This is what `hostLocalPos` does for the planet
  field.
- **`sampled` and `visible` are different questions, and the split is
  load-bearing.** `sampled` means the trajectory covers this `t`, so a
  position exists; `visible` means the glyph is drawn. `localPositionInto`
  gates on `sampled` alone — focus, the moving-focal ride, and overlay
  projection must keep working while the marker is decluttered,
  chart-hidden, or hidden as the observe anchor, or a focused camera
  would be stranded mid-flythrough the moment the user cycled declutter.
  Draw-predicate consumers (labels, trails, the picker) read
  `sampleFor(...).visible` instead.
- **Signal-lost is opacity, not a separate pass.** Past `lastContactT` the
  marker's alpha drops and the label gains a `(signal lost)` suffix; the
  probe keeps moving, because it does.
- **One observe-hide slot.** `setHiddenInstance` drops the focused
  probe's `visible` while observe parks the camera on it — the marker,
  its label, and its trail all go with it, the planet field's `uHideIdx`
  analogue.

## Trails

`ProbePathLayer` draws the **traversed** segment only — first sample to
`position(t)`, never ahead of the probe. The data runs to 2050 so scrubbing
forward is defined; the trail simply ends wherever `t` puts the probe.

- **Body-plus-tip construction.** Vertices `0…k` are the raw trajectory
  samples and only re-fill when `t` crosses one; vertex `k+1` is rewritten every
  frame from the field's interpolated position. The tip therefore sits
  exactly on the marker at any scrub rate, with no rebuild cadence to tune
  (the orbit rings' sim-day geometry bucket has no analogue here).
  Buffers are allocated at full trajectory capacity once and the drawn
  prefix rides `setDrawRange`.
- **Anchored-line precision.** Master vertices are float64 **Sol-relative**
  and the float32 GPU buffer is baked renderer-local through
  `../../util/orbit-line.ts`'s `bakeAnchoredLineVerts` / `trackAnchoredLine`
  — under planet focus the floating origin sits on the planet and Sol is
  tens of AU away, so Sol-relative float32 vertices would jitter under
  camera motion. Extending the trail forces a rebake; otherwise the
  per-frame drift check owns it.
- **Three gates, one job each.** A trail draws only when **that probe is
  the focused object** (§ Focus gate), AND when its marker is drawn (a
  trail with no probe at its end reads as a bug), AND when the probe's own
  heliocentric distance clears the legibility floor at the camera's
  distance to the marker — days after launch the traversed path is a
  fraction of an AU and would be a sub-pixel smudge.

### Focus gate

A trail renders only while **that probe** is the focused object —
hidden under every other focus **including Sol**. Sol is the default
first-load focus, so a Sol-focus gate would be a near no-op and would
declutter nothing; five trails crossing the system is real line clutter
at planet framings. This is the binary-orbit-path rule narrowed one step
further.

Markers stay unconditional either way — they are physical objects, like
planet bodies; only the trails gate. The declutter element
(`probeTrails`, representational) and the pixel-extent gate both stay;
focus ANDs on top of them.

The layer takes the focused index as an `update` argument rather than
reading focus state itself, so the gate is a pure function of the frame
and `probe-path-layer.test.ts` can pin it without a focus controller.

## Labels

`probe-labels.ts` mirrors `../planets/planet-labels.ts` and shares its
`LABEL_OFFSET_PX`, but has **no resolvability gate**: a planet label can
defer to its orbit ring's pixel-gap heuristic, whereas a probe glyph is
fixed-size and carries no name of its own, so a marker without a label is
an unidentifiable dot. Labels show whenever the marker is drawn and the
`probeLabels` declutter floor permits.

## Declutter and chart mode

Three elements in `../../scene/scene-elements.ts`: `probeMarkers` and
`probeTrails` both `representational`, `probeLabels` `all`.

**Markers are not in the `physical` tier, unlike planet bodies.** That
tier is the naked-eye scene — what an unaided eye at the camera would
actually see — and a metre-scale spacecraft is below it at every range in
the model. The diamond is a representation of an object, not the object,
so it enters with its trail. The consequence to know: one step down the
declutter cycle takes markers, trails, and labels all away, where a
planet body would have survived to the bottom.

All three are `never` in **chart mode**: the chart style has its own
glyph vocabulary and there is no probe glyph in it, so the layers hide
rather than paint a realistic-style diamond onto the paper aesthetic.

## Coherence, not precision

`probe-encounter-coherence.test.ts` samples each probe at its known
closest-approach epochs and compares against the production planet
ephemeris, within 0.011 AU. It is a coherence claim: right probe, right
planet, right frame, right units.

**That bound is now set by the corpus's own epochs, not by either dataset.**
Both sides sit near 1e-5 AU — the trajectory grid
(`../../../../data/probes/README.md` § Sampling) and, since the Horizons
element tables landed, `../ephemerides/` too — but the corpus's epochs are
calendar midnights rather than the true closest-approach instants, and at
flyby speeds the intervening 0–12 h is 0.002–0.010 AU of real motion.
Tightening past 0.011 AU would only pin where midnight falls.

**The corpus's one tie to a real observation** is the other assertion: the
minimum rendered separation over ±2 days, against the closest approach JPL
Horizons itself reports with the spacecraft centred on the planet — which
reproduces each mission's published above-cloud-tops figure to under a
percent. The spacecraft SPKs and the DE441 planetary ephemeris are
independent fits to radio tracking, so agreement there checks both datasets
against reality rather than against each other. Nine of the ten land within
5%; Voyager 2 at Neptune is 15%, which sets the bound, because its SPK
before 1989-Aug-29 is a **patched-conic mission-design trajectory** (the
Horizons `-32` header says so in as many words) and the Neptune pass sits
four days inside that section's end.

Two assertions in the file do pin the probe side, and neither touches the
ephemeris: each grid's finest gap is minutes and its coarsest is months
(no uniform step of any size passes both), and each gravity assist is
resolved finely enough that no single rendered segment turns more than 20°
— the geometric form of "the trail bends at the planet, not near it",
since a uniform 30-day step draws a 50–220° deflection as one chord. New
Horizons' Pluto flyby is the deliberate counterexample: it bent the
trajectory by 0.03° in a month, so the grid stays coarse across it, which
is what shows the spacing follows curvature rather than a list of dates.

The trap the corpus exists to catch: the probe samples are ICRS while the
ephemeris is heliocentric **ecliptic**, so the planet side has to rotate
through the same quaternion `PlanetBodyField` builds for Sol. Skipping it
misses by tens of AU at the outer planets, and one test asserts exactly
that, so the tolerance can never be loosened past the point where the frame
error would slip through.

The heliopause half checks the other end of the trajectory: Voyager 1's and
Voyager 2's measured crossing distances (121.60 AU / 119.02 AU) and
off-nose angles must land back inside the shell's 115–122 AU band, because
those two crossings are what `../heliopause/` derived its geometry from.

## Focus

`probe` is the third **hard** focus kind (`../../camera/focus/README.md`
§ FocusTarget contract): focusing one recentres the floating origin onto
the probe, drops the orbit floor, and makes it a valid observe anchor.
Its `Target` idx is the **loaded-roster index** — a missing artifact
drops that probe from the roster, from the SID domain, and from the
search corpus together, so no index ever shifts under a surviving probe.

### Park distance is set by the near plane, not by the spacecraft

Every other focusable kind solves its park and manual-zoom floor from a
screen-fill fraction of the object's disc. A probe has no disc: the
marker is a fixed-pixel glyph, and the spacecraft's own metre scale
would solve to a park ~1e-17 pc — five orders of magnitude **inside**
`CAMERA_NEAR_PC` (~31 km), where the very marker the camera flew to gets
clipped. `PROBE_ORBIT_FLOOR_PC` / `PROBE_PARK_DIST_PC`
(`../../camera/controls/star-physics.ts`) are therefore fixed distances,
1000 km and 10 000 km, pinned against the near plane in
`../../camera/depth-range.test.ts`.

Both are negligible against the encounter distances the flythrough shows
(Voyager 2 passed Jupiter at 570 000 km), so parking at 10 000 km IS
riding with the probe: the planet geometry from there is the probe's own.
Arrival uses the log-d ease, not the angular-size one — there is no
radius to key on.

### The flythrough

Under focus the camera follows the probe along its **whole** trajectory
as `t` advances, at any fast-forward rate: focus Voyager 2, scrub from
1977, and the camera rides past Jupiter, Saturn, Uranus, Neptune, and out
through the heliopause. That is the kind-generic moving-focal ride in
`../../stellata.ts` (`../../camera/focus/README.md` § Moving-focal ride),
shared with planet focus — a probe needed no ride of its own, only a
provider leg. Sol's planet system stays attached under probe focus, the
same way a planet focus keeps its host's: the orbit rings and planet
labels are what make a flythrough planet pass legible.

## Identity surfaces

Probes join every kind-generic contract without a special case anywhere
in the interaction layer:

- **SID** — `sol:<roster id>`, `kind=probe` in the ledger, pinned
  client-side in `../sol-object-sids.ts` (§ Sol-system SID pins in
  `../README.md`). The URL wire needs no probe-specific work: focus, the
  distance vector, and POIs already carry any-kind SIDs, and unlike the
  planet domain there is no index translation — the resolver's
  localIndex IS the Target idx.
- **Hover** — `pickProbeHit` mirrors the marker draw predicate exactly
  (`visible`), with `PROBE_MARKER_PX` as the hit-radius basis. No
  focus gate on the pick side, unlike the trail (hover Rule 2).
- **Cards** — tier 1 and tier 2 share the mission-stat formatters in
  `../../format/probe-format.ts`, so the two tiers can never print
  different numbers. The heliocentric distance and speed rows are
  labelled **"From Sol"** and are the one deliberate exception to the
  camera-relative card frame: they are intrinsic mission facts, and they
  sit beside a live camera-frame `Distance` row that keeps the
  distinction visible.
- **Search** — one corpus entry per loaded probe, secondary line
  "Probe · Interstellar".

## Not here yet

The close-approach glTF model is separate work. Probes are also exempt
from stellar proper motion by construction — they are heliocentric
Sol-frame bodies and all their motion is in the sampler, so wiring them
into the catalog's epoch-advance path would double-count Sol's own
motion.
