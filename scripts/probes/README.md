# Probe trajectory pipeline

Fetch + sync for the five Sun-escape probes. Data contract, provenance,
frame/unit facts, and the mission-date caveats live in
`data/probes/README.md`; this folder owns the scripts.

- `probe-roster.ts` — the five `ProbeMission` rows: Horizons target id,
  SPK start epoch, launch instant, last contact, focus-card mission
  line. The authoring source for every hand-curated mission fact;
  editing one needs a re-run of `fetch:probes` to reach
  `data/probes/`.
- `probe-trajectory-schema.ts` — `ProbeTrajectoryFile` +
  `PROBE_SAMPLE_COLUMNS`, the wire contract shared by the emitter here
  and the runtime loader in `src/client/solar-system/probes/`.
- `horizons-vectors.ts` (+ test) — pure parser for a Horizons VECTORS
  text response. Re-reads every header field the query pinned
  (`Reference frame`, `Output units`, `Center body name`) and throws on
  a mismatch, so an upstream default change fails the fetch instead of
  silently reframing committed data. Also rejects a missing
  `$$SOE`/`$$EOE` block, a changed column count, a non-finite cell, and
  a non-ascending `jd`.
- `fetch-probe-trajectories.ts` — `pnpm run fetch:probes`. Manual and
  infrequent; **not** in the build chain (`data/README.md` § Frozen
  external data). Writes `data/probes/{id}.json`.
- `sync-probes.ts` (+ `-pure.ts`, test) — mirrors the committed JSONs
  to `public/probes/` (gitignored) via `scripts/util/mirror-to-public.ts`
  on every `pnpm run dev` / `build`, so CI and deploy never touch the
  network. The allowlist predicate keeps this folder's README out of the
  deployed bundle; `tests/bundle-content.test.ts` guards the built tree.
