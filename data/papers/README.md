# Cited papers

The audit trail behind every scholarly citation in the tree: which works are
cited, for which claim, and the exact copy each one is verified against. A
citation that cannot be traced to a real paper carrying the claim is a defect.

## How the tree cites a work

Every citation points at the work's entry in `index.md` by key, always in the
rooted form: `[Zucker et al. 2020](/data/papers/index.md#zucker2020)` in
markdown, the bare `/data/papers/index.md#zucker2020` beside the author-year
in a code comment, docstring or data-file header. The entry is the only place
the journal, volume, DOI, arXiv ID, bibcode and identifier URLs live; the
citing text keeps the author-year and any in-paper locator that explains the
claim (Table A1, eq. 2, Sect. 2.7).

Outside the rule:

- **Public copy** — `src/client/index.html`, `public/`, `CITATION.cff` and
  strings rendered to users keep their visible DOI links until the index is
  published as a page they can link to.
- **Data provenance** — dataset DOIs (Zenodo, Dataverse, VizieR dataset DOIs)
  and the URLs a file was downloaded from. They say where bytes came from, not
  which paper backs a claim.
- **Vendored upstream files** and data values — catalogue ReadMe copies,
  frozen downloads, bibcode or reference-code columns, VizieR table names in
  queries. The folder README carries the citation instead.

A new citation of a work with no entry adds the entry — anchor, heading,
reference line, **Copy**, claims row — and its `manifest.json` row in the same
change; fetch the copy into `pdf/<key>.pdf` and pin its `sha256`.

## What enforces it

- `tests/citation-index.test.ts`: every pointer into `index.md` names an entry
  key (an explicit anchor, never a heading slug); every entry is cited from
  outside this folder; `manifest.json` keys exactly the entries.
- `tests/doc-pointer-resolution.test.ts`: a pointer to a key with no entry.
- Review, for what no scan can judge: a citation written without a pointer,
  and a cited value that disagrees with its claims-table row. Both are named
  checks in the `stellata-pr-review` skill
  ([Citations](/.claude/skills/stellata-pr-review/SKILL.md#citations--two-checks-on-every-diff)).

## The PDFs are private

`pdf` is a **gitignored symlink** to the maintainer's private paper store. The
papers are copyrighted and are never committed, uploaded or redistributed —
the store exists only so claims can be checked against the paper itself.

- Files are named `<key>.pdf` (VizieR catalogues: `<key>.readme.txt`), `<key>`
  being the entry's key.
- Beside each PDF with a text layer sits `<key>.txt`, its `pdftotext -layout`
  output (pages split by form feed) for grepping. It is derived: regenerate it
  whenever the PDF is replaced. Image-only scans have none; read the PDF.
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
| `index.md` | One entry per cited work under an explicit `<a id="<key>">` anchor: full citation, identifiers, the private copy's version, identification status when the work is not plainly identified (`book`, `ambiguous` with its candidates, `mismatch`, `not_found`), and a claims table (claim, value, status, page, passage). Hand-owned. |
| `manifest.json` | Per key, for machines: download `status` (`ok`, `manual` = needs a hand download, `unobtainable` = no copy reachable, so the claim needs another source, `unidentified` = no single work to fetch), `source_url`, `version`, `sha256` and `bytes` of the private copy, and a `note` when the copy is partial or the status needs a reason. |

Where a work is cited is never stored: `grep -rn 'index.md#<key>'` answers it
from the tree as it stands.

### `version` decides what a page number means

| `version` | Pagination |
|---|---|
| `publishedVersion`, `ADS scan of published article` | The journal's |
| `acceptedVersion`, `submittedVersion` | The arXiv preprint's — does **not** match the journal's page numbers |
| `VizieR ReadMe` | Line numbers in the catalogue ReadMe |
| `web page, retrieved <date>`, `text table, version <v>, retrieved <date>` | None — locators name the section, table or row; the date (and version) pin what was read |

A page locator is only meaningful alongside the version of the copy it was
read from, and `sha256` pins that copy.
