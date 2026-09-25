# Cited papers

The audit trail behind every scholarly citation in the tree: which works are
cited, where, for which claim, and the exact copy each one is verified
against. A citation that cannot be traced to a real paper carrying the claim
is a defect.

## The PDFs are private

`pdf` is a **gitignored symlink** to the maintainer's private paper store. The
papers are copyrighted and are never committed, uploaded or redistributed —
the store exists only so claims can be checked against the paper itself.

- Files are named `<key>.pdf` (VizieR catalogues: `<key>.readme.txt`), `<key>`
  being the paper's key in the JSON files below.
- Sessions read and write only through `data/papers/pdf`, never through the
  path it resolves to.
- A worktree has no copy of the symlink (it is gitignored). Link it to the main
  checkout's: `ln -s <main-checkout>/data/papers/pdf data/papers/pdf`.
- Anything that needs the PDFs must skip, not fail, when `pdf` is absent —
  CI never has it.
- `tests/folder-readme-coverage.test.ts` excludes the path, since it follows
  symlinks.

## Files

| File | Holds |
|---|---|
| `inventory.json` | Every cited work (`papers`) and every cited dataset / service / standard (`non_papers`), each with its occurrences (`file`, `line`, the text as cited, the claim it backs). `inconsistencies` lists the same work cited differently across the tree. A snapshot: `line` is where `text` sat when last synced, and drifts as the tree is edited. |
| `resolution.json` | For each work the tree cites without a DOI, arXiv ID or bibcode: its identification (`identified`, `book`, `ambiguous`, `not_found`, `mismatch`) with the evidence. `mismatch` means the paper exists but does not carry the claim the tree credits it with. |
| `manifest.json` | Per key: download `status` (`ok`, `manual` = needs a hand download, `unobtainable` = no copy reachable, so the claim needs another source, `unidentified`), `source_url`, `version`, `sha256` and `bytes` of the private copy, and a `note` when the copy is partial or the status needs a reason. |

`tests/doc-pointer-resolution.test.ts` skips `inventory.json`: its quotes carry
other files' relative pointers verbatim, which would not resolve from here.

### `version` decides what a page number means

| `version` | Pagination |
|---|---|
| `publishedVersion`, `ADS scan of published article` | The journal's |
| `acceptedVersion`, `submittedVersion` | The arXiv preprint's — does **not** match the journal's page numbers |
| `VizieR ReadMe` | Line numbers in the catalogue ReadMe |

A page locator is only meaningful alongside the version of the copy it was
read from, and `sha256` pins that copy.
