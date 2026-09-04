---
name: stellata-perf
description: Take a GPU frame-cost measurement with the human-armed headless perf runner (`pnpm run perf`) — the arm protocol, the flags, how to read a row, where results go. Use when asked to measure, price, baseline or compare render cost, and before stating any perf number in a PR body or a bead.
---

# Measuring frame cost with the perf runner

`pnpm run perf` boots the app in Playwright's full Chromium build, calls the
in-app `debug.priceFrame()` differential at a canon vantage, and prints the
table. Reference: `scripts/perf/README.md`. Interpretation authority:
`docs/render-rules.md` § Measurement canon.

## When

- Pricing a pass or a feature — before and after a renderer-touching change.
- Recording a baseline at the canon vantages.
- Any perf claim in a PR body. An unmeasured perf claim is a hypothesis and
  has to be called one.

## Never

- **Appearance, layout, UX.** The runner reads clocks only — GPU timestamps
  and rAF wall-clock deltas — and never a pixel. Looks are checked by Alex in
  the browser.
- **Starting a dev server.** Alex always has one running; `--url` targets it
  (a worktree server sits on another port).
- **Creating `.perf-go`.** Including `touch .perf-go && pnpm run perf`, which
  the guard denies outright. The guard's deny reason IS the protocol; do not
  work around the hook.

## Protocol — announce → arm → run, one run per arm

1. Say what you want to measure and why, with the exact command you will run.
2. Start `bash scripts/perf/await-go.sh` in the background (Bash
   `run_in_background`). It polls every 15 s for up to an hour and prints one
   line when a fresh marker exists.
3. When it reports ARMED, run the command. The runner deletes the marker
   before launching the browser — one arm authorises one launch, success or
   not. A second run means a second announce.

## Flags

`scripts/perf/README.md` § Invocation is the reference. The shapes:

- `pnpm run perf -- --scenario sol --passes localDepth,reduction --budget-ms 90000`
- `pnpm run perf -- --scenario all --backend webgpu`
- `pnpm run perf -- --mode probe` — adapter strings, timer-query presence and
  the rAF period, no sweep.
- `--headed` for a headed control run. Headed and headless never compare.

## Interpretation traps

`docs/render-rules.md` § Measurement canon and
`src/client/debug/frame-cost/README.md` § Reading a row. The short form: a
`savedMs` under `noiseMs` or `bracketMs` did not resolve; `baselineLimitMag`
and `disabledLimitMag` must agree or the row priced a different scene; never
compare across `method`, `bufferMpx`, headed/headless, browsers, or a dev
server against a production build; never sum the column.

## Recording

Results go to the bead's notes with the path of the saved output, never into
a README. Paste the table and the adapter block, and say which vantage,
backend, method, headless flag and buffer size the run used.
