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
  `secondary − (1−q)·R(t)`, taking the secondary from the walked
  `localPositions` right after the orbit walk and `R(t)` from
  `BinaryOrbitField.relationOffsetPcInto`. Hierarchical inner pairs anchor
  on their parent-perturbed slots, so an inner ellipse rides the outer
  orbit — the honest epicyclic decomposition, one ellipse-pair per
  relation.

  **The mass-weighted average of the two slots is the wrong formula, and
  it looks like the right one.** `(1−q)·primary + q·secondary` is the
  barycentre only while the primary's slot holds what the relation
  actually placed the secondary against. A hierarchical outer pair shares
  its primary slot with an inner pair that splits it AGAIN, after the
  outer step has already written the secondary — so that average inherits
  an inner wobble the secondary never saw, and the whole ring swings by
  `(1−q_outer)·q_inner·R_inner(t)` on the inner pair's period. On Algol
  that is 0.0115 AU at 2.87 days, against Ab's own ~0.016 AU radius: the
  star visibly hangs off its ring, displaced along the Aa1–Aa2 line.
  Anchoring off the secondary and the walk's own `R(t)` puts the secondary
  on its ellipse by construction, at every depth of hierarchy. The primary
  of an outer pair then reads OFF its own (small) ellipse by exactly its
  inner-pair wobble, which is what an epicycle is.

  A pair whose relation the walk has not evaluated draws nothing that
  frame rather than falling back to a slot-derived guess.
- **Tier 2** (`has_orbit`, no measured inclination) draws too: period
  and semi-major axis are real, but the orbit plane is the galactic-Z
  fallback, so the ellipse *orientation* is not physical — size and
  timing are. (`../README.md` § Tier mapping.)
- **Renders in the local depth pass.** The layer's group lives in the
  star cluster's pass group (`../../star-pipeline/local-pass/star-local-cluster.ts`),
  drawn after the member-star disc mirror so the bracket z-buffer hides
  far-side arcs behind a resolved disc and passes near-side arcs over
  it. The stroke comes from the chrome line seam
  (`../../chrome-lines/README.md`) with its `localPass` flag;
  `collectSpheres` reports each drawn pair's barycentre + apoapsis extent
  so the slice bracket contains the ellipses. Paths drawing ⇒ the cluster
  is active, so they always render, on either backend.

  **The near-side arc IS drawn over the member, and you still cannot see
  it.** The star mirror's additive glow sits at `renderOrder` 3.5 against
  these paths' 3.2 (`../../star-pipeline/local-pass/star-mirror-slots.ts`),
  writes no depth, and is deliberately drawn last so an opaque mesh cannot
  erase it wholesale. So it adds on top of the arc in BOTH the in-front and
  the behind case, and near a resolved bright member it saturates — the two
  cases render identically white. The depth ordering above is correct and
  simply unobservable there. Consequences worth knowing: don't smoke this
  layer's depth by eye against a member disc (the planet orbit rings ride
  the identical mechanism against an unsaturated body, and are where it
  shows), and don't "fix" a report of a missing near-side arc by reordering
  — 3.5 is load-bearing for the glow.
- Geometry rebuilds on focus change (`setSystem`), mirroring
  `OrbitRingsLayer.setPlanetSystem`; the per-frame `update` moves
  barycentre anchors and applies the size gate below. The two loops per
  pair share one stroke and `../../util/orbit-line.ts`'s
  `makeOrbitLineLoop` + shared `ORBIT_LINE_SEGMENTS` — the same primitive
  the planet orbit rings use.
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
