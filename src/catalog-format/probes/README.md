# Probe trajectories — the wire contract

`data/probes/{id}.json`, mirrored to `public/probes/`: one adaptive-grid
trajectory per Sun-escape probe. The fetch writes it
([`/scripts/probes/`](/scripts/probes/README.md)); the viewer's probe
layer reads it (`/src/client/solar-system/probes/`). Data contract,
provenance and frame/unit facts are `data/probes/README.md`.

- `probe-roster.ts` — the five `ProbeMission` rows: Horizons target id,
  SPK start epoch, launch instant, last contact, focus-card mission
  line. The authoring source for every hand-curated mission fact;
  editing one needs a re-run of `fetch:probes` to reach
  `data/probes/`.
- `probe-trajectory-schema.ts` — `ProbeTrajectoryFile` +
  `PROBE_SAMPLE_COLUMNS`, the wire contract shared by the emitter and the
  runtime loader.
- `sync-probes-pure.ts` (+ test) — `probeTrajectoryFilename` and the
  mirror's allowlist predicate, `isProbePublicAsset`: the public name of
  each trajectory, which the mirror writes and the loader fetches.
