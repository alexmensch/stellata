# Source — declared data inputs

Every file under `data/` a TypeScript pipeline step reads is declared once,
as a module-level constant: an external table or file through `defineSource`,
a file this repo writes through its `defineArtifact` codec (`../tsv/`). The
constant is the only way a step opens the file, and the set a step's import
closure reaches is that step's data input set — derived, never listed
([The step table](../../pipeline/README.md#the-step-table--stepsts)).

## Files in this area

```
scripts/util/sources/
  source.ts            defineSource, readArtifact / streamArtifact, and
                       openDeclared — the one presence check and the one
                       place a declared file is opened. Vite's native
                       config loader reaches it (vite.env.ts →
                       ../../site/), so its value imports name their
                       `.ts` extension.
  declared-inputs.ts   declaredInputs(closure) — the sources and artifacts an
                       import closure reaches, by importing its declaring
                       modules, each classified read / written / both /
                       unused; isRead, the step's data inputs among them;
                       declaredFiles, their repo-relative files.
  row-ref-pure.ts      SourceRowRef, RowKey — a cited source row
                       (#sourcerowref).
```

## Declaring a source

`defineSource({file, hint, parse, members?, rowKey?})`:

- `file` is repo-relative; `hint` is the target that rebuilds or re-pulls it,
  and every failure names it. The `input` a parse receives carries both, so a
  parser takes `input` as its `{file, hint}` and a `TableSpec` spreads it
  rather than restating them.
- `parse(input, ...args)` is any parse over the file — `input.text()`,
  `input.bytes()`, or `input.lines(onLine)` for a table too large to hold as
  one string ([Streaming a committed table](../../catalog/parse/README.md#streaming-a-committed-table)).
  Extra arguments (a keep-set) pass through `read(...args)`.
- `members` lists further files the parse opens, each a `{file, hint}` of its
  own, checked and derived like the declared file. A fixed list (Tycho-2's
  supplement, the cross index's and WGSN faints' curated corrections) is
  listed without opening anything. A function of the declared file's content
  (the dust grid's chunks, named by its manifest) opens that file just to list, so only a file outside LFS may use it: the
  bare CI test job derives input sets over LFS pointer stubs. `read` opens
  every member and hands them to the parse as `input.members` (in declared
  order) and `input.member(file)`, which refuses a file the list did not
  name; no parse opens a file itself, so one it reads cannot escape the
  presence check or the input set. `tests/source-declarations.test.ts` fails
  on an `openDeclared` call outside `source.ts`.

**A folder source** (`defineFolder({dir, hint, include, subDirs?, parse})`)
is a folder whose present files are the input: the SID bridges and the four
mirrored data folders. Its presence check is that the folder exists; its
members are the listing (`include` over `dir` and each `subDirs` folder),
each presence-checked, and `files()` is that listing alone — no README or
other anchor file joins the input set, and a file added to the folder
changes it.

`source.read(...)` and `readArtifact(artifact)` / `artifactRows(artifact)`
(a generator) / `streamArtifact(artifact, onRecord)` are the reads;
`artifactText(artifact)` is the file as written, for a reader that hashes its
lines (the SID ledger's head).

`isReadable(declared)` is the presence predicate itself (present and not an
LFS pointer): the one `openDeclared` checks, and the one a suite that may
meet an unpulled declaration gates its `skipIf` on.

**Every source is required.** A missing file and an unsmudged LFS pointer are
one failure — the content is not on disk — and `read` throws naming the file,
`git lfs pull` and the hint, before any parse runs. No read substitutes an
empty table: a missing input surfaces at the read, not as a count drift
afterwards.

**Listing never throws.** `files()` answers `listed` (the declared file and
its members) or `unlistable` (the file or folder that would name the members
is not on disk). `listingFiles` turns either into what a content hash keys:
an unlistable source counts as its declared file, which hashes as absent, so
its arrival is a change like any other — a stamp over many steps marks the one
step stale instead of failing to compute. The throw stays at `read`.

## Reached means read

A declaration lives only in a module named `*-source.ts` or `*-tsv.ts`, and
that module is imported only by code that reads (or, for an artifact, writes)
the file through it. Import reachability then equals reading, which is what
lets a step's data inputs be derived from its closure.
`tests/source-declarations.test.ts` holds every TypeScript pipeline step to
it — the `build:*` and `fetch:*` targets plus `sid:allocate` and
`sid:risk-set`, the step kinds in
[Step kinds](../../pipeline/README.md#step-kinds), over the closure of every
`tsx` entry a chained script runs (`build:local-group`, `build:clouds`'s
SID stamp); reports, audits and validators are not steps. A step-named script
whose commands `scriptParts` cannot classify fails the test, unless it is on
the test's named not-a-step list (the Vite builds, the seed wrapper). `declaredInputs(closure)` classifies each reached
declaration by the calls in the closure's other modules: `read` (a source's
`.read(`, an artifact read), `written` (an artifact's `serialize` /
`encodeLine`), `both`, or `unused`. A step's data inputs are the `read` and
`both` ones (`isRead`), so a step never depends on its own output and an
artifact it reads and rewrites stays an input; the test fails any step with
an `unused` one. Across `scripts/`, `src/`, `tests/` and the `vite*.ts`
configs — test code included — it also fails on a `data/` path literal
outside a declaring or `*-outputs.ts` module: a test names a data file through
its declaration (`X.file`, `isReadable(X)`, `X.read()`). The test's named
`DATA_PATH_SPELLERS` are the exceptions: the two input-set pins, which check a
derivation from outside the declarations, and the scanners of the repo's
top-level folders and paper store. A pure parser's test labels its fixtures
`fixture/…`, never a real path.

A helper that a non-reader needs does not live beside a declaration: it moves
to a module of its own, or the closure of every caller reaches the file.

## SourceRowRef

`{ source, row }`: a row of a declared source or artifact, by that source's
typed row key — never a path string
([SourceRowRef](../../catalog/lineage/README.md#sourcerowref)). A declaration
carries a `rowKey` (`{id, text}`) only once something cites its rows; its
type then holds a required `rowKey` (`RowKeyOf<K>`), and a keyless one holds
`undefined`, so `sourceRowRef` is a compile error on a keyless declaration
or a wrongly typed row. Every declaration also carries a type-only brand
(`Declaration`) that no object literal can, so a hand-written
`{file, rowKey}` stand-in does not compile either
(`row-ref-pure.test.ts`). Keyed today: the spine (`spine:<line>`),
`multiples.tsv` (`multiples:<system_id>/<comp>`), the magnitude pull
(`gaia-dr3:<source_id>`), and the three tables an addition group is
founded on — IV/25 (`iv25:<tyc>`), I/239 (`i239:<hip>`) and CNS5
(`cns5:<cns5 id>`). Its text form is `<id>:<row>`.
