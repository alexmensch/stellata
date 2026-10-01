# What the public pages are derived from

```
site-metrics.ts        Counts the catalogue records, the credited sources
                       and the cited references off the things themselves,
                       and reads the version off package.json; a figure it
                       cannot read stops the build.
figures-pure.ts        The figure names a page may ask for and the one
                       `%VITE_…%` substitution (+ test).
json-ld-citations.ts   The Vite plugin appending every citation-index work to
                       a page's JSON-LD `citation` array; the merge itself is
                       json-ld-citations-pure.ts (+ test). The index is
                       parsed once per build or dev-server start, like the
                       figures, so an index edit shows after a restart. Contract:
                       /src/site/README.md#the-json-ld-citation-list.
markdown-rendition.ts  A page's markdown rendition, derived from the page's
                       own HTML. Emitted as `dist/index.md`.
page-meta-pure.ts      A page's `<title>` and meta description, and the
                       `%PAGE_TITLE%` / `%PAGE_DESCRIPTION%` substitution
                       (+ test).
llms-txt.ts            `/llms.txt`, built from `src/site/llms.txt`.
shipped-html-pure.ts   What the site build removes from a page (+ test).
```

Each is a derivation rather than a pipeline (figures-pure.ts and
`../util/parse-html.ts` are what they share), and each exists so that something a
page states is never *also* written down by hand.

## The figures

`site-metrics.ts` is read at **config load** by `vite.env.ts`, whose
`buildFigures` is the one map of every figure a page may ask for —
`%VITE_APP_VERSION%`, `%VITE_STAR_COUNT%`, `%VITE_SOURCE_COUNT%`,
`%VITE_REFERENCE_COUNT%`, the names `figures-pure.ts` lists. Both Vite
configs publish it to `import.meta.env` and substitute it into every HTML
document through `figureSubstitution`, a `pre` hook that runs ahead of
Vite's own `%ENV%` pass; the markdown rendition goes through the same
`substituteFigures`. A token naming no listed figure, or a figure with no
value, stops the build — Vite's own pass would leave the token in the
page and only warn. So a figure on the homepage is a lookup, not a
literal.

`tests/site-claims.test.ts` imports this module and holds the pages to it.

## Why each count is derived where it is

- **Catalogue records** — the built `catalog.bin.0` header, which is the
  only thing that knows. On a checkout that has not run `build:catalog` it
  falls back to `scripts/catalog/build-catalog-expected.json`'s
  `recordCount`. After `build:data` the two cannot disagree: the stamp
  rebuilds a stale artifact, and `build-catalog` refuses to write one whose
  counts drift from that snapshot without `UPDATE_BUILD_COUNTS=1`.
  `build:site` or `vite build` run alone reads whatever artifact is on disk,
  which in a worktree seeded from another commit can be one the branch's
  snapshot no longer matches. That fallback is what lets a page state an exact
  figure at all — a value that vanishes on a fresh clone has to be worded
  around, and the wording is what goes stale. The fallback covers an
  **absent** artifact only: one that is present but unreadable stops the
  build rather than quoting the snapshot over it.
- **Credited sources** — the `<div>` rows of the application's own Credits
  tab (`src/client/app/index.html`, `.modal-credits`), selected from the
  parsed document, so reformatting the markup cannot move the figure.
  Adding a source to the app moves the homepage in the same build, with
  nobody counting; finding none stops the build.
- **Cited references** — the entries in `data/papers/index.md`, parsed by
  `../util/citation-index-pure.ts`. The index holds every work the tree
  cites, one entry each, and `tests/citation-index.test.ts` fails a citation
  that points anywhere else, so the entry count is the record's size, not
  an estimate of it. An index with no entries stops the build.

## The page meta

A page's `<title>` and `<meta name="description">` are written once; every
restatement of them is a `%PAGE_TITLE%` or `%PAGE_DESCRIPTION%` token.
`fillPageMeta` fills each token in the encoding its place needs — an
attribute value in the markup, JSON string content inside an `ld+json`
block — and refuses any other `%PAGE_…%` name. The site pass applies it to
every page in `src/site/pages.ts` (`pageMetaFill` in `vite.site.config.ts`,
a `pre` hook) and `vite.site-dev.ts` to every page it serves; the 404 page
is outside the roster and states its own. A roster page missing either
source stops the build.

## llms.txt

`/llms.txt` is built, not committed: `src/site/llms.txt` is a template of
links, and its `> ` summary is `%PAGE_DESCRIPTION%`, filled with the
homepage's meta description. So the homepage is the one place the project
describes itself to an agent, and the summary cannot drift from it. The
site pass emits it as `dist/llms.txt`, a static asset; `pnpm run dev`
serves the same derivation at `/llms.txt` (`vite.site-dev.ts`).
`page-meta-pure.test.ts` holds the built summary to the page's description.

## What ships

The site build drops a page's `debug.capture()` comments: they are the
recipe for re-shooting a sight's clip, authoring for this repo rather than
anything a visitor's browser needs. The source keeps them, and so does the
dev server, so `tests/site-claims.test.ts` and the capture procedure read
them there. Every other comment ships, the doc-figure markers among them.

## The markdown rendition

`markdown-rendition.ts` turns an authored page into the markdown an agent
client reads instead of the HTML. `vite.site.config.ts` calls it at
`generateBundle` and emits the result beside the document it renders —
`src/site/index.html` → `dist/index.md`, served at `/index.md`.
`src/negotiation-pure.ts` decides when `/` answers with it, and
[The markdown rendition](/src/site/README.md#the-markdown-rendition--how-an-agent-reads-these-pages) is why the page has one.

**Derived, never authored beside the page.** A hand-kept markdown copy of
the homepage is two sources for one claim, which is the defect
`tests/site-claims.test.ts` exists to prevent — and the copy is the one
nobody re-reads. Deriving also means the `%VITE_*%` figures resolve from
the same environment the HTML's do, so the two renditions cannot quote
different counts.

The conversion itself is **`rehype-remark`'s**, not ours: `rehype-parse`
reads the HTML with a real parser, `remark-gfm` and `remark-stringify`
write the markdown. What this module owns is only the policy that library
cannot know:

- **The preamble.** The page's `<title>` becomes the one top-level
  heading and its meta description the summary blockquote, which is
  `llms.txt`'s shape and what agent clients already read. Body headings
  shift down a level so the document has a single root.
- **The skip link is dropped** — `.skip-link` jumps past the masthead of a
  page an agent reads top to bottom anyway.
- **HTML comments are dropped.** They are the page's authoring layer — the
  capture recipe behind each sight, the doc-figure markers around a quoted
  count — and markdown would otherwise carry them through literally.
- **Links are absolute**, resolved against the page's own `canonical` — so
  a rendition quoted somewhere else still points back here, and no origin
  is restated in this file. A `<base href>` is honoured the way a browser
  honours it, itself resolved against the canonical.
- **An eyebrow folds into its heading.** A `.section-head`'s `.label` is
  the heading's prefix — `## Label: Heading` — rather than a line of its
  own that an agent would read as body copy; a `.section-head` with no
  heading stops the build.
- **A cluster is laid out as lines.** Each phrasing item of a `.cluster`
  (a call to action and its note, the masthead's links) is its own
  paragraph, so a button and the sentence beside it never run together. In
  the `footer`, a cluster's items join with ` · ` instead, one line of
  credits and links.
- **Definition lists become labelled bullets.** mdast has no definition
  list, so the readout strip would otherwise flatten into one run of text
  with nothing saying which figure belongs to which label.
- **A clip becomes its poster still**, named by its `aria-label` — mdast has
  no video node either, and a frame an agent can read beats a link to bytes
  it cannot. Both attributes are therefore required and a clip missing
  either stops the build, which is also what guarantees the page has a
  largest-contentful-paint image and the clip an accessible name. This is
  why `video` is **absent** from `VOCABULARY` rather than listed in it: the
  pass runs first, so none survives to be converted.

**`VOCABULARY` is a closed set, and that is the point.** An element the
module has no rule for throws and names itself rather than being converted
on a guess or silently dropped. A page reaching for `<details>` or
`<aside>` therefore fails the build until someone decides what it means in
markdown — a rendition that quietly loses a section is worse than a build
that stops.
