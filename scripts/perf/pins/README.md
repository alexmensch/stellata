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

- **Metric.** The GPU-stream p50 where both sides have one (reproduces to
  ~1 % cold); else wall p50.
- **Band.** The pair's two-sigma standard error, floored at
  `max(PIN_FLOOR_MS 0.5 ms, PIN_FLOOR_FRACTION 3 % × pinned)`. A `✗` is
  past both; `~` is not resolved, never "no change".
- **Cadence.** A row pinned on the display cadence marks `✗` the moment it
  leaves it, whatever the GPU stream did; a row that lands on the cadence
  reads `✓`; both clamped and no GPU stream reads `~ still on the cadence`.
- **Ceiling.** A WebGPU wall p50 over `PIN_CEILING_MS` (33.4 ms, two 60 Hz
  intervals) is `✗` whatever the band says.
- **Refusals.** Another adapter slug or a headed run refuses the whole
  comparison; a missing, failed, tainted, resized (> 1 % buffer) or
  trending row refuses that row. A refused comparison is not a pass: the
  run exits 1.

The slug is the chip plus the WebGPU architecture from the adapter probe
(`apple-m4-metal-3`); two machines with the same silicon share a pin, which
is the same rule `--baseline` applies to its adapter string.
