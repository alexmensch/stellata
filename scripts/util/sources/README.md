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
                       modules; declaredFiles, their repo-relative files.
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
  (the dust grid's chunks, named by its manifest; the SID bridges folder)
  opens that file just to list, so only a file outside LFS may use it: the
  bare CI test job derives input sets over LFS pointer stubs. `read` opens
  every member and hands them to the parse as `input.members` (in declared
  order) and `input.member(file)`, which refuses a file the list did not
  name; no parse opens a file itself, so one it reads cannot escape the
  presence check or the input set. `tests/source-declarations.test.ts` fails
  on an `openDeclared` call outside `source.ts`.

`source.read(...)` and `readArtifact(artifact)` / `artifactRows(artifact)`
(a generator) / `streamArtifact(artifact, onRecord)` are the reads;
`artifactText(artifact)` is the file as written, for a reader that hashes its
lines (the SID ledger's head).

**Every source is required.** A missing file and an unsmudged LFS pointer are
one failure — the content is not on disk — and `read` throws naming the file,
`git lfs pull` and the hint, before any parse runs. No read substitutes an
empty table: a missing input surfaces at the read, not as a count drift
afterwards.

## Reached means read

A declaration lives only in a module named `*-source.ts` or `*-tsv.ts`, and
that module is imported only by code that reads (or, for an artifact, writes)
the file through it. Import reachability then equals reading, which is what
lets a step's data inputs be derived from its closure.
`tests/source-declarations.test.ts` holds every TypeScript pipeline step to
it — the `build:*` and `fetch:*` targets plus `sid:allocate` and
`sid:risk-set`, the step kinds in
[Step kinds](../../pipeline/README.md#step-kinds); reports, audits and
validators are not steps. In each step's closure every reached source has a
`.read(` call, every reached artifact one of the artifact reads or a
`serialize` / `encodeLine`, somewhere other than its declaring module. Across
all of `scripts/` it also fails on a `data/` path literal outside a declaring
or `*-outputs.ts` module.

A helper that a non-reader needs does not live beside a declaration: it moves
to a module of its own, or the closure of every caller reaches the file.

## SourceRowRef

`{ source, row }`: a row of a declared source or artifact, by that source's
typed row key — never a path string
([SourceRowRef](../../catalog/lineage/README.md#sourcerowref)). A declaration
carries a `rowKey` (`{id, text}`) only once something cites its rows, so
`sourceRowRef` is a compile error on any other. Its text form is
`<id>:<row>`.
