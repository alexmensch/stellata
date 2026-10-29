# Lineage — the committed reason-code list

Pipeline-derived, never hand-edited: `pnpm run lineage:codes` generates it
from every lineage stage's code declarations
(`scripts/catalog/lineage/`, [Reason codes](/scripts/catalog/lineage/README.md#reason-codes--closed-append-only-generated)).
The lineage rows themselves are build artifacts under `build/lineage/`; this
folder holds only the list every row's `code` must be on.

```
reason-codes.tsv   Regular git. One row per code: code, stage, effect
                   (retire · park · merge · none), status (live · retired ·
                   historical), retired_in, first_version — the package
                   version of the tree that first generated the code — and
                   the one-line description public SID pages show.
```

Two suites in `scripts/catalog/lineage/reason-codes.test.ts` hold it: it
equals what the declarations generate, and against its merge-base copy no
code is removed, renamed, or has its stage, effect, description or first
version changed; a status moves only live → retired.
