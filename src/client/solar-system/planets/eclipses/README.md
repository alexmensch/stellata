# Eclipse circumstances

Where a shadow axis passes a body, where it meets the surface, and how
deep the immersion is — the quantities the eclipse canons tabulate, read
off the model's own ephemeris, rotation and shadow math.

This is the **event-level** half of the shadow story. `../body-shadow-pure.ts`
is the per-fragment half: how dark one surface point is, mirroring the
mesh shader's caster loop. Both are consumed here.

The folder also owns the two render-path eclipse claims — the whole-body
brightness drop (§ True-eclipse dim, computed in `../planet-body-field.ts`)
and the refracted glow that survives totality (§ Umbral glow).

## Files in this area

```
src/client/solar-system/planets/eclipses/
  eclipse-geometry-pure.ts        Frame- and unit-agnostic vector maths:
    (+ test)                      axis miss distance, the sunward surface
                                  intersection, umbral magnitude through a
                                  converging cone, planetocentric →
                                  planetodetic latitude, and the argMin
                                  bracket the greatest-eclipse search runs.
  eclipse-circumstances.ts        The above driven off getPlanetPositions +
                                  the lunar theory + EARTH_ROTATION:
                                  solarEclipseAt / lunarEclipseAt and the
                                  two greatest-eclipse searches.
  eclipse-canon.test.ts           23 solar and 12 lunar named eclipses from
                                  NASA's Five Millennium Canon, 1978 BC to
                                  2928 AD. See § What is pinned.
  umbral-glow-pure.ts (+ test)    Refracted, reddened sunlight inside a
                                  caster's umbra, and the umbral depth both
                                  render layers measure it at. See § Umbral
                                  glow — this one IS on a render path.
```

**The circumstances modules are not on a render path** — the shader already
draws the shadow, and they exist so the drawn shadow can be checked against
an independent authority, the way `../body-shadow-pure.ts`'s CPU mirror is.
`umbral-glow-pure.ts` is the exception: it is evaluated per body per frame,
by both planet layers. It reads nothing global and holds no state, so the
constraint below is unaffected by it.

**They stay safe to call from one, though, and that is a live
constraint.** `earthMoonAt` reads `getPlanetPositions` and mutates
nothing shared; it must not reach for `resetPositionCache`, which exists
for the element-table swap and drops the entry every other consumer in
that frame is reading (`../../ephemerides/ephemeris.ts`). It did call it
once, which cost nothing only because no render path had imported this
module yet — and cost the greatest-eclipse search its cache regardless.

## What is pinned

`data/eclipse-canon/` freezes Espenak's catalogue rows; the test
reproduces each event end-to-end and asserts:

- the shadow axis reaches Earth at all (γ < 1) at every canon epoch;
- **the renderer's own shadow factor bottoms out at exactly 0** on the
  surface for every total eclipse — the bug this folder was written for
  was that it read 1.000 over the entire sunlit hemisphere;
- eclipse magnitude matches the canon to 0.01, with totals above unity and
  annulars below;
- greatest eclipse lands within **10 s across 1900–2100**, 70 s back to
  600 BC, and 7 minutes over the whole corpus;
- the sub-shadow ground point lands within **70 km in the modern era** and
  200 km over the corpus;
- lunar umbral magnitude matches to 0.04, with the Moon fully inside the
  umbra at every canon total;
- ΔT reproduces the canon's own per-eclipse column to **2 s, absolute** —
  a relative bound cannot tell "reproduces Espenak" from "reproduces
  Espenak minus a systematic 200 s".

The corpus is deliberately central (|γ| < 0.95): a grazing event would
satisfy every assertion above without saying anything about the shadow
landing where it belongs.

## Three conventions that cost real time

**Light time is not negligible here.** The shadow arriving at Earth now
was cast by the Moon one Earth–Moon light time ago — 1.28 s, over which
the Moon covers ~38 km of its ~30 km/s barycentric path. Earth shares
that orbital motion, but the shift does **not** cancel: the shadow axis
is a ray from the *Sun*, so what matters is where the Moon was when it
blocked the light, against where Earth is when the light lands. Each body
is taken at its own correct epoch; the residual is not the 1.3 km of
differential geocentric motion. That is a systematic **+36 s** of
greatest-eclipse timing, and it was the single largest residual against
the canons once the element tables were in. `solarEclipseAt` retards the
Moon; `lunarEclipseAt` retards Earth. The Sun's own retardation is worth
13 m and is skipped.

**The mesh shader deliberately does NOT do this.** It shades from
simultaneous positions, so the drawn shadow sits ~38 km — 0.3 % of Earth's
disc — from the analytic one. Retarding it would mean evaluating each
caster twice per frame, and would draw the Moon 1.3 km from the position
it casts from. Not worth it; recorded here so the two numbers reconciling
is not mistaken for a bug.

**The shadow factor is not the total/annular discriminator.** Its penumbra
term is a `smoothstep`, which eases cubically, so a magnitude-0.99 annular
eclipse still reads 7e-5 at dead centre — indistinguishable from a total.
The physical discriminator is the ratio of apparent diameters, which is
what `SolarEclipse.magnitude` carries.

## Element tables are installed, on purpose

The canon test calls `installPlanetElementTables` in `beforeAll`, because
the app does at runtime and the test should measure the shipped
configuration. It matters: on Standish alone the greatest-eclipse residual
across 1900–2100 is 48 s rather than 9 s, because Standish's ~20″ of
Earth-longitude error is ~38 km of shadow displacement. Outside 1900–2100
the ephemeris falls back to Standish by itself, exactly as it does for a
user scrubbing to 1200 BC.

## Where the remaining error is

At the 2000 BC end the residual is the canon's own vintage, not the
model. Measured at the two worst canon epochs (−1977, −1912): the model's
geocentric Moon sits within 4–20 km of DE441 and its Moon−Sun elongation
within 6″ — about 12 s of eclipse timing — while the canon's
greatest-eclipse instants sit ~325 s of TT away, because the Five
Millennium Canon's ELP2000-85 Moon (tidal acceleration −25.858″/cy²)
drifts that far from DE441 over four millennia. Matching the canon
tighter would mean degrading the model toward the older ephemeris, so
the 200 km / 7-minute corpus bounds are the canon-agreement floor, not
the model's accuracy (`../../ephemerides/README.md`
§ DE441 recalibration has the model-vs-DE441 figures). Earth's
orientation holds 0.076° across the whole clamp, and ΔT itself is known
only to ±hours that far back — the *observed* local circumstances of a
2000 BC eclipse are far less certain than either model's reproduction of
them.

The canon spans −1999 to +3000 and the model clock reaches −2999, so the
first millennium of the clamp carries no independent eclipse authority.
The position and orientation chains underneath it are still pinned there,
against Horizons, by `../../ephemerides/moon-vector-truth.test.ts` and
`../rotation/earth-orientation.test.ts`.

## True-eclipse dim

A planet crossing behind its host's *physical disc* (superior
conjunction inside the host's angular radius) dims by the occluded area
fraction — the same camera-anywhere geometry the binaries eclipse
photometry runs (`../../../binaries/eclipse/eclipse-photometry-pure.ts`:
`eclipseDimFromOffsets` + the shared anti-strobe blend helpers).
`PlanetBodyField.update` evaluates each in-range host's planets per
frame (the pair-relative offset is `iLocalRel` itself — small values, no
large-position differencing) and writes the per-instance `iEclipseDim`
attribute.

A moon composes a second, multiplicative dim: the same lens math from
the MOON's viewpoint with the parent planet as occluder of the host
disc — the visible host fraction IS the moon's illumination, so a
lunar-style eclipse darkens the moon continuously through the
penumbra (search-tested against a year of real ephemeris);
the vertex shader applies it as a flux multiplier on the glare
intensity in both regimes — not an appMag fold, because the
locally-active photographic regime derives brightness from surface
radiance rather than appMag. A FULL eclipse
writes exactly 0 and the shader collapses the quad — a floored +7.5
mag residual is still visible on a mag −1 Mercury, and the planet-
scale depth buffer can't hide it — and the planet's label hides with
it (`../labels/README.md`). **Unless the caster has an atmosphere**: Earth
refracts sunlight into its own umbra, so the dim floors at that glow rather
than 0 and a totally eclipsed Moon stays visible, coppery red, label and all
(§ Umbral glow). Glare through the host's
perceptual *halo* stays undimmed — the halo is a perceptual
artefact, not a surface, so a body behind it correctly shines
through. A planet in *front* (transit) dims the
host by (R_p/R_host)² — negligible and owned by the star pipeline,
so it is deliberately not modelled.

**What schedules the frames that draw it.** The dim's one-pole blend
(`ECLIPSE_DIM_TAU_S`) is the only wall-clock animation in a render layer,
so it has no queryable in-flight flag for the render gate to hold frames
on. It rides the gate's **settle tail** instead — `SETTLE_MS` of frames
after the last activity, item 4 of `../../../render-gate/README.md`
§ The decision, in priority order. Frames are on demand, so without that
tail a dim that begins as the camera goes still would blend across frames
that never render.

## Umbral glow — why a totally eclipsed Moon is red, not black

The shadow factor correctly reaches **zero** inside the umbra, and for an
airless caster that is the whole story. Earth is not airless: it refracts
sunlight into its own shadow, which is why a totally eclipsed Moon glows
coppery red rather than going out. `umbral-glow-pure.ts` is that illuminant.

It is **additive, not a floor on the shadow factor**. The direct beam really
is fully occulted; this is different light, arriving from the caster's
atmosphere. Flooring `shadow` instead would light the body from the wrong
direction and break the canon test's pin that the factor bottoms out at 0.

Three physical terms, and each is load-bearing:

- **Refraction puts light there at all.** A ray grazing the surface and out
  again is bent ~1.16°, which exceeds the 0.68° the Sun's limb sits below
  Earth's at mid-umbra — so refracted light reaches the whole shadow. A ray
  tangent at altitude h bends by `ω₀·exp(−h/H)`, so a point at depth δ is
  reached only from tangent altitudes below `H·ln(ω₀/δ)`. That band shrinks
  inward, which is why the umbra darkens and reddens toward its centre
  instead of being uniform.
- **The limb path makes it red.** The slant column through an exponential
  atmosphere is `sqrt(2πR/H)` ≈ **70×** the vertical one, which turns blue's
  vertical optical depth of 0.221 into 15.6 — extinction by six million —
  while red's 0.049 reaches only 3.5.
- **Ozone makes the outer umbra turquoise.** The Chappuis band peaks near
  600 nm, so on the limb path it removes most of the red and green and
  almost no blue. Near the rim, where the tangent rays are high enough that
  Rayleigh has stopped killing blue, ozone decides — and blue outruns green.
  The airlight model does not carry ozone at all, so its column lives in this
  module (`OZONE_CHAPPUIS_TAU`, 300 DU).

**Aerosol is why the Danjon scale exists.** At h = 0 Mie extinction alone is
τ 9.1 — the everyday fact that you cannot see through 300 km of sea-level
air — so the light reaching the umbra comes from above the muck, and a
volcanic year darkens the eclipse. That falls out of Earth's published `mieCoeff`
rather than being modelled for.

**One scalar is measured rather than derived.** The geometric ring-flux
argument lands ~4× over observation; what it omits is refractive dilution,
which is a hard integral and is not attempted. `UMBRA_DILUTION` stands in for
it, fixed so mid-umbra lands on the measured Danjon L=2 appearance — visual
magnitude ~0.0 against the full Moon's −12.74, a flux ratio of 8.0e-6. It is
achromatic, so it moves brightness and never hue: **the colour stays
derived**, which is the point. Same shape as `uPhaseScale` anchoring the
reflected disc to a measured phase curve.

**Both layers read it.** The mesh takes the depth at the body centre and
spreads it with `1 − shadow`, so a partly-immersed disc is bright on its
uneclipsed limb and red inside; the umbra's own edge-to-centre gradient is
therefore not resolved across the disc, which would need this geometry per
fragment. The glare billboard takes the disc-mean luminance as a **floor on
the eclipse dim**, because a FULL eclipse writes exactly 0 and the vertex
shader collapses the quad — without the floor a totally eclipsed Moon
vanishes at billboard range and takes its label with it.

**A caster with no `atmosphere` row contributes nothing**, which is correct:
Jupiter's shadow on a Galilean really is black to this model, and the giants
deliberately carry no atmosphere row (`../../atmosphere/README.md`).

**Both layers reach the depth through one helper, and the glow gates on it.**
`umbralDepthFromOffsets` takes the body→caster vector and the body→host unit
direction — the offset-scalar shape `eclipseDimFromOffsets` already uses, because
one layer holds these as `Vector3` components and the other as raw
`Float64Array` reads. It answers `-Infinity` where no shadow geometry exists at
all (a caster behind the body casts away from it), and `umbralGlow` returns
early below **penumbral contact**, `depth = -2·hostAngRad`.

That gate is a cost gate, not a physics change: outside the shadow the mesh
weights this by `1 - shadow` and the glare floors a dim of 1 with it, so the
64-sample quadrature was integrated and then discarded on every frame of every
non-eclipse — a body far from the shadow has a hugely negative depth and took
the uncapped-band branch. Putting it inside `umbralGlow` rather than at a call
site is what keeps the two layers from drifting apart on it again.
