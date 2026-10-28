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
  and every failure names it. A `TableSpec` spreads the source's `file` and
  `hint` rather than restating them.
- `parse(input, ...args)` is any parse over the file — `input.text()`,
  `input.bytes()`, or `input.lines(onLine)` for a table too large to hold as
  one string ([Streaming a committed table](../../catalog/parse/README.md#streaming-a-committed-table)).
  Extra arguments (a keep-set) pass through `read(...args)`.
- `members(input)` lists further files the parse opens, each a `{file, hint}`
  of its own: the dust grid's chunks, listed by its manifest; Tycho-2's
  supplement; the cross index's curated corrections. They are checked and
  derived like the declared file.

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
`tests/source-declarations.test.ts` holds every `tsx` pipeline step to it —
each reached source has a `.read(` call, each reached artifact one of the
artifact reads or a `serialize` / `encodeLine`, somewhere
else in the closure — and fails on a `data/` path literal outside a declaring
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
