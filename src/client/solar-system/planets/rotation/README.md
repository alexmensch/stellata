# Body rotation — poles, prime meridians, texture UVs

Where a body's pole and prime meridian point on the model clock, and how
that composition reaches texture UVs. Consumed by
`../planet-mesh-layer.ts` (mesh orientation) and `../../planet-system.ts`
(the per-body rotation tables); the mesh LOD itself is `../README.md`
§ Planet mesh LOD.

```
src/client/solar-system/planets/rotation/
  rotation-elements-pure.ts       IAU rotation elements per body (pole +
    (+ test)                      prime meridian on the model clock).
  texture-orientation.test.ts     Rendered IAU-orientation → texture-UV
                                  chain vs Horizons sub-observer lon/lat
                                  (pole-up, no mirror, prime meridian).
```

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
part (Earth's axial precession drifts the pole ~30° across the
model-clock window). `t` is treated as TDB via `tToJDE` — the ~69 s
UTC↔TDB gap is ~0.3° of Earth spin, accepted repo-wide.
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

