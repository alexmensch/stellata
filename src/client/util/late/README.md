# Late values

`late.ts` (+ test) — `Late<T>`, the one representation of a value that lands
after its reader exists, and `LateCell<T>`, its writer. It is the contract
[Boot in two waves](../../README.md#boot-in-two-waves) points at.
`late-fixture.ts` — test-only `lateReady` / `lateAbsent`.

## The three states

`state()` returns one of:

- **`pending`** — not landed yet, and it may still land.
- **`ready`** — carries `value`.
- **`absent`** — will not land this session: the artifact is missing, its load
  failed, or its owner detached it.

There is no nullable accessor, so a reader cannot turn "not yet" into a
plausible default without writing that choice as its own `pending` branch.
`absent` is separate from `pending` so a reader waiting on a value knows when
to stop waiting. An artifact that can be missing therefore has to be
`conclude()`d by its loader, or its readers wait forever.

## Two kinds of reader

- **Per-frame readers** match on `state()` every time they run. They correct
  themselves on the first frame after the value lands, so matching is enough.
- **Readers that sample once and hold the result** (a table build, a camera
  park, a rendered card) take `observe(fn)` as well. It runs `fn` straight
  away if the value has already settled, then again on every later settle, so
  the held result is rebuilt when the real value arrives. Unsubscribe in the
  same owner's teardown.

A cell may settle more than once: `land` after `land` replaces the value
(a re-attach), and `conclude` after `land` detaches it. It never goes back to
`pending`. Observers run through `fanOut`, so one throwing observer does not
stop the others hearing about the settle.

`lateFromPromise` makes a cell from a promise: `ready` on resolve, `absent` on
reject. It adds a rejection handler, so anything that has to surface the
error must also await the promise itself.

## What it cannot enforce

A one-shot reader can still write a fallback into its `pending` branch and
never call `observe`. The type makes that choice visible in the code; review
has to catch it. Catalogue records are a separate case. Their completeness is
the `CompleteCatalog` type
([Progressive catalog load](../../loaders/README.md#progressive-catalog-load)),
not a `Late` per record.
