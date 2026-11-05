# binaries.bin golden

Pins the runtime encoder (`../runtime-binaries-pure.ts`,
`encodeRuntimeBinaries`) byte for byte, with no catalogue build and no LFS
data, so any restructuring of it can prove it writes the same
`public/binaries.bin`.

- `fixture-multiples.tsv` — every `multiples.tsv` row of 24 WDS systems,
  in the real file's column order. Chosen so every pair count is
  nonzero: both unresolved drops, degenerate-index, same-relation alias
  (18025+4414) and duplicate-relation (θ¹ Ori, 05353-0523) drops, orbit and
  inclination flags, and hierarchy nesting (Algol 03082+4057, Castor
  07346+3153, Acrux 12266-6306). 04049-3527 carries the synth re-home of a
  pair-mate's inherited source (C onto `synth-04049-3527-C`).
- `fixture-row-index-map.json` — the real `build/catalog-row-index-map.json`
  cut down to the gaia / hip ids those rows carry and the `synth-<wds>-`
  keys of those systems. Row indices are the real ones, so the drops and
  re-homes are the ones the full build makes. Its `multiplesSha1` is the
  fixture `multiples.tsv`'s own, which the test holds it to.
- `cut-fixture.ts` (+ `cut-fixture-pure.ts`, its cut and test) — writes both
  fixtures from the real `multiples.tsv` and a built row-index map.
  `FIXTURE_SYSTEMS` is the system list; the test holds the committed
  fixture to it.
- `binaries.golden.bin` — the encoder's output on the two fixtures:
  54 pairs.
- `/tests/integration/binaries-bin-golden.test.ts` — runs the encoder on the
  fixtures, pins its counts (every one nonzero), and compares against the
  golden, naming the first differing record and field; then parses the
  golden with the client loader (`src/client/binaries/binaries-loader.ts`)
  so writer and reader agree.

The fixtures are frozen inputs: the golden pins the encoder, not the current
data. The test reads the fixture through the `MULTIPLES_TSV` codec, which
requires the real file's exact header, so a column `multiples.tsv` gains has
to reach the fixture too. When the encoder does not read it, add it to the
existing rows with the real file's values and set the map's `multiplesSha1`
to the edited file's sha1: the golden stands. Re-cut
(`tsx scripts/binaries/golden/cut-fixture.ts`, which needs the LFS
`multiples.tsv` and a built catalogue) only when the encoder starts reading
a new column or `FIXTURE_SYSTEMS` changes; the cut takes the current row
indices, so re-baseline the golden in the same commit. When a change is
meant to alter the bytes, re-baseline with `UPDATE_BINARIES_GOLDEN=1` (the
failing test prints the full command) and say so in the commit. A missing
golden fails; the env var is the only writer.
