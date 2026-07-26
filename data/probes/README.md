# Deep-space probe trajectories

Heliocentric state vectors for the five **Sun-escape** probes —
Pioneer 10, Pioneer 11, Voyager 1, Voyager 2, New Horizons — from
launch out to 2050, plus each mission's launch / last-contact facts.
One JSON per probe, committed plain text (~1.2 MB total, no LFS).

Consumed at runtime by `src/client/solar-system/probes/`, which
samples `position(t)` for the probe billboard and its trailing path.
`scripts/probes/sync-probes.ts` mirrors this folder to `public/probes/`
on every `pnpm run dev` / `build`; the allowlist (`sync-probes-pure.ts`)
keeps this README out of the deployed bundle.

Not read at build time — nothing in `pnpm run build` parses these
beyond copying them.

## Roster

Only Sun-escape probes. Non-escaping missions (Cassini, Galileo,
Parker) tangle near the Sun and break the radial-escape visual, so
they are deliberately excluded.

| File | Probe | Launch (UTC) | Last contact | Now (2026) |
|---|---|---|---|---|
| `pioneer10.json` | Pioneer 10 | 1972-03-03 01:49 | 2003-01-23 | ~141 AU, 11.9 km/s |
| `pioneer11.json` | Pioneer 11 | 1973-04-06 02:11 | 1995-09-30 | ~117 AU, 11.1 km/s |
| `voyager1.json` | Voyager 1 | 1977-09-05 12:56 | active | ~171 AU, 16.9 km/s |
| `voyager2.json` | Voyager 2 | 1977-08-20 14:29 | active | ~143 AU, 15.3 km/s |
| `newhorizons.json` | New Horizons | 2006-01-19 19:00 | active | ~65 AU, 13.6 km/s |

## Provenance

- Source: JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`),
  spacecraft SPKs (Voyagers: `refit2022`; New Horizons: `plu060`
  post-encounter reconstruction).
- Retrieved: 2026-07-25. Each file carries its own `source.retrievedUtc`.
- Refresh: `pnpm run fetch:probes` — manual and infrequent, never part
  of `pnpm run build` (`../README.md` § Frozen external data).
- Query shape per probe: `EPHEM_TYPE=VECTORS`, `CENTER='500@10'`
  (Sun centre), `REF_PLANE=FRAME`, `VEC_TABLE='2'` (position +
  velocity), `OUT_UNITS=AU-D`, `CSV_FORMAT=YES`, spanning the probe's
  SPK start to `2050-01-01`. Epochs are requested rather than stepped
  through — see § Sampling.
- Horizons targets: `-23` Pioneer 10, `-24` Pioneer 11, `-31`
  Voyager 1, `-32` Voyager 2, `-98` New Horizons.

`data/horizons/` is a different corpus for a different purpose —
frozen geocentric RA/Dec truth rows for the sky-truth regression
tests. No overlap with this folder.

## Schema

```json
{
  "id": "voyager1",
  "label": "Voyager 1",
  "mission": "Jupiter and Saturn flybys; crossed the heliopause in 2012.",
  "horizonsId": "-31",
  "launchUtc": "1977-09-05T12:56:00Z",
  "launchUnixMs": 242312160000,
  "lastContactUtc": null,
  "lastContactUnixMs": null,
  "source": { "frame": "ICRF", "center": "Sun (10) …", "units": "AU-D",
              "targetBody": "…", "retrievedUtc": "…" },
  "chordToleranceAu": 0.00001,
  "columns": ["jd", "x", "y", "z", "vx", "vy", "vz"],
  "samples": [[2443392.5, 0.96793185112, …], …]
}
```

`columns` names the row layout; the TypeScript contract is
`ProbeTrajectoryFile` in `scripts/probes/probe-trajectory-schema.ts`,
imported by both the emitter and the runtime loader. One flat array per
sample rather than an object: no repeated keys across ~11,200 rows, and
a refresh still diffs sample-by-sample in git.

- `launchUnixMs` / `lastContactUnixMs` — `Date.parse` output, Unix
  **milliseconds**. The model clock `t` is Unix *seconds*; the runtime
  loader divides. The `Ms` suffix is load-bearing — an undecorated
  `launchUnix` reads as seconds and is off by 1000×.
- `jd` — Julian Date, **TDB**. The runtime's clock is UTC, so the loader
  converts through `jdTdbToT` (`src/client/solar-system/time/README.md`
  § Timescales). At 17 km/s the 69 s offset is 1,200 km ≈ 8e-6 AU: below
  anything visible, but no longer below the planet ephemeris it gets
  compared against.
- `x, y, z` — heliocentric position, **AU**, **ICRS equatorial** axes
  (`REF_PLANE=FRAME`). Same axes as `catalog.bin`, so the runtime
  converts AU → pc and adds Sol's position with **no rotation**. This
  is *not* the ecliptic-local frame that
  `src/client/solar-system/ephemerides/` resolves planets in.
- `vx, vy, vz` — velocity, **AU/day**, same axes. Carried so the focus
  card's speed row reads a real velocity rather than finite-differencing
  the samples, and because the fetch pipeline uses the endpoint
  velocities to decide where the grid needs refining.
- `chordToleranceAu` — the accuracy the grid was built to and measured
  against; see § Sampling.
- `samples` is ascending in `jd`, **non-uniformly spaced**, and starts
  at the SPK's first epoch —
  which for Voyager 1 is 1977-09-06, *after* its 1977-09-05 launch.
  Runtime visibility gates on the first sample, not `launchUnix`, so
  there is never a `t` at which a probe is visible but its position
  undefined. `launchUtc` is a display fact.
- Rounded to 11 significant digits (~150 m at 200 AU) from Horizons'
  16 — rationale in `scripts/probes/fetch-probe-trajectories.ts`.

## Sampling

Sample spacing tracks how hard each trajectory is turning rather than a
clock. Every file is built to one guarantee — **linear interpolation
between its samples stays within `chordToleranceAu` (1e-5 AU, 1,496 km)
of the real trajectory** — and the spacing needed to hold that is what
the grid is. How the pipeline finds it is `scripts/probes/README.md`
§ Adaptive grid.

| File | Rows | Size | Finest gap | Coarsest gap |
|---|---|---|---|---|
| `pioneer10.json` | 2,264 | 245 KB | 88 s | 168 d |
| `pioneer11.json` | 3,122 | 343 KB | 88 s | 178 d |
| `voyager1.json` | 1,963 | 214 KB | 88 s | 101 d |
| `voyager2.json` | 2,367 | 260 KB | 88 s | 101 d |
| `newhorizons.json` | 1,514 | 168 KB | 88 s | 101 d |

1,496 km sits under every closest-approach distance the fleet flew —
the tightest being Voyager 2's 4,950 km at Neptune — so a rendered
swing-by bends *at* the planet rather than near it. The previous uniform
30-day grid replaced each swing-by with a chord 0.2–0.4 AU long and
missed by 0.003–0.07 AU.

Two consequences worth knowing before reading a number off this data:

- **The planet ephemeris is no longer the larger error.** It was
  0.002–0.06 AU from Horizons across the encounter epochs; the frozen
  element tables in `data/ephemerides/` brought it to ~5e-6 AU there, at
  parity with this grid. What limits a probe-vs-planet distance now is
  these files: the Voyager SPKs before 1989-Aug-29 are **patched-conic
  mission-design trajectories** rather than reconstructions (each
  Horizons header says so), and the rendered closest approaches sit
  0.2–15% off the published ones as a result.
- **Fourteen SPK discontinuities.** JPL splices cruise and encounter
  solutions, and the seam steps sideways: 88 s of model time carries the
  probe 2e-5 to 1.5e-3 AU (3,000–230,000 km) at Pioneer 10 ×4,
  Pioneer 11 ×7, Voyager 1 ×1 (JD 2444605.5003, at Saturn),
  Voyager 2 ×1, New Horizons ×1. The grid brackets each as tightly as
  the 88 s floor allows; no sampling choice can remove it, and
  `fetch:probes` reports them individually rather than folding them into
  the tolerance.

## Date caveats

Two mission dates differ between sources; both are cited here so a
future refresh does not "correct" them back.

- **Voyager 1 launch.** Adopted 1977-09-05 12:56 UTC (the mission
  record). The Horizons `-31` header's own TIMELINE block says
  `1977-Sep-06 … @ 12:56 UTC`, which cannot be right — its ephemeris
  begins 1977-09-06 00:00, and a spacecraft SPK does not predate
  launch.
- **Pioneer 11 last contact.** Adopted 1995-09-30, when the RTG could
  no longer power any experiment and daily telemetry ceased (the
  Horizons `-24` header states this date). A final degraded contact was
  received in November 1995; the displayed value is the year either way.
- **Voyager 2 heliopause crossing.** The coherence test uses
  2018-11-05 (Gurnett & Kurth 2019). The Horizons `-32` header says
  2018-Nov-15.
