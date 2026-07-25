# Deep-space probe trajectories

Heliocentric state vectors for the five **Sun-escape** probes —
Pioneer 10, Pioneer 11, Voyager 1, Voyager 2, New Horizons — from
launch out to 2050, plus each mission's launch / last-contact facts.
One JSON per probe, committed plain text (~450 KB total, no LFS).

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
  velocity), `OUT_UNITS=AU-D`, `CSV_FORMAT=YES`, `STEP_SIZE='30d'`,
  `START_TIME` = the probe's SPK start, `STOP_TIME='2050-01-01'`.
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
  "columns": ["jd", "x", "y", "z", "vx", "vy", "vz"],
  "samples": [[2443392.5, 0.96793185112, …], …]
}
```

`columns` names the row layout; the TypeScript contract is
`ProbeTrajectoryFile` in `scripts/probes/probe-trajectory-schema.ts`,
imported by both the emitter and the runtime loader. One flat array per
sample rather than an object: no repeated keys across ~4,200 rows, and
a refresh still diffs sample-by-sample in git.

- `launchUnixMs` / `lastContactUnixMs` — `Date.parse` output, Unix
  **milliseconds**. The model clock `t` is Unix *seconds*; the runtime
  loader divides. The `Ms` suffix is load-bearing — an undecorated
  `launchUnix` reads as seconds and is off by 1000×.
- `jd` — Julian Date, **TDB**. The runtime's clock is UTC; the offset
  is ~69 s, which at 17 km/s is 1200 km ≈ 8e-6 AU — five orders of
  magnitude below anything visible, so no conversion is applied.
- `x, y, z` — heliocentric position, **AU**, **ICRS equatorial** axes
  (`REF_PLANE=FRAME`). Same axes as `catalog.bin`, so the runtime
  converts AU → pc and adds Sol's position with **no rotation**. This
  is *not* the ecliptic-local frame that
  `src/client/solar-system/ephemerides/` resolves planets in.
- `vx, vy, vz` — velocity, **AU/day**, same axes. Carried so the focus
  card's speed row reads a real velocity rather than finite-differencing
  30-day samples (which is several percent off near launch, where the
  trajectory still curves through the inner system).
- `samples` is ascending in `jd` and starts at the SPK's first epoch —
  which for Voyager 1 is 1977-09-06, *after* its 1977-09-05 launch.
  Runtime visibility gates on the first sample, not `launchUnix`, so
  there is never a `t` at which a probe is visible but its position
  undefined. `launchUtc` is a display fact.
- Rounded to 11 significant digits (~150 m at 200 AU) from Horizons'
  16 — rationale in `scripts/probes/fetch-probe-trajectories.ts`.

Uniform 30-day sampling with linear interpolation is a **visualisation,
not an ephemeris**, and `STEP_SIZE` is a free Horizons parameter — the
spacecraft SPKs are far denser, so this grid is purely a file-size
choice. The cost shows up at the gravity assists: the rendered track
replaces each swing-by with a chord 0.2–0.4 AU long, and its closest
approach to the planet lands 0.003–0.07 AU out (true flyby distances are
0.00003–0.005 AU), so a trail visibly bends *near* rather than *at* the
planet. `src/client/solar-system/probes/probe-encounter-coherence.test.ts`
pins the ~0.5 AU coherence bound that follows; a piecewise grid with dense
encounter windows is the fix, not a better interpolant.

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
