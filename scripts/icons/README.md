# scripts/icons

Draws the site icon set — a glowing star on a dark-blue sky — into
`public/`.

`build-icons.py` (`pnpm run build:icons`) draws a supersampled master
with PIL (Pillow) and downsamples it to the committed brand assets:
`favicon-16/32/48.png`, `apple-touch-icon.png` (180), `icon-192.png`,
`icon-512.png`, and multi-resolution `favicon.ico`. The design is
defined in code (no SVG source) so raster and vector can't drift.

Not part of `pnpm run build` — regenerate only when the icon design
changes.
