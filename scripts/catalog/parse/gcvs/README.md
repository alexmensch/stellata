# GCVS variability cross-match

Parsing `data/gcvs/` and cross-matching it onto catalog records: which
stars are named as variables, and which of those carry a period the
renderer can pulsate. Consumed by `build-catalog.ts` only; the row walk
that owns everything else about a record is `../README.md`.

## Files in this area

```
scripts/catalog/parse/gcvs/
  gcvs-parse.ts (+ test)   parseGcvsMain / parseGcvsCrossref (the two
                           frozen-file readers), bridgeGcvsByGaia, and
                           applyVariability — the post-sort walk that
                           attaches names and pulsation.
```

`parseGcvsMain` + `parseGcvsCrossref` in `build-catalog.ts` read two
files from `data/`:

- `gcvs5.txt` — pipe-delimited fixed-width; we pull the GCVS designation,
  period (days), and magnitude amplitude (from max-mag / min-mag-I).
  Rows without a parseable period, or with zero amplitude, are skipped
  (constant stars, supernovae, irregular variables we can't render
  periodically).
- `crossid.txt` — maps foreign-catalogue IDs (`Hip nnnn`, `HD nnnn`, …)
  to GCVS designations. Only `Hip` and `HD` are extracted since AT-HYG
  carries those.

`applyVariability` then walks the post-sort catalog and for each star
resolves a GCVS name (gaia_source_id first, then HIP, then HD), then
looks up the period+amp. Two independent gates:

- **Naming** (search) — the resolved designation is attached as
  `gcvsName` whenever a name resolves (~14.1k stars, `gcvsNamed`). This
  is the `search-index.json` `g` field. The designation's trailing
  abbreviation also sets `desigConIndex` where it disagrees with AT-HYG's
  `con` cell (`../README.md` § Positional constellation membership).
- **Rendering** (pulsation) — period / amplitude / varType apply only
  when the GCVS main table gave that name a parseable period+amplitude
  (~4.1k, `gcvsMatched`). Aperiodic variables — flare stars
  (Proxima = V0645 Cen), RCB (R CrB), irregular (T Tau), novae
  (V1500 Cyg) — are named for search but never pulsate.

Most catalog stars aren't variable, but the ones that are tend to be the
astronomically interesting ones (Betelgeuse, Mira, Algol, Cepheids, etc.).

Each row's `varType` comes from `classifyGcvsVarType` (`../../catalog-pure.ts`):
GCVS EA/EB/EW/ELL/E → `VAR_TYPE_ECLIPSING`, the pulsator families →
`VAR_TYPE_PULSATING`, everything else → `VAR_TYPE_OTHER`. A bare
transiting-planet host (GCVS EP with no superimposed intrinsic
pulsator, `isPlanetaryTransitOnly`) is dropped from the cross-match
entirely — its dip is extrinsic occlusion by a planet, not the star's
own output, and it is not a stellar multiple, so it earns neither an
intrinsic-variable ring/pulse nor multi-star wings and renders as an
ordinary star. `EP+DSCT` and the like keep the pulsator's ring.
Eclipsing binaries are extrinsically variable, so after the CCDM pass a
sweep ORs `FLAG_BINARY_PRIMARY` (the chart-mode wings bit) onto
every `VAR_TYPE_ECLIPSING` record not already flagged
(`eclipsingWinged` in build-counts); the runtime also suppresses their
cosmetic pulsation by this byte alone. They surface as multi-star
systems, never intrinsic-variable rings. (A fourth wings pass,
`wingRenderablePrimaries`, then covers physical pairs none of these three
reach — see `../../companions/record-index/README.md`
§ Renderable-companion wings.)

Both GCVS files are tracked via Git LFS rather than downloaded at build
time — they update rarely (yearly-ish). If bumping to a new GCVS
version, re-download from http://www.sai.msu.su/gcvs/ and replace the
existing files; LFS handles the large-blob storage on push.
