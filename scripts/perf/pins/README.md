# Perf pins — one committed summary per GPU

`<adapter-slug>.json` (schema `stellata-perf/pin-1`) is the whole frame at
the canon vantages on one GPU, taken cold: what every render-path PR diffs
against and re-takes. Operator rules — when a PR must run it, what a mark
means, how the pin advances — are `RELEASING.md` § Perf pin; the code is
`../pin-pure.ts`, the flags `../README.md` § Invocation. Runs stay under
`.perf-runs/` in the main checkout; the pin cites the file it came from.

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
(`quarterMedians`); a monotonic run of their medians wider than
`STATE_GUARD_TREND_MS` (1 ms) end to end reads `trending`: the machine
changed state under the dwell — the sustained-load GPU power step
(stellata-0it.38), entered after roughly 2–2.5 min of continuous frames
and re-entered inside one row when warm. Frames either side of that
transition never compare, so a trending row refuses the pin and refuses a
comparison. `--cooldown-ms` idles between contexts so each one starts
cold; tune it until every context in a pin run reads `steady`.

## Reading `--against-pin`

- **Metric.** The GPU-stream p50 alone — the one continuous whole-frame
  reading the pin holds, reproducing to ~1 % cold. Wall time is quantised
  to the display's refresh interval, so it is recorded and never marked:
  a row with no GPU stream on either side, every WebGL2 row among them,
  reads `·` ungated with its wall p50 shown as context.
- **Band.** The pair's two-sigma standard error, floored at
  `max(PIN_FLOOR_MS 0.5 ms, PIN_FLOOR_FRACTION 3 % × pinned)`. A `✗` is
  past both; `~` is not resolved, never "no change". The 3 % is
  provisional — a floor-only mark is a prompt to re-run rather than a
  verdict (`RELEASING.md` § Perf pin).
- **Ceiling.** A GPU-stream p50 over `PIN_CEILING_MS` (33.4 ms, two 60 Hz
  intervals of hardware time) is `✗` whatever the band says.
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
