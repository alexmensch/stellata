# Eclipse circumstances

Where a shadow axis passes a body, where it meets the surface, and how
deep the immersion is — the quantities the eclipse canons tabulate, read
off the model's own ephemeris, rotation and shadow math.

This is the **event-level** half of the shadow story. `../body-shadow-pure.ts`
is the per-fragment half: how dark one surface point is, mirroring the
mesh shader's caster loop. Both are consumed here.

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
```

Nothing here is on a render path — the shader already draws the shadow.
These modules exist so the drawn shadow can be checked against an
independent authority, the same way `../body-shadow-pure.ts`'s CPU mirror
exists to be test-pinned.

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
- ΔT reproduces the canon's own per-eclipse column to 2 %.

The corpus is deliberately central (|γ| < 0.95): a grazing event would
satisfy every assertion above without saying anything about the shadow
landing where it belongs.

## Three conventions that cost real time

**Light time is not negligible here.** The shadow arriving at Earth now
was cast by the Moon one Earth–Moon light time ago — 1.28 s, over which
the Moon moves ~38 km in the inertial frame and Earth does not follow it.
That is a systematic **+36 s** of greatest-eclipse timing, and it was the
single largest residual against the canons once the element tables were
in. `solarEclipseAt` retards the Moon; `lunarEclipseAt` retards Earth.
The Sun's own retardation is worth 13 m and is skipped.

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

At the 2000 BC end the residual is the lunar theory's own along-track
error (`../../ephemerides/README.md` § Mean-longitude recalibration), not
Earth's orientation, which holds 0.076° across the whole clamp. Seven
minutes of dynamical time there is far inside the uncertainty on the real
event: ΔT itself is known only to ±hours that far back, so the *observed*
local circumstances of a 2000 BC eclipse are far less certain than the
model's reproduction of them.

The canon spans −1999 to +3000 and the model clock reaches −2999, so the
first millennium of the clamp carries no independent eclipse authority.
The position and orientation chains underneath it are still pinned there,
against Horizons, by `../../ephemerides/moon-vector-truth.test.ts` and
`../rotation/earth-orientation.test.ts`.
