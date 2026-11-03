# Manual-step records

One JSON file per pull and bake — every `refresh:*` and `fetch:*` pull and
the six bakes — named for its step (`:` written `-`). Each
is the committed record of that step's last run: the hash of every repo
file it read and every file it wrote, and for a pull the hash of its query,
the services that answered and the upstream release. The design is
[Freshness](/scripts/pipeline/README.md#freshness--one-mechanism); the one
writer is `scripts/pipeline/record.ts`, which every pull's and bake's
`package.json` target runs ([Recording a manual
step](/scripts/pipeline/README.md#recording-a-manual-step--recordts)).

They are committed, unlike `build/stamps/`, because frozen data needs a
committed record of what produced it: the runner never runs a manual step,
so these files are how a build knows a pull or bake is stale, and the stop
message names the command to re-run.

**Never edit one by hand.** Re-run the step through its target, which
rewrites the record; hand edits are what the record exists to catch.

## Bootstrap

The first records were written without re-running anything: each adopted
the committed outputs as they stood, the request files and data each pull
reads, and the query its `--describe` printed. A bake's first record holds
its hand list of inputs (its code and the data files it reads); its next run
replaces that with the set the recorder sees. `answeredBy` is empty in every
bootstrapped record, since no run was observed.
