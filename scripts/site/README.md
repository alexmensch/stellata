# What the public pages are derived from

```
site-metrics.ts        Counts the catalogue records, the credited sources
                       and the cited references off the things themselves.
markdown-rendition.ts  A page's markdown rendition, derived from the page's
                       own HTML. Emitted as `dist/index.md`.
parse-html.ts          The one HTML parse both of the above read a page
                       through.
```

Both are derivations rather than pipelines, and both exist so that
something a page states is never *also* written down by hand.

## The figures

`site-metrics.ts` is read at **config load** by `vite.env.ts`, which
publishes each count as a `VITE_` value, and Vite substitutes those into
the pages as `%VITE_STAR_COUNT%`, `%VITE_SOURCE_COUNT%`,
`%VITE_REFERENCE_COUNT%`. So a figure on the homepage is a lookup, not a
literal — which is the one thing a monorepo holding the model, the
application and the marketing page is good for.

`tests/site-claims.test.ts` imports this module and holds the pages to it.

## Why each count is derived where it is

- **Catalogue records** — the built `catalog.bin.0` header, which is the
  only thing that knows. On a checkout that has not run `build:catalog` it
  falls back to `scripts/catalog/build-catalog-expected.json`'s
  `recordCount`. The two cannot disagree: `build-catalog` refuses to write
  an artifact whose counts drift from that snapshot without
  `UPDATE_BUILD_COUNTS=1`. That fallback is what lets a page state an exact
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
- **Scaffolding is dropped** — `.holder` and `.skip-link`. A holder is the
  dashed box naming a capture still to be taken; an agent quoting the page
  today would otherwise read back the filenames of pictures that do not
  exist. An anchor left empty by that drop goes too, because a sight's
  picture *is* its link and `[](url)` is noise. Once a capture lands, the
  `<img>` keeps its anchor.
- **Links are absolute**, resolved against the page's own `canonical` — so
  a rendition quoted somewhere else still points back here, and no origin
  is restated in this file.
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
