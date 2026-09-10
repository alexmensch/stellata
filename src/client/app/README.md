# The application document

```
index.html   The app's only HTML document. Vite's build input.
```

## Why one file has a folder to itself

**Vite emits an HTML input at its own path relative to the config's
`root`, and that path is the URL it serves at.** `root` is `src/client`,
so this file emits at `dist/app/index.html` and Cloudflare's static-assets
layer serves it at `/app`. Move the file and you move the application's
address — nothing else decides it. `/` is the public homepage
(`src/site/README.md`), which is why the two documents cannot both sit at
their build root.

Its siblings stay in the parent folder: `<script src="../main.ts">` and
`<link href="../styles.css">` climb one level, and Vite rewrites both to
hashed absolute `/assets/…` URLs at build time.

**`base` stays `/`, and that is load-bearing rather than incidental.**
Every runtime artifact fetch in the client is
`` `${import.meta.env.BASE_URL}<file>` `` — the catalogue chunks, the dust
grid, textures, probes, ephemerides, the search index. A `base` of
`/app/` would send all of them to `/app/catalog.bin.0`, where nothing is
served, and would put `robots.txt` at a path no crawler reads. So the
document alone lives under `/app`; its assets and every artifact stay at
the root.

## In dev, this document answers at `/app`

`pnpm run dev` serves it at **`http://localhost:5173/app`** — and serves
the public homepage at `/` and the 404 page for anything else, so one
server answers the deploy's whole URL space. `vite.site-dev.ts` is the
dev-only plugin doing that; `src/site/README.md` § Reading it in dev is the
reference.

Artifacts are unaffected: `publicDir` still serves `public/` at the dev
root, so `BASE_URL`-relative fetches resolve exactly as in production.

**One dev-only rewrite worth knowing about.** This document's
`../main.ts` and `../styles.css` are made root-absolute before being
served. The build does that itself, hashing them into `/assets/`; dev
serves the file as authored, so the browser would resolve them against
whatever URL it is on — and on a share link (`/app/v/<blob>/`) that is
three levels deep, where `../main.ts` is nothing. A third relative
reference added here needs the same treatment.

## What the `<head>` owns

The SEO surface: title, description, canonical (`https://stellata.xyz/app`),
OpenGraph and Twitter cards, the favicon and manifest links, and a
Schema.org JSON-LD graph. **The `Person` and `WebApplication` nodes are
shared with the homepage** — same `@id`s, same `description` string — so a
crawler resolves one application described twice rather than two
applications. Editing either node here means editing it in
`src/site/index.html` in the same change; `src/site/README.md` § The
homepage's claims carries the rule.

The `@id`s keep the bare-root form (`https://stellata.xyz/#webapp`). An
`@id` is an identifier, not an address — it does not have to equal the
node's `url`, and churning it would break the association for anything
that already recorded it.

## What the `<body>` owns

The whole static DOM the app animates: the canvas, the SVG overlay, every
panel, modal and HUD container. Two properties a reader has to know before
editing it:

- **Source order inside `#overlay` is paint order** — later children sit on
  top. `src/client/README.md` § Full render stack is the authority on which
  layer wins which pixel, and the ordering there is this file's ordering.
- **The `<noscript>` block is the crawler and no-JavaScript fallback**, and
  it is the only prose about the project inside the application. It is not
  decoration: it is what a scripting-disabled visitor and some indexers
  read.
