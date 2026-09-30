# binaries.bin golden

Pins the runtime encoder (`../build-runtime-binaries.py`, `encode()`)
byte for byte, with no catalogue build and no LFS data, so any port or
restructuring of it can prove it writes the same `public/binaries.bin`.

- `fixture-multiples.tsv` — every `multiples.tsv` row of 24 WDS systems,
  in the real file's column order. Chosen so every `WriteStats` counter is
  nonzero: both unresolved drops, degenerate-index, same-relation alias
  (18025+4414) and duplicate-relation (θ¹ Ori, 05353-0523) drops, orbit and
  inclination flags, and hierarchy nesting (Algol 03082+4057, Castor
  07346+3153, Acrux 12266-6306). 04049-3527 carries the synth re-home of a
  pair-mate's inherited source (C onto `synth-04049-3527-C`).
- `fixture-row-index-map.json` — the real `build/catalog-row-index-map.json`
  cut down to the gaia / hip ids those rows carry and the `synth-<wds>-`
  keys of those systems. Row indices are the real ones, so the drops and
  re-homes are the ones the full build makes.
- `cut-fixture.ts` (+ `cut-fixture-pure.ts`, its cut and test) — writes both
  fixtures from the real `multiples.tsv` and a built row-index map.
  `FIXTURE_SYSTEMS` is the system list; the test holds the committed
  fixture to it.
- `binaries.golden.bin` — the encoder's output on the two fixtures:
  54 pairs.
- `binaries-bin-golden.test.ts` — runs `encode()` through `python3`, pins
  its `WriteStats` (every counter, each nonzero), and compares against the
  golden, naming the first differing record and field; then parses the
  golden with the client loader (`src/client/binaries/binaries-loader.ts`)
  so writer and reader agree.

The fixtures are frozen inputs: the golden pins the encoder, not the current
data. Re-cut them (`tsx scripts/binaries/golden/cut-fixture.ts`, which needs
the LFS `multiples.tsv` and a built catalogue) only when the encoder starts
reading a column the fixture lacks, or `FIXTURE_SYSTEMS` changes; the cut
takes the current row indices, so re-baseline the golden in the same commit.
When a change is meant to alter the bytes, re-baseline with
`UPDATE_BINARIES_GOLDEN=1` (the failing test prints the full command) and say
so in the commit. A missing golden fails; the env var is the only writer. When
the encoder moves to TypeScript, the test drives the TS encoder on the same
fixtures against the same golden.
