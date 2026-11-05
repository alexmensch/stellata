# binaries — the `binaries.bin` wire layout

`binaries-format.ts` is the v1 `BIN1` layout of `public/binaries.bin`: one
fixed-size record per physical pair. Its writer (`build:binaries-runtime`,
[Runtime side artifact](/scripts/binaries/README.md#runtime-side-artifact))
and the viewer's loader (`/src/client/binaries/binaries-loader.ts`) both
read every offset and flag from it. `BINARY_ELEMENT_KEYS` is the one list of
a record's orbital elements and WDS geometry (`BinaryElements`), which the
writer's pair and row types are built from. `encodeBinaries` turns
`BinaryRecord`s (absent elements null) into the file's bytes; the writer and the loader's
tests both encode through it.

- Header (`HEADER_SIZE`, 16 B; `HEADER_LAYOUT`): `MAGIC` (`BIN1`), uint32
  `VERSION`, uint32 record count, 4 B reserved. Little-endian throughout.
- Record (`RECORD_SIZE`, 72 B): `RECORD_LAYOUT` gives each field's byte
  offset and wire type, keyed by its record property; `encodeBinaries` and
  `decodeBinaryRecord` both walk it, so neither spells an offset or a type. Indices and flags are uint32, `parent_relation` int32 (`NO_PARENT`,
  -1, for a top-level pair), `P_days` / `T_jd` float64, every other element
  float32. A missing element is NaN. `sep_pa_epoch_jd` is stored as
  `JD − J2000_JD`, so float32 keeps about a minute of precision; the loader
  adds `J2000_JD` back. The trailing 4 B are reserved.

Flag bits on each record:

- `FLAG_HAS_ORBIT` (`0x1`) — every element the orbit walk consumes is
  present: P, T, e, a, ω, q. Ω is optional (the walk falls back to 0; only
  Tier 1 reads it). `hasRenderableOrbit` is that rule over a row's element
  cells: the writer sets the bit by it, so a record carrying it is
  Kepler-evaluable, and the catalogue build's orbit-aware passes ask it
  the same question.
- `FLAG_HAS_INCLINATION` (`0x2`) — `i_rad` is valid; set only with
  `FLAG_HAS_ORBIT`. Unset, the walk uses the galactic-Z orbit normal
  ([Tier mapping](/src/client/binaries/README.md#tier-mapping)).
- `FLAG_IS_INNER_OF_HIERARCHY` (`0x4`) — the pair sits inside another (Algol
  Aa1,Aa2 inside Aa,Ab); `parent_relation` is the outer pair's record index.

Records are written outer-before-inner, so `parent_relation` is always below
the child's own index and one forward pass evaluates parents first.
