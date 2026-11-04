# baker-artifacts — the layouts the Python bakers write

`baker-artifacts.ts` is the typed view of the artifact blocks of
`/src/astro-core/baker-constants.json`
([Baker constants](/src/astro-core/README.md#baker-constants)), read
through astro-core's `BAKER_CONSTANTS` so the file keeps one importer. The
Python bakers that write each artifact read the same blocks.

- `CLOUDS_JSON_SCHEMA`, `DUST_MANIFEST_SCHEMA` — the version each JSON
  artifact's loader accepts.
- `ZUCKER_PROFILED_SCHEMA` — the profiled clouds' column-check inputs,
  the one JSON artifact running the other way: `build:clouds`
  (TypeScript) writes it and `build-dust.py` refuses another version
  ([Outputs](/scripts/clouds/README.md#outputs)).
- Every schema's `fileName` — the name its baker writes, which
  `../public-artifacts/` re-exports as the name the viewer fetches.
- `CLOUD_SURFACES_SCHEMA`, `LOCAL_BUBBLE_SCHEMA` — magic and version of
  the two binaries.
- `checkBinaryHeader(view, schema, file)` — the magic-and-version gate every
  baker-written binary's loader opens with: four ASCII magic bytes, then a
  uint32 LE version. It throws on either mismatch, so a loader never reads
  a layout it was not written for. `writeBinaryHeader` is its fixture twin.
- `HORIZON_AZIMUTHS`, `HORIZON_SIN_RANGE`, `SKY_VIEW_RANGE` — the
  encodings of the horizon and sky-view relief maps, which the texture
  build writes and the mesh shader decodes.
