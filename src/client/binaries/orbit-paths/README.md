# src/client/binaries/orbit-paths/ — drawn binary orbits

The render layer that traces the elliptical paths each member of the
focused multi-star system sweeps. Depends one-directionally on the
parent folder's loader, relation cache, Kepler math and focal chain
(`../README.md`); nothing there imports this back.

## Files

- `binary-orbit-path-pure.ts` — `keplerChainRelationIdxs` (which pairs
  draw) + `buildBinaryOrbitRingPoints` (the two-ellipse vertex build),
  no state.
- `binary-orbit-path-layer.ts` — `BinaryOrbitPathLayer`, the three.js
  layer: geometry rebuild on focus change, per-frame barycentre anchor,
  the on-screen-size gate.

## Binary orbit paths

`BinaryOrbitPathLayer` (`binary-orbit-path-layer.ts`) traces the actual
orbital path each member of the **focused** multi-star system sweeps — a
`representational`-tier declutter element (`binaryOrbitRings`,
`../../scene/README.md`), realistic-only. Focus-gated by design:
representational annotations hide on unfocus, so only the focused star's
system draws, never every catalog pair.

- **Which pairs** come from `keplerChainRelationIdxs` = the focal chain
  (`../focal-chain.ts`) filtered to `has_orbit` relations. Visual companions
  (Tier 3, no Kepler elements) are excluded — there is no orbit to draw,
  so a wide optical double shows nothing. The chain is exactly the set
  `BinaryOrbitField` holds LOD-exempt, so both members stay live.
- **Barycentric two-ellipse convention.** Each pair draws two ellipses
  about the common barycentre — the physically honest "actual paths",
  not the primary-fixed apparent-orbit plot. `buildBinaryOrbitRingPoints`
  samples `evaluateOrbitOffsetPc` over one period and splits it `−q` :
  `+(1−q)` (the same mass fraction the orbit walk applies), so the more
  massive member traces the smaller ellipse, the two sit 180° apart, and
  the barycentre lands at each ellipse's focus. The stars sit *on* their
  own paths: the sampled vertex at the live phase equals the walk's
  rendered offset.
- **Anchor.** Ellipse vertices are ICRS pc *offsets* from the
  barycentre (frame-independent), built once per focus change. Per frame
  `update` only repositions each pair's group at its live barycentre
  `(1−q)·primary + q·secondary`, read from the walked `localPositions`
  right after the orbit walk. Hierarchical inner pairs anchor on their
  parent-perturbed slots, so an inner ellipse rides the outer orbit —
  the honest epicyclic decomposition, one ellipse-pair per relation.
- **Tier 2** (`has_orbit`, no measured inclination) draws too: period
  and semi-major axis are real, but the orbit plane is the galactic-Z
  fallback, so the ellipse *orientation* is not physical — size and
  timing are. (`../README.md` § Tier mapping.)
- **Renders in the local depth pass.** The layer's group lives in the
  star cluster's pass group (`../../star-pipeline/local-pass/star-local-cluster.ts`),
  drawn after the member-star disc mirror so the bracket z-buffer hides
  far-side arcs behind a resolved disc and passes near-side arcs over
  it. The line material strips the log-depth chunks
  (`makeOrbitLineMaterial(..., localPass)`); `collectSpheres` reports
  each drawn pair's barycentre + apoapsis extent so the slice bracket
  contains the ellipses. Paths drawing ⇒ the cluster is active, so they
  always render — WebGL2 only; WebGPU parks it until `stellata-0it.27`.
- Geometry rebuilds on focus change (`setSystem`), mirroring
  `OrbitRingsLayer.setPlanetSystem`; the per-frame `update` moves
  barycentre anchors and applies the size gate below. The two loops per
  pair share one alpha-blended material built by `../../util/orbit-line.ts`
  (`makeOrbitLineLoop` / `makeOrbitLineMaterial` + shared
  `ORBIT_LINE_SEGMENTS`) — the same primitive the planet orbit rings use.
- **On-screen-size gate.** `update` hides a pair once its larger ellipse
  subtends less than `PATH_MIN_RADIUS_PX` (`pixelsPerRadian` /
  `angularRadiusPx` from `../../util/orbit-line.ts`), so a distant or zoomed-out
  system stops drawing sub-pixel loops — the analog of the planet rings'
  pixel gate (an absolute per-pair threshold, not `ringVisibility`'s
  neighbour-gap, which degenerates for a lone or equal-mass pair).
- **Focus-ring suppression.** `anyOrbitRingVisible()` (the sibling name
  `OrbitRingsLayer` carries) reports true only while a pair is drawn AND
  above that size gate; `Stellata.anyOrbitRingVisible` ORs it with the
  planet rings, and the focus-ring overlay hides itself when either is up —
  the drawn orbit already marks the focal star, so the ring would read as a
  spurious inner orbital. Zoom out until the paths fall below the gate and
  the focus ring returns (`../../overlays/README.md`).
