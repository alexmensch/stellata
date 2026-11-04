# Run files — the `--json` record, its encoding, where it is filed

What `pnpm run perf -- --json` and `pnpm run survivors -- --json` write, how
it sits on disk, and where it goes so a later reader can find it. The
archive itself and its naming rules are `/.perf-runs/README.md`.

```
scripts/perf/run-file/
  run-file.ts (+ test)   RUN_FILE_SUFFIX, parseRunFilePath — the --json
                         check both parsers apply, returning the branded
                         RunFilePath that writeRunFile alone accepts, so
                         the compiler refuses a write to an unchecked
                         path; RUN_FILE_GZIP_LEVEL; and readJsonFile —
                         gzip or plain JSON, so a pin
                         (plain) reads through it too.
```

## JSON output

**`--json` writes gzip, and a path not ending `.json.gz` is a flag error**
(exit 2, marker untouched) — on the runner and on `survivors` alike, so the
archive holds one format. `--baseline`, `--against-pin` and `perf:pin` read
gzip or plain JSON through `readJsonFile`. Read one by hand with
`gzcat <path> | jq …`.

`--json <path>.json.gz` writes the whole run as schema `stellata-perf/2`:
`run` (timestamps, url, argv, the commit pair and dirty flag, browser and its
switches, the adapter probe, host) plus one record per scenario × backend
(backend requested and actual, viewport, buffer and Mpx, catalogue record
count, the context's 1-based position in the run, mode, method, params,
settle time, the mode's own block, forwarded console, page errors,
`tainted` and `failed`). The survivors file's own shape:
[Survivor counts](../README.md#survivor-counts--the-one-entry-point-here-that-is-not-a-cost-instrument).

**Raw samples are always retained** — every rAF delta and every GPU sample,
not just the summary. A re-analysis with a different estimator has to be
possible from the file alone, and a summary cannot be un-summarised.

`assertPerfFile` (`../schema.ts`) checks the schema string by equality before
reading anything else, and it is the only place the schema suffix (the `/2`
of `stellata-perf/2`) is judged — a
`--baseline` carrying another one is refused in the preflight, so the diff
never sees a file it would have to reason about. What bumps the suffix, and
why a bump abandons every recorded baseline: `schema.ts`, on `PERF_SCHEMA`.
It also refuses a file naming any scenario outside the canon five
(`isScenarioName`, in `../scenarios.ts`), so every per-vantage lookup past it
is total.

## Recording

`--json` output and the run's log go under the `.perf-runs/<date>/` of **the
checkout you will commit from** — the worktree holding the branch, not the main
checkout and not `/tmp` or the home directory. A run written into another
checkout never appears in this branch's `git status`, so nothing will prompt
you for it and the PR ships a citation to a file no one else has.

**`git add` the run file in the PR that cites it — the folder being tracked
does not commit anything.** A bead note, a PR body or a README quoting
`.perf-runs/<date>/<file>` is a promise that the path resolves for the next
reader; [Names](../../../.perf-runs/README.md#names) is where that promise is written
down. Until the file is in a commit it resolves on one machine only, and a
`git clean` ends it.

Results go to the bead's notes with the `.perf-runs/<date>/<file>` path, never
into a README. Say which vantage, backend, method, headless flag and buffer
size the run used.
