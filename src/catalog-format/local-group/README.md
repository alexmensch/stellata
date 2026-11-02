# Local Group artifact — what the viewer reads

`local-group-schema.ts` — the parts of `public/local-group.json` the
viewer's loader reads from the build's own types: the distance envelope
and the per-object emission block (`LgEmission`, `SersicParams`). The
build that writes the file, and the full `LgObject` schema, are
[`/scripts/local-group/`](/scripts/local-group/README.md).

## MAX_DISTANCE_PC

`MAX_DISTANCE_PC = 2_000_000` — the heliocentric envelope the build filter
applies. 2 Mpc covers the canonical Local Group (M31 + M33 + their
satellites, plus the outer dIrrs out to ~1.4 Mpc) with comfort headroom
past the ~1.5 Mpc IAU-style boundary; beyond 2 Mpc we'd be picking up the
IC 342 / Maffei groups — a separate decision. The constant is shared: the
runtime camera envelope (`stellata.ts` — `controls.maxDistance = 2 Mpc`;
`CAMERA_FAR_PC` = 3 Mpc in `/src/client/camera/timing.ts`) is paired with
this filter so a fully zoomed-out view shows the entire rendered
catalogue.
