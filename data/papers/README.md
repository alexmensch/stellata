# Cited papers

The audit trail behind every scholarly citation in the tree: which works are
cited, what each one actually says, and the exact copy that was read. A
citation that cannot be traced to a real paper carrying the claim is a defect.

## An entry records the paper, never the codebase

A claims row states what the paper says: the claim as the paper makes it,
the paper's own value, the page, and the passage quoted verbatim from the
copy. Nothing about Stellata lives in the index — not the value it ships,
not where the value is used, not whether the two agree. **Status** is
`verified` (read on the copy: the passage is quoted, on the page it names) or
`unverified` (no copy can be read: a book not held, an unobtainable chapter).

## When the codebase departs from a paper

Stellata is opinionated, as its star catalogue is: every value it ships has
one adopted source, and the choice is stated where the value lives — the code
comment beside the constant, the data file's source column, or the README of
the folder that owns the subsystem.

- **Shipped value equals the paper's:** cite it; the claims row is the proof.
- **Shipped value departs from the paper cited:** the site gives both values
  and the reason in a clause. The Polaris note is the pattern: its distance
  comes from the Gaia DR3 parallax of Polaris B (0.24 % error) rather than the
  HST parallax of [Bond 2018](/data/papers/index.md#bond2018) (158 ± 6 pc,
  3.8 %), and it says so. A departure with no stated reason is a defect.
- **Papers disagree with each other:** the site names the adopted source and
  why (precision, method, recency, independence); dissenting works may be
  cited with their own values, and their rows are as `verified` as any other.
- **Choosing or changing the adopted source is a product decision:** it goes
  to the product owner, never lands silently inside a citation fix.

## How the tree cites a work

Every citation names the work by its **label** and points at its entry by
key, always in the rooted form: `[Zucker 2020](/data/papers/index.md#zucker2020)`
in markdown; `Zucker 2020 (/data/papers/index.md#zucker2020)` — or
`(Zucker 2020, /data/papers/index.md#zucker2020)` — in a code comment,
docstring or data file. The label is the entry heading's text before the dash:
the first author's surname and the year, never co-authors or "et al.", with a
letter (`Tomasko 2008a`, `2008b`) only where two entries would otherwise share
one. The full author list, journal, volume, DOI, arXiv ID, bibcode and
identifier URLs live only in the entry; the citing text adds just the in-paper
locator that explains the claim (Table A1, eq. 2, Sect. 2.7).

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
reference line, **Copy**, claims row — in the same change; fetch the copy into
the store and pin it in `manifest.json`.

## What enforces it

- `tests/citation-index.test.ts`: every pointer into `index.md` names an entry
  key (an explicit anchor, never a heading slug); every entry's label has the
  first-author-and-year form, and every citation names its entry by that
  label, in one of the forms above; every entry is cited from
  outside this folder; `manifest.json` pins exactly the entries whose **Copy**
  is held, each copy named for its entry; `pdf` is a link to the store and
  every pinned copy in it still has its pinned bytes
  ([The PDFs are private](#the-pdfs-are-private)).
- `tests/doc-pointer-resolution.test.ts`: a pointer to a key with no entry.
- `tests/citation-index.test.ts` also fails a DOI, arXiv ID or bibcode written
  in prose or a comment outside the index — string literals, code spans, data
  tables under `data/`, dataset DOIs, VizieR catalogue bibcodes and public
  copy aside.
- Review, for what no scan can judge: an author-year credit written without a
  pointer, and a cited value that neither matches its claims row nor states
  its departure ([When the codebase departs from a paper](#when-the-codebase-departs-from-a-paper)).
  Both are named checks in the `stellata-pr-review` skill
  ([Citations](/.claude/skills/stellata-pr-review/SKILL.md#citations--two-checks-on-every-diff)).

## The PDFs are private

`pdf` is a **gitignored symlink** to the maintainer's private paper store. The
papers are copyrighted and are never committed, uploaded or redistributed —
the store exists only so claims can be checked against the paper itself.

- A copy is named for its entry's key: `<key>.pdf`, `<key>.readme.txt` for a
  VizieR catalogue ReadMe, `<key>.page.txt` for the text of a web page.
- Beside each PDF sit two derived text layers, pages split by form feed:
  `<key>.txt` (`pdftotext -layout`, which keeps tables aligned) and
  `<key>.flow.txt` (`pdftotext`, which keeps two-column prose in reading
  order). They are never copies: regenerate both whenever the PDF is replaced.
  An image-only scan has neither, and its **Copy** line says `image-only scan`;
  read its page images.
- Sessions read and write only through `data/papers/pdf`, never through the
  path it resolves to.
- Every checkout has it. `.worktreeinclude` lists it, so a worktree Claude Code
  creates gets it; anywhere else, link it by hand:
  `ln -s "<paper store>" data/papers/pdf`. It must be the link, never a copied
  folder — a copy takes writes the store never sees.
- `tests/citation-index.test.ts` fails when `pdf` is missing or is not a link;
  checks every held copy against its pin and for both text layers; and checks
  every `verified` row's quoted passage against the copy's text, on the page or
  ReadMe line the row names. CI is the one place without the store (`CI` set),
  and there those checks skip.
- `tests/folder-readme-coverage.test.ts` excludes the path, since it follows
  symlinks.

## Files

| File | Holds |
|---|---|
| `index.md` | One entry per cited work under an explicit `<a id="<key>">` anchor: full citation, identifiers, the private copy's version, identification status when the work is not plainly identified (`book`, `ambiguous` with its candidates, `mismatch`, `not_found`), and a claims table (claim, value, status, page, passage) of what the paper says. Hand-owned. |
| `manifest.json` | The pin of each held copy, for machines: per key, a list of copies, each with its `file` in the store, the `source_url` it was fetched from, and its `sha256` and `bytes`. An entry whose copy is not held has no key here; its **Copy** line says why. |

Where a work is cited is never stored: `grep -rn 'index.md#<key>'` answers it
from the tree as it stands. `index.md` is too long to read whole; find an
entry with `grep -n '<a id="<key>">' data/papers/index.md` and read from that
line.

### The copy's version decides what a page number means

| **Copy** | Pagination |
|---|---|
| `publishedVersion`, `ADS scan of published article` | The journal's |
| `acceptedVersion`, `submittedVersion` | The arXiv preprint's — does **not** match the journal's page numbers |
| `VizieR ReadMe` | Line numbers in the catalogue ReadMe |
| `web page, retrieved <date>`, `text table, version <v>, retrieved <date>` | None — locators name the section, table or row; the date (and version) pin what was read |

A page locator is only meaningful alongside the version of the copy it was
read from, and the manifest's `sha256` pins that copy.
