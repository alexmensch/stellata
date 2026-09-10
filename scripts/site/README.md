# Site metrics — the figures the public pages quote

```
site-metrics.ts   Counts the catalogue records, the credited sources and
                  the cited references off the things themselves.
```

Not a build pipeline: nothing here writes an artifact. It is read at
**config load** by `vite.env.ts`, which publishes each count as a `VITE_`
value, and Vite substitutes those into the pages as `%VITE_STAR_COUNT%`,
`%VITE_SOURCE_COUNT%`, `%VITE_REFERENCE_COUNT%`. So a figure on the
homepage is a lookup, not a literal — which is the one thing a monorepo
holding the model, the application and the marketing page is good for.

`tests/site-claims.test.ts` imports this module and holds the pages to it.

## Why each count is derived where it is

- **Catalogue records** — the built `catalog.bin.0` header, which is the
  only thing that knows. On a checkout that has not run `build:catalog` it
  falls back to `scripts/catalog/build-catalog-expected.json`'s
  `recordCount`. The two cannot disagree: `build-catalog` refuses to write
  an artifact whose counts drift from that snapshot without
  `UPDATE_BUILD_COUNTS=1`. That fallback is what lets a page state an exact
  figure at all — a value that vanishes on a fresh clone has to be worded
  around, and the wording is what goes stale.
- **Credited sources** — the `<div>` rows of the application's own Credits
  tab (`src/client/app/index.html`, `.modal-credits`). Adding a source to
  the app moves the homepage in the same build, with nobody counting.
- **Cited references** — distinct author-year citations across the two root
  docs plus every `*.md` under `docs/ src/ scripts/ data/`. The pattern
  matches only the multi-author forms (`Høg et al. 2000`,
  `Bland-Hawthorn & Gerhard 2016`), so single-author citations
  (Pace 2024, Tokovinin 2018, McConnachie 2012) are real references it
  cannot see. **The count is a floor on the record, never a measure of
  it** — which is the direction a public claim has to be wrong in. Widen
  the pattern and it starts matching ordinary prose ("Table 3 shows 2021"),
  which is the wrong direction.

## The walk

`../util/walk-files.ts`, shared with the repo-meta scanners in `tests/`.
`public/` and `node_modules` are skipped: the first is generated and the
second is not ours to cite.
