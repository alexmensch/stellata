# The B1875 edge set and its decomposition

The Delporte (1930) boundary geometry: parsing the edge records,
decomposing them into the 89 named sky regions, the point lookup and
nearest-edge distance over that decomposition, the per-region label
anchors, and the ICRS polyline resampling the drawn arcs come from.

**Pure geometry, no artifact and no THREE.** The parent folder
(`../README.md`) owns the shipped artifact, the runtime membership
namer, and the chart-mode layer; this folder owns the maths they are
all derived from, and the external checks that corroborate it.

## Files in this area

```
src/client/constellation-boundaries/iau-geometry/
  iau-boundaries-pure.ts          Edge parsing, the cell decomposition
    (+ test)                      (§ Cell decomposition), point lookup,
                                  nearest-edge distance (§ Nearest-edge
                                  distance), the ICRS polyline resampling
                                  (§ ICRS polylines), the per-region label
                                  anchors (§ Label anchors), and
                                  createIauConstellationLookup.
  iau-athyg-agreement.test.ts     Catalogue-wide cross-check against AT-HYG's
                                  editorial con column (§ Agreement).
```

**Use `createIauConstellationLookup(records)`, not the pieces.** It parses,
decomposes, and binds the B1875 rotation, so its `edgeCodeAt` / `keyAt` /
`distanceToNearestEdgeDeg` all take **J2000** positions. The lower-level
`constellationEdgeCodeAt(grid, …)` and
`angularDistanceToNearestEdgeDeg(edges, …)` expect input already at B1875
— handing them a J2000 position resolves to a real constellation, just
the wrong one (`(20, −60)` reads Hydrus instead of Tucana), which is why
the composition lives in one place rather than at each call site.

`createGridConstellationLookup(grid)` is the half that needs no edge set,
which is what lets a browser consumer have membership from the shipped
grid alone — `../README.md` § Runtime membership.

The edge records are read from the committed Stellarium file by
`readIauEdgeRecords` (`../../../../scripts/catalog/parse/constellations.ts`),
a `readFileSync` against `data/`, which is not served: **nothing in the
browser may call it.** Importing this module from a browser file is fine
for the pure geometry; reaching for `readIauEdgeRecords` from one is how
the edge set ends up parsed in the browser from a file that isn't
deployed.

## Label anchors

`buildRegionLabelAnchors` gives each region the **equal-surface-weight
centre of mass** of its own cells — where the chart writes the Latin
name. Each cell is a spherical rectangle in B1875, so its area and its
integral of the unit direction both close in elementary functions: no
sampling, and the vector sum over a region is exactly its centre of
mass.

Two properties make this externally checkable rather than merely
plausible:

- **The areas reproduce the published IAU constellation areas** to three
  decimals (Hydra 1302.844, Virgo 1294.428, Crux 68.447, Serpens 636.928
  across its two parts) and sum to the full sphere,
  `FULL_SPHERE_SQUARE_DEG`. Nothing in the pipeline supplies those
  numbers — the edge set alone determines them, so agreement corroborates
  the decomposition the same way the 89-region count does. Pinned in
  `iau-boundaries-pure.test.ts`; the closure is re-checked at load
  against the shipped areas, which is why they ride the wire.
- **Every anchor is asserted to land inside the region it names**, and
  the walk throws rather than emit one that doesn't. A centre of mass is
  only guaranteed inside a convex region, and this is the exact failure
  the flux-weighted centroid it replaced had: Serpens' label sat in the
  Caput/Cauda gap, which is Ophiuchus (§ Serpens). Keeping SER1/SER2
  split is what keeps the assertion true — a merged Serpens anchor would
  fail it, not slip past it.

What the anchors cost in frame terms — a label tracks the partition, not
its stars — is `../README.md` § Label anchors.

## The edge set

`data/stellarium/stellarium-modern-skyculture.json` carries an `edges`
array of **781** records — 389 meridians (constant RA) and 392
parallels (constant Dec) — at equinox **B1875**, sourced from
pbarbier's `edges_18.txt`. Each names the two constellations it
separates:

```
097:096 M+ 20:08:30 +08:30:00 20:08:30 +15:45:00 DEL AQL
```

**The CON1/CON2 order carries no side convention.** Do not read it as
"A lies west of B" — the labelling below never depends on it.

A parallel arc always runs **eastward** from its first RA to its
second, so a second RA at or below the first wraps through RA 0. Taking
`min`/`max` instead keeps the complementary arc and quietly walls off
most of the sky (11 of the 392 wrap). Both endpoints are stored exactly
as parsed, never as `start + span`: the cell grid keys on exact
equality against them and a reconstructed end differs in the last float
digit, which splinters 236 RA bounds into 259.

## B1875

`B1875_JD` (`../../util/precession.ts`) is 2405889.2586 — **1874 Dec
31.76**, by the Besselian epoch formula, not a Julian-year offset from
J2000. The rotation is the IAU 1976 (Lieske) composition
Rz(−z)·Ry(−θ)·Rz(−ζ).

Two ways to get this wrong, both of which still produce a
plausible-looking sky:

- **θ negated.** Every position lands 2θ ≈ 1.4° off in declination.
  Agreement with AT-HYG collapses to 92.8%.
- **The epoch off by months.** Six months late (1875 Jun 2 instead of
  1874 Dec 31) shifts RA by ~17″ and triples the disagreement count
  from 61 to 149 while every named-star spot check still passes.

The epoch is therefore pinned by the disagreement count, not by spot
checks. See § Agreement and § ρ Aquilae.

## Cell decomposition — the self-validating invariant

`buildConstellationRegions` turns the edge set into named regions:

1. The distinct RA and Dec values across all edges induce a
   **236 × 200** cell grid (236 cyclic RA columns, 199 Dec bounds → 200
   bands closed by ±90).
2. Union adjacent cells no edge separates. A meridian at the shared RA
   walls two columns apart only where it spans the whole Dec band; a
   parallel at the shared Dec walls two bands apart only where it spans
   the whole RA column.
3. Name each region by **intersecting the {CON1, CON2} pairs of every
   edge bounding it**. A set intersection, so it is convention-free.

RA adjacency is cyclic, and that is also what closes the polar caps: no
meridian reaches past ±85°, so every cell in the outermost band
connects around to its neighbours (Octans south, Ursa Minor north). No
special case needed.

The walk yields **exactly 89 regions, each with a distinct name** —
`IAU_REGION_COUNT`. Nothing in the pipeline supplies that number: the
edge pairs alone determine it, and 89 is 88 constellations plus
Serpens' two disjoint parts. So the count matching is a genuine
self-check, and `buildConstellationRegions` **throws** rather than ship
a half-resolved sky. A drift means the source data changed or the cell
walk broke — no lookup table (Roman 1987 / VI/42) is needed or
consulted.

## Serpens

The edge set names `SER1` (Caput) and `SER2` (Cauda) because they are
genuinely disconnected regions. `constellationEdgeCodeAt` returns
whichever one the position is in; `constellationKey` collapses both to
`ser`, the lowercase key `CON_INDEX`
(`scripts/catalog/parse/constellations.ts`) indexes the IAU-88 table
by.

**Membership collapses them; placement must not.** A star in either
half is in Serpens, full stop — that is the IAU answer and what byte 34
carries. But anything *placed* per region keeps the split: the chart
draws two "SERPENS" labels, one per part, because any single point
representing the union lands in the gap between them, which is
Ophiuchus (§ Label anchors).

## ρ Aquilae

ρ Aql / 67 Aql (HIP 99742) is the one designated star whose positional
constellation is **not** its nomenclature constellation: IAU naming
keeps it in Aquila, its position is in **Delphinus**. It crossed the
20h08m30s wall by proper motion — published as 1992.

The margin is 0.381″ past the wall at the catalogue's J2000 position.
That is thin by design and it is a *feature* of the pin: walking the
margin back through the star's own proper motion (55.4 mas/yr in
α·cos δ) dates the crossing to 1993.4, which is independent external
corroboration that the B1875 epoch and the rotation are both right. A
wrong epoch moves the implied date by centuries.

This is why positional membership and the designation's constellation are
carried as separate fields (byte 34 and search-index `dc`). The split
survives, but its AT-HYG-sourced half did not: with the editorial `con` cell
out of the build, ρ Aql has no designation constellation and its aliases do
build against Delphinus today — the one regression the driver swap took
knowingly, pending `stellata-3bsf.11`. See `scripts/catalog/README.md`
§ Search index for the split and
`scripts/catalog/parse/README.md` § Positional constellation membership for
what still supplies `dc`.

## Agreement with AT-HYG

`iau-athyg-agreement.test.ts` walks all **317,174** AT-HYG rows that
carry a `con` cell (Sol is the one row that does not) and compares the
computed assignment against that editorial column:

| | |
| --- | --- |
| Agreement | 99.98% |
| Disagreements | **61**, pinned exactly |
| Of those, carrying a Bayer / Flamsteed designation | 1 — ρ Aql |

Almost all of the other 60 are anonymous rows sitting within an arcsecond
or so of a wall, where an editorial cell has no nomenclature to answer
to. Two carry **GCVS** designations, and they are different cases:

- **CM Ind** is a genuine mover — named for Indus, positionally in
  **Pavo**, the same shape as ρ Aql.
- **LT Vul** is not. It is named for Vulpecula and it *sits* in
  Vulpecula; AT-HYG's cell says **Sagitta** and is simply wrong. The
  designation and the boundaries agree with each other against the
  catalogue column, which is why the designation — not the column — is
  the authority for `desigConIndex`
  (`scripts/catalog/parse/README.md` § Positional constellation
  membership).

The CSV has no GCVS column — that cross-match happens later in the build
— so this suite sees neither; `designationConMismatch` in build-counts is
where the designated movers are pinned.

The count is pinned as an exact number rather than a rate because it is
the sharpest signal available on the precession epoch (§ B1875).

**This suite is now the only place the comparison is made.** The build used
to run its own copy over the resolved position — `conPositionalDisagreement`,
63 rather than 61, because the direction cascade moves six anonymous
sub-arcsecond-from-a-wall rows, four across into disagreement and two back
out. That count retired with the `con` cell when the record build moved onto
the inherited spine (`scripts/catalog/spine/README.md`). This suite is
unaffected: it reads the CSV directly, on AT-HYG's printed ra/dec, which is
what isolates the epoch and the decomposition from the cascade.

The CSV rides LFS, so the suite self-skips in the bare CI `test` job and
runs smudged in **`tier-a-corpus`**, which names the file explicitly.
A `describe.skipIf` suite that no job names runs nowhere: check
`.github/workflows/test.yml` when adding another.

AT-HYG shares no input with the edge set, so this is external
validation of both the epoch and the decomposition. It is also why the
positional assignment can replace the editorial column outright:
AT-HYG's `con` covers only its own rows, while this covers every
position, including the uncatalogued fill tier.

## Nearest-edge distance

`angularDistanceToNearestEdgeDeg` gives the angular distance from a
B1875 position to the closest boundary arc, measured across the sphere:

- **Meridian** — a constant-RA great circle. The perpendicular foot does
  **not** keep the point's own declination: it sits at
  `atan2(sin δ, cos δ·cos Δα)`, which leaves ±90° once the point is more
  than a quarter turn away in RA. Past that the foot is on the
  *antimeridian* half of the circle, off the arc, so the branch is gated
  on the **foot's** declination, never the point's. With the foot inside
  the span the distance is the point's angle out of the circle's plane
  (a 1° RA offset at dec 80 is 0.17° of sky); otherwise the nearer of the
  two endpoints wins. Gating on the point's declination instead reports
  0° for a wall 20° away and under-reports by up to 4.6° over the real
  edge set — pinned by exact per-star values, since a range check passes
  either way.
- **Parallel** — a constant-Dec small circle, so the shortest path runs
  along the point's own meridian and an in-span point is |Δdec| away;
  out of span, the nearer endpoint again. No antimeridian trap here: the
  arc parameter *is* RA, so the in-span test and the nearest point agree.

This feeds the fade window for drawing the boundaries. A boundary is a
Sol-frame projection, so the offset at which a star reads as being in
the *wrong* cell is `(distance to its wall + tolerance) × its distance
from Sol` — sub-parsec for the naked-eye population, which is what
makes the drawn boundaries a Sol-neighbourhood affordance that
self-hides before the first star.

**Cost.** `angularDistanceToNearestEdgeDeg` is a linear scan of all 781
arcs with 2–4 trig calls each — a quarter-billion evaluations over the
full catalogue, which the fade table needs. `createNearestEdgeIndex`
buckets the arcs by declination band and prunes: any point on an arc lies
inside the arc's own declination range, and angular separation is at least
the declination difference, so a band's declination gap from the query is
a valid **lower bound** on every arc bucketed there. Once that gap exceeds
the best distance found so far, no remaining band can improve on it.

That makes the index **exact, not approximate** — the same answer as the
scan, pinned against it across a sphere-wide sampling grid, and the whole
catalogue sweep costs under a second.
`createIauConstellationLookup.distanceToNearestEdgeDeg` routes through it,
so there is no slow path left to pick by mistake; the linear scan stays as
the reference implementation.

## ICRS polylines

`buildBoundaryPolylines` resamples each arc along its own B1875 geometry
and carries every sample to ICRS. **Subdividing is not an optimisation:** a
constant-Dec arc is a SMALL circle, and precession maps it to neither a
straight line nor a great circle, so a two-endpoint parallel draws a chord
cutting over a degree inside the true boundary. Meridians are great
circles and would survive two endpoints; they subdivide anyway for one
code path. The wire format, the quantisation, and the fade table are
`../../../../scripts/catalog/boundaries/README.md`.
