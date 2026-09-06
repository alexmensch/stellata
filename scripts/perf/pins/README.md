# Perf pins — one committed summary per GPU

`<adapter-slug>.json` (schema `stellata-perf/pin-1`) is the whole frame at
the canon vantages on one GPU, taken cold: what every render-path PR diffs
against and re-takes. Operator rules — when a PR must run it, what a mark
means, how the pin advances — are `RELEASING.md` § Perf pin; the code is
`../pin-pure.ts`, the flags `../README.md` § Invocation. Runs stay under
`.perf-runs/` in the main checkout; the pin cites the file it came from by
its path relative to that checkout, since this file ships in a public repo.

## Taking one

`pnpm run perf -- --mode dwell --scenario all --backend both --cooldown-ms 120000
--json <main checkout>/.perf-runs/<date>/pin.json --pin scripts/perf/pins/<slug>.json`

Per `scenario|backend` the pin holds wall p50 / p90 / iqr / n /
vsyncClamped and the GPU-stream p50 where it was sound, plus the
state-guard verdict, buffer, cadence, adapter probe, commit, package version
and the run file. **Any refused row refuses the whole pin** — failed,
tainted, not dwell, not `raf-delta`, trending, a round trip, a headed run —
because a pin missing a row narrows the gate silently.
`--accept <scenario>|<backend>:<bead>` records an accepted mark as
provenance for the value now pinned; it never filters a verdict.

## State guard

Every dwell summary is read in four consecutive quarters
(`quarterMedians`); their medians spanning more than
`STATE_GUARD_TREND_MS` (1 ms) reads `trending`: the machine changed state
under the dwell — the sustained-load GPU power step (stellata-0it.38),
entered after roughly 2–2.5 min of continuous frames and re-entered
inside one row when warm. **The test is the spread, not a rise through
the quarters**: that power step is a step, so it lands as
`[16.9, 16.9, 21.8, 21.8]`, flat and then flat higher, which a
strictly-rising test reads as steady. Frames either side of the
transition never compare, so a trending row refuses the pin and refuses a
comparison. `--cooldown-ms` idles between contexts so each one starts
cold; tune it until every context in a pin run reads `steady`.

## Reading `--against-pin`

- **Metric.** The GPU-stream p50 alone — the one continuous whole-frame
  reading the pin holds. Two cold pins on identical code put four of the
  five canon vantages inside 0.18 %. Wall time is quantised to the
  display's refresh interval, so it is recorded and never marked: a row
  with no GPU stream on either side, every WebGL2 row among them, reads
  `·` ungated with its wall p50 shown as context.
- **Ungated vantages.** `PIN_UNGATED_SCENARIOS` maps a vantage the band
  never marks to the reason, which the row's note prints. `lg` is there
  because it does not reproduce cold-to-cold — 11.891 → 13.360 ms between
  those two pins, a level shift *between* runs while each run's own
  quarters stay flat, so the state guard cannot see it and no cool-down
  suppresses it (stellata-8cg.49.18). Only the *band* stands down: the
  ceiling below still marks the row, and the refusals below still refuse
  it, since a trending or resized lg indicts the run's state rather than
  lg's own reproducibility. **`lg` is the only canon vantage that sees the
  Local Group**, so while it is ungated a `src/client/local-group/` render
  change has no row that prices it short of the ceiling — the gap
  stellata-8cg.49.18 closes.
- **Band.** The pair's two-sigma standard error, floored at
  `max(PIN_FLOOR_MS 0.25 ms, PIN_FLOOR_FRACTION 1 % × pinned)` — about 8×
  the largest cold-to-cold move those four rows showed. A `✗` is past
  both; `~` is not resolved, never "no change". The millisecond term is
  the larger of the two at every canon row but mw50, so it is what sets
  sensitivity in practice.
- **Ceiling.** A GPU-stream p50 over `PIN_CEILING_MS` (33.4 ms, two 60 Hz
  intervals of hardware time) is `✗` whatever the band says — and on an
  ungated vantage too, which is where it earns its keep: those rows have
  nothing else watching them.
- **Refusals.** Another adapter slug or a headed run refuses the whole
  comparison; a missing, failed, tainted, resized (> 1 % buffer) or
  trending row refuses that row. A refused comparison is not a pass:
  either kind exits 1, since a run whose rows were all refused prints a
  table with no `✗` in it.
- **Writing while comparing.** `--pin` alongside `--against-pin` refuses
  to write while any `✗` lacks an `--accept <row>:<bead>`, so an
  unexamined regression cannot quietly become the pinned value.

The slug is the chip plus the WebGPU architecture from the adapter probe
(`apple-m4-metal-3`); two machines with the same silicon share a pin, which
is the same rule `--baseline` applies to its adapter string.
