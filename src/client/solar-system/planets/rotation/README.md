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
(Archinal et al. 2018), as distributed in NAIF `pck00011.tpc`. The
periodic nutation/precession terms are dropped, with two caveats:
Mars's pck linear row is incomplete WITHOUT its ~71-kyr slow terms
(1.55° of pole Dec, 0.58° of W) — those are folded into the table as
a J2000 linearisation (see the MARS_ROTATION comment) — and the
dropped short-period librations are not all sub-degree (Moon E1
terms ~3.9°, Europa ~1°, Neptune's ±0.7° pole nod; follow-up bead
filed). The linear pole rates carry the visually meaningful secular
part. Their argument is TT via `tToJdTdb`; Earth alone leaves this whole
scheme behind (§ Earth is not a linear row).
`texture-orientation.test.ts` pins the whole orientation → texture-UV
chain (pole-up, no mirror, prime meridian) against frozen JPL
Horizons sub-observer lon/lat for Mars, Ganymede, and Io
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

