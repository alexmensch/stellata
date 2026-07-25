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
- `adaptive-grid-pure.ts` (+ test) — epoch arithmetic in integer
  microdays, the two chord-error tests refinement stops on, the
  Douglas–Peucker decimation, and the query planner. See § Adaptive
  grid.
- `horizons-client.ts` — one Horizons VECTORS query per
  `EpochRequest`: URL shape, retry with backoff, pacing, and the
  row-count checks. Owns the two API limits worth knowing — a `TLIST`
  over 80 epochs comes back **truncated with HTTP 200 and no
  diagnostic**, and a `TLIST` at an SPK's last instant is refused
  outright even though a range query stopping there is accepted.
- `fetch-probe-trajectories.ts` — `pnpm run fetch:probes`, optionally
  narrowed to one or more probe ids (`pnpm run fetch:probes voyager1`).
  Manual and infrequent; **not** in the build chain (`data/README.md`
  § Frozen external data). Needs network. Writes
  `data/probes/{id}.json`.
- `sync-probes.ts` (+ `-pure.ts`, test) — mirrors the committed JSONs
  to `public/probes/` (gitignored) via `scripts/util/mirror-to-public.ts`
  on every `pnpm run dev` / `build`, so CI and deploy never touch the
  network. The allowlist predicate keeps this folder's README out of the
  deployed bundle; `tests/bundle-content.test.ts` guards the built tree.

## Adaptive grid

`STEP_SIZE` is a free Horizons parameter and the spacecraft SPKs are far
denser than a day, so sample spacing is entirely our choice. Spending it
uniformly is the wrong trade in both directions at once: a 30-day step
renders a gravity assist as a single 0.2–0.4 AU chord, and the same step
past Neptune is four times finer than a straight line needs.

So the grid is built to a **distance bound instead of a cadence** —
`CHORD_TOLERANCE_AU`, the furthest the runtime's linear interpolation may
sit from the real trajectory. Spacing then falls out of how hard the path
is turning, from 88 s inside a swing-by to six months in interstellar
cruise, and nothing hand-lists which dates are interesting.

Three stages, run per probe:

1. **Seed.** A uniform ~33.55-day grid over the SPK's span. Coarse enough
   to be cheap, fine enough that no assist can hide inside one interval.
2. **Refine.** Bisect every interval, fetch the midpoints, and keep only
   the midpoints that earned their place — those where the measured
   chord error, or the bulge the endpoint velocities predict, breaks the
   tolerance. Each round is one guess, one measurement, one correction;
   the failing set collapses onto the encounters within a few rounds.
   The second test is not redundant: a path that bulges out and back
   recrosses its own chord at the centre, so a midpoint probe alone
   reports it as converged.
3. **Decimate.** Refinement only ever adds samples, so it leaves the seed
   step in place wherever that step was already better than needed.
   Douglas–Peucker over the result drops those, exactly (the deviation
   between two polylines sharing a parameter peaks at a vertex, never
   between).

A final pass then measures the emitted file at the midpoint of every
emitted interval — epochs the grid was never fitted to — so the accuracy
claim is an independent measurement, not a restatement of the stopping
rule.

**Epochs are integer microdays of JD throughout.** That is the finest a
`JD…` time string resolves, and it keeps every bisection exact, so a
requested epoch always round-trips to itself and rows can be matched to
the request by position. Calendar and `JD…` inputs are both read in the
TDB scale the JDTDB column reports, so nothing here converts a timescale.

**Not everything converges, and that is a finding rather than a bug.**
JPL splices its cruise and encounter solutions, and a spliced SPK steps
sideways by tens of thousands of km between one second and the next.
Bisection drives such an interval to the floor and still fails; the run
reports those separately from the tolerance the rest of the grid holds,
because averaging them in would hide a real discontinuity behind a number
that is true everywhere else. `data/probes/README.md` § Sampling lists
the fourteen the fleet currently has.
