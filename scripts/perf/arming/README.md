# Arming the perf runner — the consent gate

A GPU measurement costs Alex a machine held idle for 15–25 minutes, so the
runner never launches on the agent's own initiative. A marker file `.perf-go`
at the repo root (gitignored, anchored `/.perf-go`) authorises exactly one
launch, and **only Alex creates it**. This folder is the marker's name, its
freshness, the poller that waits for it, and nothing else; what a run then
measures is `../README.md`.

## Files in this area

```
scripts/perf/arming/
  perf-go-lib.sh (+ test)   Marker name, path and freshness — the single
                            source, sourced by await-go.sh and
                            scripts/hooks/perf-guard.sh.
  perf-go-lib.ts            The same two scalars parsed out of the .sh for
                            run.ts and the tests, so no second copy of the
                            marker name or the hour can drift from the hook.
  await-go.sh (+ test)      The arm poller the agent runs in the background.
```

`scripts/hooks/perf-guard.sh` is the gate itself and lives with the other
harness hooks; `tests/perf-guard.test.ts` pins its behaviour.

## Two independent gates

`perf-guard.sh`, a PreToolUse hook on Bash / Write / Edit / NotebookEdit:

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
`scripts/hooks/README.md` § How perf-guard fails closed carries the rest.

Reading `run.ts`, running the pure tests, `await-go.sh`, and
`perf-go-lib.sh` all pass through.

## The protocol

The deny reason carries these four steps verbatim:

1. Announce what is to be measured and why, with the exact command.
2. Start `bash scripts/perf/arming/await-go.sh` in the background. It polls
   every `PERF_GO_POLL_S` (15) s for up to `PERF_GO_TIMEOUT_S` (3600) s,
   prints one line when a fresh marker exists (exit 0), or exits 1 on
   timeout.
3. Proceed only when it reports the marker.
4. Never create the marker.

`run.ts` consumes the marker before the browser launches: absent → exit 3;
stale → deleted, exit 3; fresh → deleted, then launch. One arm is one launch
attempt, whatever happens after.

## Launch the runner detached, always

**Both the poller and the runner go in the background** — under Claude Code,
Bash `run_in_background`. The poller because it waits up to an hour; the
runner because a foreground call is capped at **10 minutes** and killed
there, while every mode worth arming for runs longer: a pin run is 15–25 min
across its ten contexts at a 120 s cool-down, a `--scenario all` differential
18–21.

The cost of getting this wrong is the arm, not merely the run. The marker is
consumed *before* the browser starts, so a launch killed at the cap has
already spent it — there is no retry that does not need a fresh arm, and
asking for one is asking the operator to hold the machine idle again. A
partial run also leaves no JSON: the file is written once, at the end, so a
run that dies on context 3 of 10 leaves only its console log.

Read progress from the background process's output file while it runs; treat
the exit code as the verdict, since a tainted run still prints its tables.

## Traps

- **`stat` cannot be probed by failure.** `perf_go_age_s` asks GNU first
  (`stat -c %Y`) because that spelling *fails* on BSD, while BSD's `stat -f`
  is GNU's `--file-system` and **succeeds** on Linux — printing a filesystem
  block where a mtime was expected. Ordered the other way, the marker's age
  came back as prose, the arithmetic tripped `set -u`, the hook exited
  non-zero, and a PreToolUse hook that errors lets the call through: the
  consent gate was absent on every Linux checkout while the macOS suite
  stayed green. Each spelling also assigns separately — one shared
  `$( a || b )` capture concatenates both outputs. Pinned by
  `perf-go-lib.test.ts`, which asserts bare seconds rather than a non-zero
  exit.
- **The two scalars have one source.** `perf-go-lib.ts` parses them out of
  `perf-go-lib.sh` rather than re-declaring them, because the hook can only
  read the `.sh` and a second copy of the hour would drift from the gate
  silently — the runner would refuse a marker the hook had accepted, or
  worse, accept one it had not.
