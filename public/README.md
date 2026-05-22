# Generated artifacts

All files in `public/` are produced by the build pipeline and gitignored.
The dev / production build regenerates them from `data/` + `scripts/`.

```
catalog.bin             ~24 MB binary v6 — see scripts/README.md
                        § Binary catalog format for the layout.
constellations.json     IAU constellation table + figure lines.
search-index.json       ~13 MB raw, ~2 MB gzipped — name / Bayer /
                        constellation lookups for the typeahead.
clouds.json             ~30 KB — Zucker 2020/2021 cloud ellipsoids.
local-group.json        ~20 KB — LVDB + overrides → wireframe records.
dust/                   mirror of data/dust/ for the (shelved) dust
                        layer's runtime fetches.
```

`assets/` (Vite-emitted JS/CSS bundles) lands under this folder too at
build time; the Cloudflare Worker (`src/worker.ts`) passes every
request through `env.ASSETS.fetch(request)`. See `src/README.md`
§ Deployment for Wrangler config.
