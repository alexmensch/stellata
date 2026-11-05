# public-artifacts — the names the build ships

`public-artifacts.ts` names every file and folder the build ships and the
viewer fetches. The viewer appends a name to its base URL; a TypeScript
writer places it under `public/` with `scripts/util/paths.ts`'s
`publicFile` / `publicRepoPath`. Each name is spelled here
and nowhere else in TypeScript, so a rename is one edit and a writer cannot
drift from the URL its reader fetches.

- `PUBLIC_FILES` — the single-file artifacts: `constellations.json`,
  `search-index.json`, `constellation-boundaries.json`, `binaries.bin`,
  `local-bubble.bin`, `cloud-surfaces.bin`, `clouds.json`,
  `local-group.json`.
- `PUBLIC_FOLDERS` — the mirrored folders: `dust/`, `probes/`,
  `ephemerides/`, `textures/`. What each mirror copies is its own output
  declaration (`scripts/<layer>/<layer>-mirror-outputs.ts`), built from the
  names here.
- `DUST_MANIFEST` — the dust folder's index, `dust/manifest.json`: the one
  folder member with a fixed name, so the dust mirror, the grid's source
  declaration and the dust loader all import it from here. `DUST_CHUNK` is
  the chunk name pattern, the family both the dust bake and its mirror
  declare.
- `TEXTURE_MEMBERS` — the three texture name patterns (colour-map rungs,
  ring strips, relief maps): the texture bake's families under
  `data/textures/` and the mirror's under `public/textures/`.
- `rosterFileName(id)` — a rostered folder member's name: each probe
  trajectory and planet element table, over its roster's ids, the one name
  the fetch writes, the mirror copies and the loader fetches.

Owned elsewhere, by the contract they belong to:

- **The catalogue** — `catalog-manifest.json` and the `catalog.bin.<i>`
  chunks are part of the chunk-reassembly contract,
  [`../record/README.md`](../record/README.md#on-disk-transport-chunking).
- **`data/` inputs** — the committed file a sync copies is a source
  declaration (`scripts/*/…-source.ts`); where a mirror keeps the public
  name, that declaration builds its path from the name here.

The four names a Python baker writes or reads — `local-bubble.bin`,
`cloud-surfaces.bin`, `clouds.json` and the dust manifest — come from the
artifact blocks of `/src/astro-core/baker-constants.json`
([`../baker-artifacts/`](../baker-artifacts/README.md)), which the bakers read
too; `PUBLIC_FILES` and `DUST_MANIFEST` take them from there.

`tests/public-artifact-names.test.ts` holds the invariant: no TypeScript
string literal under `src/` or `scripts/` outside this folder spells one of
these names, nor a catalogue chunk name outside `record/`.
