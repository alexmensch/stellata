# Manual-step records

One JSON file per pull and bake — every `refresh:*` and `fetch:*` pull and
the six bakes — named for its step (`:` written `-`). Each
is the committed record of that step's last run: the hash of every repo
file it read (a code file by its identity, so a comment-only edit to a
bake's code leaves it fresh: `scripts/util/code-identity.ts`) and every file
it wrote, and for a pull the hash of its query,
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
rewrites the record; hand edits are what the record exists to catch. The one
exception is a change to how an input is hashed: that commit re-keys the
affected hashes in every record, starting from a base where every manual
step reads fresh, so no record turns fresh that was stale. CI's
stale-manual-step stop catches a record the re-key missed.

## Bootstrap

The first records were written without re-running anything: each adopted
the committed outputs as they stood, the request files and data each pull
reads, and the query its `--describe` printed. A bake's first record holds
its hand list of inputs (its code and the data files it reads); its next run
replaces that with the set the recorder sees. `answeredBy` is empty in every
bootstrapped record, since no run was observed.
