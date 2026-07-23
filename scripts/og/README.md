# scripts/og

Composites the Stellata wordmark onto a captured app frame to produce
the OpenGraph / Twitter share card `public/og-image.jpg` (1200×630).

- `og-source.jpg` — the raw app capture (bottom band left open for the
  wordmark). The regenerate-from source; keep it so the card can be
  rebuilt or restyled.
- `build-og.py` (`pnpm run build:og`) — crops the source to 1200×630
  (preserving the open bottom band), stamps "STELLATA" in the in-app
  brand style (uppercase SF Mono, 0.3em tracking, near-white with a
  soft dark halo for legibility), and writes the optimized JPG.

The committed defaults reproduce the shipped card; flags
(`--size`, `--tracking`, `--y`, `--tagline`, `--out`) exist for
restyling. Needs a macOS system monospace font (SF Mono / Menlo);
runs locally, not in the build chain — the output is committed.
