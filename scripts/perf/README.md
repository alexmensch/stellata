# Perf runner — human-armed, Chrome only, clocks only

`pnpm run perf` boots the app in Playwright's full Chromium build, calls the
in-app `debug.priceFrame()` differential (`src/client/debug/frame-cost/`) at
a canon vantage through `page.evaluate`, and prints the table `console.table`
shows in the browser. It reads GPU timestamps and rAF wall-clock deltas and
nothing else — never a screenshot, never a pixel readback — so it is a cost
instrument and is never used for appearance or UX decisions. The
interpretation authority is `docs/render-rules.md` § Measurement canon; the
agent-facing procedure is the `stellata-perf` skill.

## Files

```
scripts/perf/
  run.ts                    The runner: preflight (flags → URL reachable →
                            marker consumed), launch, per-scenario loop,
                            exit codes. The only Playwright value import in
                            the tree; never imported by a test.
  args.ts (+ test)          Flags → RunArgs (node:util parseArgs).
  scenarios.ts (+ test)     The five canon vantages as share blobs, and
                            scenarioUrl().
  page-protocol.ts          Every page.evaluate: boot, gate snapshot, adapter
                            probe, rAF probe, drawing-buffer read, the
                            priceFrame call.
  settle-pure.ts (+ test)   settleVerdict over one render-gate snapshot.
  table-pure.ts (+ test)    The text table, in console.table column order.
  await-go.sh (+ test)      The arm poller the agent runs in the background.
  perf-go-lib.sh (+ test)   Marker name, path and freshness — the single
                            source, sourced by await-go.sh and
                            scripts/hooks/perf-guard.sh.
  perf-go-lib.ts            The same two scalars parsed out of the .sh for
                            run.ts and the tests, so no second copy of the
                            marker name or the hour can drift from the hook.
```

## Invocation

```
pnpm run perf -- [--scenario sol,earth,mw50,mw120,lg | all] [--backend webgl2|webgpu]
                 [--mode differential|probe] [--passes a,b] [--method timer-query|timestamp|raf-delta]
                 [--budget-ms N] [--dwell-frames N] [--warmup-frames N] [--settle-frames N] [--no-interleave]
                 [--headed] [--width 1280] [--height 800] [--dpr 2] [--quiet-ms 5000]
                 [--url http://localhost:5173] [--chrome-arg=<switch>]...
```

Defaults: Sol, WebGL2, differential, every present pass, the backend's best
clock, 1280×800 at dpr 2 (4.096 Mpx), headless. The priceFrame knobs
(`--dwell-frames`, `--warmup-frames`, `--settle-frames`, `--budget-ms`) pass
straight through; unset ones take priceFrame's own defaults. `--mode probe`
boots, settles and prints the adapter block and the idle rAF period without
a sweep.

Exit codes: **0** ok · **1** a scenario failed, was tainted, priceFrame
refused, or the adapter was software · **2** bad flags or unreachable URL
(marker untouched) · **3** not armed (marker absent or stale).

**A tainted scenario exits 1 even though its rows printed.** A page error
inside the sweep means the numbers describe a broken page, and the exit code
is the only part of a run a caller reads without parsing.

One-time setup: `pnpm exec playwright install chromium` — the runner uses
`channel: 'chromium'`, the full build with a GPU process, not the headless
shell.

## Human-armed

A marker file `.perf-go` at the repo root (gitignored) authorises exactly one
launch. **Only Alex creates it.** `scripts/hooks/perf-guard.sh`, a PreToolUse
hook on Bash / Write / Edit / NotebookEdit, enforces that as **two
independent gates**:

1. **The marker gate.** Any tool call that so much as names `.perf-go` is
   denied — a Bash command containing the string, or a Write/Edit whose
   target is the marker. Unconditional, and deliberately blunt: it does not
   ask whether the same call also launches.
2. **The launch gate.** A recognised launch — `pnpm|npm|yarn|bun [run] perf`
   with flags anywhere, `tsx|node|npx|bun|deno … scripts/perf/run[.ts]`,
   `./scripts/perf/run.ts`, `pnpm exec|dlx` forms — is denied while the
   marker is absent or older than an hour.

**Independence is the point.** As one condition — deny a command that both
arms and launches — the whole gate rested on recognising the launch, and a
spelling it missed (`npm run perf`, or a launch on its own line in a
multi-line command) took the self-arm through with it. Split, a missed launch
spelling degrades to the runner's own exit 3, because there is no route to a
marker for it to pair with. `cd scripts/perf && tsx run.ts` is the known
residual: matching a bare `run.ts` would deny unrelated commands, and
over-denying a launch is worse than deferring to exit 3.

Newlines are flattened to `;`, not to spaces, so a line boundary stays a
command boundary. The cost is a false positive: a multi-line commit message
quoting a launch spelling at the start of a line reads as a launch. Take the
same route the marker gate names for that — `git commit -F <file>`.

**Legitimately naming the marker** — a commit message, a PR body, a search —
goes around the Bash gate rather than through it: `git commit -F <file>` and
`gh pr create --body-file <file>` (the route a worktree session already
needs, since the worktree guard rejects `$( )` and heredoc bodies), and the
Grep tool for searching. The deny reason carries both.

**The hook fails closed.** An unhandled error would exit non-zero, which the
harness reads as a broken hook and lets the call through — so an `ERR` trap
denies, an unreadable marker age denies, and a missing `jq` falls back to a
bare exit 2 (the harness's other blocking spelling) rather than to silence.
That is the opposite posture from `prime-guard`, which fails open on purpose:
a missing memory is survivable, an unasked-for GPU run is not.

Reading `run.ts`, running the pure tests, `await-go.sh`, and
`perf-go-lib.sh` all pass through.

The agent's protocol, which the deny reason carries verbatim:

1. Announce what is to be measured and why, with the exact command.
2. Start `bash scripts/perf/await-go.sh` in the background. It polls every
   `PERF_GO_POLL_S` (15) s for up to `PERF_GO_TIMEOUT_S` (3600) s, prints
   one line when a fresh marker exists (exit 0), or exits 1 on timeout.
3. Proceed only when it reports the marker.
4. Never create the marker.

`run.ts` consumes the marker before the browser launches: absent → exit 3;
stale → deleted, exit 3; fresh → deleted, then launch. One arm is one launch
attempt, whatever happens after.

The runner never starts a dev server either. Alex always has one running;
`--url` targets it, and a worktree's server sits on another port. An
unreachable URL exits 2 before the marker is touched.

## What a run does

Per scenario, in its own browser context at the requested viewport and
device pixel ratio, with `localStorage['stellata.info-dismissed']` and
`sessionStorage['stellata.mobile-advisory-dismissed']` seeded to `'1'` so
neither modal ever shows:

1. **Boot** `<url>/v/<blob>/`, plus `#renderer=webgpu` for a WebGPU boot —
   the fragment is the only boot flag the URL carries
   (`src/client/webgpu/README.md` § The flag). Wait for `window.debug`,
   `window.stellata` and `#loading` gone; a `#loading-status` starting
   `Error:` is a `BootError`. Then check `stellata.webgpu` against the
   request: **a WebGPU request that booted WebGL2 fails the scenario.** A
   silent fallback is never mislabelled as a measurement.
2. **Adapter probe.** WebGL renderer/vendor via `WEBGL_debug_renderer_info`
   and `EXT_disjoint_timer_query_webgl2` presence (the live context on a
   WebGL2 boot, a throwaway one otherwise — dropped via `WEBGL_lose_context`
   before the sweep, so the instrument leaves no second GPU context alive in
   the page it is about to price); WebGPU `requestAdapter().info`,
   the fallback flag, and `stellata.webgpu.timestampsAvailable`. A software
   renderer (`/swiftshader|llvmpipe|software/i`, or a fallback adapter)
   **aborts the whole run** — nothing measured on it counts.
3. **Settle.** Poll `stellata.renderGate.debugState` every 250 ms until no
   hold is live, no camera transition is in flight, and the gate has been
   idle for `max(SETTLE_MS, --quiet-ms)`. The timeout error names the stuck
   predicate and the last wake reason (dust chunks wake as `dust-chunk`).
4. **rAF probe**, after settle so the gate is idle and the deltas are the
   compositor's cadence rather than frame cost. Headless Chromium's virtual
   display and a headed 60/120 Hz panel are different clocks — headed and
   headless numbers never compare, and the run header stamps which this is.
5. **Drawing buffer** from the canvas backing store, printed as Mpx.
6. **Differential**: `debug.priceFrame(options)`. An empty result is a
   refusal (panel open, no clock, pinned method unavailable) and is recorded
   with the last console line as the reason.

Page console is forwarded as `[page:<type>]` except `table` (the rows come
back as data). A `pageerror` during boot fails the scenario; during the sweep
it marks the scenario tainted, which exits 1 too. A crash aborts the run.
Any failure exits 1.

## Traps

- **The machine must be idle for the whole run.** Foreground work on the
  same GPU shows up as a wide `iqrMs` (20 ms against 1–2 ms idle), a
  baseline that walks upward across the sweep, and rows that fall under
  their brackets — measured on the parity spike, where the one run taken
  during other work was the one that looked like a headless defect.
- Everything in `docs/render-rules.md` § Measurement canon and
  `src/client/debug/frame-cost/README.md` § Reading a row: a `savedMs` under
  `noiseMs` or `bracketMs` did not resolve; the limit-mag columns must
  agree; never compare across `method`, `bufferMpx`, headed/headless, or
  browsers; never sum the column.
- A page function (anything handed to `page.evaluate` / `waitForFunction`
  / `addInitScript`) must hold no inner named helper — no
  `const f = () => …` — because tsx wraps those in a `__name(...)` call
  that does not exist once Playwright serialises the body into the page.
  The symptom is `ReferenceError: __name is not defined` from inside the
  page.
- **`stat` cannot be probed by failure.** `perf_go_age_s` asks GNU first
  (`stat -c %Y`) because that spelling *fails* on BSD, while BSD's `stat -f`
  is GNU's `--file-system` and **succeeds** on Linux — printing a filesystem
  block where a mtime was expected. Ordered the other way, the marker's age
  came back as prose, the arithmetic tripped `set -u`, the hook exited
  non-zero, and a PreToolUse hook that errors lets the call through: the
  consent gate was absent on every Linux checkout while the macOS suite
  stayed green. Each spelling also assigns separately — one shared
  `$( a || b )` capture concatenates both outputs. Pinned by
  `perf-go-lib.test.ts`, which asserts bare seconds rather than a
  non-zero exit.
- The default viewport is 1280×800 @ dpr 2 = 4.096 Mpx. The hand-run tables
  in the frame-cost README were taken at 6.774 Mpx (a 2560×2646 buffer);
  they are not comparable to a default-viewport run.

## Recording

Results go to the bead's notes with the path of the saved output, never into
this README. Say which vantage, backend, method, headless flag and buffer
size the run used.
