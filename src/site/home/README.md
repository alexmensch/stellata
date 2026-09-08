# Homepage — `/home`

The public case for Stellata: what it is, why its data is trustworthy, and
what to go and look at. Served at `https://stellata.xyz/home`; the build
seam that puts it there is `src/site/README.md`.

```
index.html   The whole page. No JavaScript, no build-time templating
             beyond Vite's %VITE_*% substitution.
```

## What the page has to make the reader take away

In this order, because the order is the argument:

1. A serious instrument, built for people who already know the sky.
2. Every object came from a published catalogue, and the page says which.
3. It shows what the eye would see from any point in the model — no false
   colour anywhere, perceptual modelling throughout.

§ 01's three numbered claims are those three, one each. Rewriting the copy
is expected; dropping one of the three is not.

## Where every number on the page comes from

Nothing here is typed from memory, and `tests/site-claims.test.ts` fails
when the page and its sources disagree.

- **34 catalogues cited**, and the per-subsystem counts in the § 02 table,
  are the credit rows in the application's own Credits tab
  (`src/client/index.html`, `.modal-credits`). The test counts them. Adding
  a source to the app means updating this page in the same PR.
- **100+ published references** is a floor on the distinct author-year
  citations across the modelling record — the two root docs plus every
  markdown file under `docs/`, `src/`, `scripts/` and `data/`. The test
  counts only the multi-author forms (`Høg et al. 2000`,
  `Bland-Hawthorn & Gerhard 2016`), so single-author citations are real
  references it cannot see and the true total is higher. It holds the
  page's claim below the derived figure and within one bucket of it, so
  the claim stays true as the record grows and fails once it is stale
  enough to be misleadingly modest.
- **390,000 objects** is rounded prose, which is the only form a human may
  write — `src/site/README.md` § Numbers in copy, and
  `docs/authoring-patterns.md` § The star count is never a literal.
- **6.5 million light years** and **3000 BC – 3000 AD** are the model's
  measured radius and clock clamp, both stated in `../../../README.md`.
- Distances, periods and physical claims in § 03 are the ones
  `../../../README.md` § Things to try already carries; that section is this
  section's source.

## Plates

Three figures, each a numbered plate captioned like an atlas rather than a
screenshot with a caption. **All three currently hold placeholders** — a
dashed hairline box carrying the intended subject, why that view is the one
that proves the claim beside it, and the target filename. The dashed border
is deliberate: an empty styled box would ship unnoticed.

To land a real capture:

1. Take the shot from the running app at 2400 px wide or more.
2. Save it as the filename the placeholder names, under `public/site/`.
   `public/` is Vite's `publicDir`, so the file is served at
   `/site/<name>` with no build step. Commit it — the SEO assets in
   `public/` (`og-image.jpg`, the icons) are committed the same way.
3. Replace the `<div class="plate-holder">…</div>` with
   `<img src="/site/<name>" alt="…" width="…" height="…" />`, leaving the
   `<figcaption>` alone. `.plate img` already carries the hairline border.
   Real `width`/`height` attributes matter — they reserve the space and
   keep the page's layout shift at zero.

The two views with an existing share URL carry it in the placeholder, so
the capture is reproducible rather than a one-off: plate 01 is the README
hero's composition, plate 03 the README chart-mode shot. Plate 02 (dust
extinction from a few kiloparsecs out) has no saved view; the recipe is in
`../../../README.md` § Watch the dust shape the sky.

Deriving smaller responsive variants and a `srcset` is worth doing once the
real images are in — a 2400 px JPEG is the largest thing on the page by an
order of magnitude, and it is the one lever on the page's largest
contentful paint.

## SEO decisions taken here

- **Self-referencing canonical** at `https://stellata.xyz/home`, and the
  page is listed in `public/sitemap.xml` and `public/llms.txt`.
- **The JSON-LD graph reuses the app's `@id`s** — `https://alxm.me/#person`
  and `https://stellata.xyz/#webapp` — deliberately. Both pages describe
  the same two entities, so the identifiers and the `description` string
  must stay identical between here and `src/client/index.html`; a
  divergence tells a crawler there are two applications.
- **`WebPage.citation`** lists seven of the marquee sources with their
  DOIs. It is the structured-data form of the page's own central claim,
  and the reason the node is a `WebPage` rather than only a
  `WebApplication`.
- **Zero JavaScript**, so the page is fully present in the initial HTML for
  crawlers that do not execute script — including the AI crawlers
  `public/robots.txt` opts in by name.

## Two things a future session should not have to rediscover

**`/home` is not the site's root, and that is an open question rather than
a settled design.** `/` serves the application, so `/` is where every
inbound link, share URL, citation and search result already lands, and this
page competes with it for the same intent. The conventional arrangement is
the reverse — marketing at `/`, app at `/app`. What that move would cost,
and the recommendation, are written up in `stellata-2h0e.2`; it is a
product decision about where a first-time visitor should land, so it is not
one to take while editing this file.

**The page has no inbound internal link.** Nothing in the application links
to `/home`, so a crawler reaches it only through the sitemap, and a visitor
only through a shared link. One link from the app — the brand box's
`about` / `share` row, or the About modal's footer — would fix it, but
adding an affordance to the app's chrome is the user's call, not a side
effect of a marketing page. Tracked on `stellata-2h0e.5`.
