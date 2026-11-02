# Local Group artifact — the wire contract

`local-group-schema.ts` — `public/local-group.json`'s schema, the one
statement both sides compile against: the file wrapper (`LocalGroupFile`,
`LOCAL_GROUP_VERSION`), the object row (`LgObjectRow`, plus the `sid` the
emit stamps), its `LgKind` / `LgSource` enums, the emission block
(`LgEmission`, `SersicParams`) and the distance envelope. The build that
writes the file is [`/scripts/local-group/`](/scripts/local-group/README.md);
the loader that decodes it into the viewer's `LgObject` is
`/src/client/local-group/local-group-loader.ts`.

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
