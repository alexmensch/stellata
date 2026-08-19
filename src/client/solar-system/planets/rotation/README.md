# Body rotation — poles, prime meridians, texture UVs

Where a body's pole and prime meridian point on the model clock, and how
that composition reaches texture UVs. Consumed by
`../planet-mesh-layer.ts` (mesh orientation) and `../../planet-system.ts`
(the per-body rotation tables); the mesh LOD itself is `../README.md`
§ Planet mesh LOD.

```
src/client/solar-system/planets/rotation/
  rotation-elements-pure.ts       IAU rotation elements per body (pole +
    (+ test)                      prime meridian on the model clock), and
                                  the BodyOrientationModel escape hatch
                                  the linear rows hand off to.
  earth-orientation-pure.ts       Earth's pole and prime meridian from the
    (+ test)                      long-term precession frames + the Earth
                                  rotation angle. See § Earth is not a
                                  linear row.
  texture-orientation.test.ts     Rendered IAU-orientation → texture-UV
                                  chain vs Horizons sub-observer lon/lat
                                  (pole-up, no mirror, prime meridian).
```

## Earth is not a linear row

Every other body is modelled as a uniform rotator with a linearly
precessing pole, which is what the IAU convention's own expressions
assume. Earth is the exception on **both** counts, and each failure is
worth most of a hemisphere at the clock's bounds:

- **Its spin is not uniform in dynamical time.** ΔT *is* the accumulated
  lag of Earth's rotation behind uniform time, and it reaches 20.6 h —
  310° of rotation — at 3000 BC. So the spin runs on the Earth rotation
  angle, which is linear in UT1 by definition, and every other body keeps
  the TT argument (`../../time/README.md` § Timescales).
- **Its prime meridian is not linear in any timescale.** W is measured
  from the node of the equator of date on the ICRS equator, and that node
  precesses non-linearly. `earthSpinDeg` therefore composes W as
  *node→equinox arc* + *Greenwich mean sidereal time*, the first straight
  off the Vondrák precession frames and the second as ERA plus the IAU
  2006 precession-in-right-ascension polynomial.
- **Its pole rate is not linear either.** `poleRaDegPerCty: -0.641` is a
  chord across a 25 772-yr circle of 23.4° radius; over 3000 yr it misses
  by ~10°. The pole comes from `longTermEquatorPole` instead, which
  carries it to within 0.045° of Thuban at 2785 BC.

`EARTH_ROTATION` keeps its published pck linear rows and adds
`orientationModel`; `poleRaDecDegAt` / `spinDegAt` read the model when
present, so no call site changes. The rows stay as the near-J2000
reference the model is checked against — **don't delete them, and don't
"fix" the model to reproduce them away from J2000.**

**Comparing W alone against the pck row will mislead you near J2000.**
Earth's pole sits on the ICRS pole there, so α0 = atan2(y, x) is
degenerate — it can return anything, and W absorbs exactly the same
offset. Only α0 + W is well-defined, which is all the composition
`Rz(90+α0)·Rx(90−δ0)·Rz(W)` uses there, because `Rx(90−δ0)` → identity.
On that basis the model and the published row agree to 0.31°.

`earth-orientation.test.ts` pins the whole chain against frozen Horizons
sub-solar lon/lat at 18 epochs spanning the clamp: **0.076° worst case,
8.4 km at the equator**, retarding the spin by one light time to match
Horizons' apparent-quantity convention.

`rotation-elements-pure.ts` carries per-body IAU rotation elements —
pole RA/Dec (ICRS) + linear century rates, and prime-meridian angle
`W(t) = W0 + Ẇ·d` — the main linear terms from the IAU WG on
Cartographic Coordinates and Rotational Elements 2015 report
(Archinal et al. 2018), as distributed in NAIF `pck00011.tpc`, plus the
periodic terms above the visibility bar (§ Librations). Mars is the one
body whose linear row is incomplete WITHOUT its ~71-kyr slow terms
(1.55° of pole Dec, 0.58° of W): those linearise cleanly at J2000 and are
folded into its linear row instead (see the MARS_ROTATION comment). The
argument is TT via `tToJdTdb`; Earth alone leaves this whole scheme
behind (§ Earth is not a linear row).
`texture-orientation.test.ts` pins the whole orientation → texture-UV
chain (pole-up, no mirror, prime meridian) against frozen JPL
Horizons sub-observer lon/lat for Mars, Ganymede, Io and the Moon
(`../../../../../data/horizons/sub-observer-truth.tsv`).

The mesh layer composes body→ICRS as `Rz(90°+α0)·Rx(90°−δ0)·Rz(W)`
(the IAU convention: body +z = pole, +x = prime meridian, W measured
from the node of the body equator on the ICRS equator), then the
geometry pole tilt (+Y → +z). Driven off `getT()` each frame like
binary orbits, so the scrubber spins planets and the day side tracks
the actual model-time hemisphere. `Planet.rotation` is optional —
bodies without published elements (exoplanets) keep the fallback
pole = host orbital-plane normal with an arbitrary fixed meridian.

`RotationElements.mapCenterLonDeg` is texture metadata riding the
same table: the east longitude at the horizontal centre of the
body's equirect map, added to the spin term so texture features land
on their true longitudes. Planet maps are centred on 0° except
Pluto (PIA11707 is centred on ~180°E — Sputnik Planitia at map
centre); moon maps are centred on 180° except the Moon and Io (0°) —
see `data/textures/README.md` § Artifact contract. Gas-giant and
Venus cloud maps are epoch snapshots of rotating cloud decks, so
their longitude alignment is inherently arbitrary; 0 is used.


## Librations

`RotationElements.terms` carries the periodic nutation/precession terms of
the IAU model — the `NUT_PREC` coefficients of `pck00011.tpc`. Each is one
shared angle `θ = θ₀ + θ̇·T` whose **sine** drives pole RA and the prime
meridian and whose **cosine** drives declination. That mixed phase is the
convention, not a choice: it is what makes the pole trace a small circle
rather than swing along an arc and back.

**The bar is one texture rung.** At the ladder's 8192 top rung a map texel
spans 360/8192 = 0.044° of longitude, so a 0.1° term displaces features by
about two texels and is visible; anything under that is sub-texel and stays
dropped. Io is the near miss — its largest is 0.094°.

**The amplitudes are much larger than "sub-degree librations" suggests**,
and they are not led by the Moon:

| body | leading term | RA | Dec | W | period |
|---|---|---|---|---|---|
| Triton | N1 | −32.35° | +22.55° | +22.25° | 688 yr |
| Mimas | S3 | +13.56° | −1.53° | −13.48° | 0.99 yr |
| Tethys | S4 | +9.66° | −1.09° | −9.60° | 4.98 yr |
| Moon | E1 | −3.88° | +1.54° | +3.56° | 18.6 yr |
| Rhea | S6 | +3.10° | −0.35° | −3.08° | 35.4 yr |
| Europa | J4 | +1.09° | +0.47° | −0.98° | 30.2 yr |
| Callisto | J6 | +0.59° | +0.25° | −0.53° | 560 yr |
| Ganymede | J5 | +0.43° | +0.19° | −0.39° | 137 yr |
| Neptune | N | +0.70° | −0.51° | −0.48° | 688 yr |

Mimas also carries a **−44.85°** prime-meridian term on 71 yr, the largest
single coefficient anywhere in the table. Without these a body is not
slightly off — it is pointed the wrong way.

**What verifies them.** The Moon's three rows in the sub-observer corpus
are the pin, because its sub-Earth point is the one libration a reader can
check by eye. With the terms the rendered map point matches Horizons to
**0.01°**; with them disabled the sub-observer *latitude* misses by up to
**1.53°** — precisely the E1 declination amplitude, ~46 km of lunar
surface. Folding Ganymede's J5 in also took the Galilean longitude budget
from 2.0° to the same 0.3° Mars uses.

Longitude is far less sensitive than latitude here, and that is expected
rather than luck: on a tidally locked body a pole-RA shift rotates the body
about its own pole and the prime-meridian term of the same family largely
cancels it, while the declination term has nothing to cancel against.
