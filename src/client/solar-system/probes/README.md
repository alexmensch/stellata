# Deep-space probes

The five Sun-escape probes — Pioneer 10, Pioneer 11, Voyager 1, Voyager 2,
New Horizons — rendered at their position for the model clock as a
fixed-size marker plus the traversed segment of their trajectory. Data
contract, provenance, and the frame/unit facts live in
`../../../../data/probes/README.md`; the fetch pipeline in
`../../../../scripts/probes/README.md`.

Probes are **physical objects, not annotations**: they render regardless of
which object the camera is focused on, exactly like planet bodies, and their
motion comes wholly from a `t` sampler. Interactivity (focus, search, click,
hover, cards) is not here yet.

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
                                  ProbeFrameSample record the trail layer
                                  and labels both read. See § Marker field.
  probe-path-layer.ts             ProbePathLayer — one open polyline per
                                  probe, launch → position(t). See § Trails.
  probe-labels.ts                 Per-probe SVG labels. See § Labels.
  probe.vert.glsl,
  probe.frag.glsl                 Fixed-pixel-size diamond glyph.
  probe-encounter-coherence.test  Planet-encounter + heliopause-crossing
    .ts                           corpus. See § Coherence, not precision.
```

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
  samples each trajectory once per frame and both the trail layer and the
  label overlay read that record — they never re-sample, so the three can't
  disagree about where a probe is or whether it is drawn.
- **Signal-lost is opacity, not a separate pass.** Past `lastContactT` the
  marker's alpha drops and the label gains a `(signal lost)` suffix; the
  probe keeps moving, because it does.

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
- **Two gates, one job each.** A trail draws only when its probe's marker
  is drawn (a trail with no probe at its end reads as a bug), AND when the
  probe's own heliocentric distance clears the legibility floor at the
  camera's distance to the marker — days after launch the traversed path is
  a fraction of an AU and would be a sub-pixel smudge.
- **Not focus-gated yet — an interim state, not the design.** There is no
  probe focus to gate on until the focus surface lands, so today a trail
  draws whenever its marker does. The end state is the binary-orbit-path rule
  narrowed one step further: a trail renders only while **that probe** is the
  focused object, hidden under every other focus including Sol (Sol is the
  default first-load focus, so a Sol-focus gate would declutter nothing).
  Markers stay unconditional either way — they are physical objects, like
  planet bodies; only the trails gate.

## Labels

`probe-labels.ts` mirrors `../planets/planet-labels.ts` and shares its
`LABEL_OFFSET_PX`, but has **no resolvability gate**: a planet label can
defer to its orbit ring's pixel-gap heuristic, whereas a probe glyph is
fixed-size and carries no name of its own, so a marker without a label is
an unidentifiable dot. Labels show whenever the marker is drawn and the
`probeLabels` declutter floor permits.

## Declutter and chart mode

Three elements in `../../scene/scene-elements.ts`: `probeMarkers`
(`physical`), `probeTrails` (`representational`), `probeLabels` (`all`) —
the same tiering as planet bodies / orbit rings / planet labels. All three
are `never` in **chart mode**: the chart style has its own glyph vocabulary
and there is no probe glyph in it, so both layers hide rather than paint a
realistic-style diamond onto the paper aesthetic.

## Coherence, not precision

`probe-encounter-coherence.test.ts` samples each probe at its known
closest-approach epochs and compares against the production planet
ephemeris, within 0.05 AU. It is a coherence claim: right probe, right
planet, right frame, right units.

**That bound is set by the planet side, not the probe side.** The trajectory
grid holds 1e-5 AU (`../../../../data/probes/README.md` § Sampling), while
`../ephemerides/` sits 0.002–0.043 AU off Horizons across these epochs —
Saturn ~0.025, Uranus ~0.043 — and the corpus's epochs are calendar dates
rather than the true closest-approach instants, worth another ~0.01 AU at
flyby speeds. Tightening past 0.05 AU would therefore be a claim about
`../ephemerides/`, and no re-fetch of the probe data can move it.

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

## Not here yet

Focus / search / click / hover / POI / observe / URL identity, the focus
card's distance-speed-mission rows, and the close-approach glTF model are
separate work; nothing in this folder registers a `Target` kind. Probes are
also exempt from stellar proper motion by construction — they are
heliocentric Sol-frame bodies and all their motion is in the sampler, so
wiring them into the catalog's epoch-advance path would double-count Sol's
own motion.
