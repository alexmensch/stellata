# GCVS 5.1 — General Catalogue of Variable Stars

Periodic-variable amplitudes + periods + cross-IDs. Drives the
~3.7k variable stars that pulsate in the renderer (sinusoidal
magnitude modulation + matching disc-radius factor).

```
gcvs5.txt      ~14 MB, LFS. Main catalogue (pipe-delimited fixed-width).
crossid.txt    ~12 MB, LFS. Hip/HD/Tyc/etc. → GCVS name mappings.
```

## Provenance

- **Maintainers**: Samus N. N., Kazarovets E. V., Durlevich O. V.,
  Kireeva N. N., Pastukhova E. N. and team at the Sternberg
  Astronomical Institute, Moscow.
- **Distribution**: http://www.sai.msu.su/gcvs/gcvs/.
- **Licence**: Free for research and educational use with
  attribution; cite Samus et al. 2017, *Astronomy Reports* 61, 80.
- **Cadence**: yearly-ish; update by fetching the latest text files
  from the SAI mirror and replacing the files in place.

## Ingest

`scripts/catalog/gcvs-parse.ts`:

- `parseGcvsMain` extracts GCVS designation, period (days), and
  magnitude amplitude (max-mag → min-mag-I) per row.
- `parseGcvsCrossref` reads `crossid.txt`; only `Hip` and `HD`
  prefixes are extracted since AT-HYG carries those.
- `applyVariability` walks the post-sort catalog and looks up each
  star by HIP first, HD fallback.
- Rows without a parseable period, or with zero amplitude, are
  dropped (constant stars, supernovae, irregular variables we can't
  render periodically).

## Consumed by

- `scripts/catalog/build-catalog.ts` (encodes period + amplitude
  into v6 record bytes 36–39).
- `scripts/binaries/build-binaries.py` Stage 1 (variability flags
  on per-component rows in `multiples.tsv`).
