# public-artifacts — the names the build ships

`public-artifacts.ts` names every file and folder the build writes under
`public/` and the viewer fetches. The viewer appends a name to its base URL;
a TypeScript writer resolves it under `PUBLIC_DIR`. Each name is spelled here
and nowhere else in TypeScript, so a rename is one edit and a writer cannot
drift from the URL its reader fetches.

- `PUBLIC_FILES` — the single-file artifacts: `constellations.json`,
  `search-index.json`, `constellation-boundaries.json`, `binaries.bin`,
  `local-bubble.bin`, `cloud-surfaces.bin`, `clouds.json`,
  `local-group.json`.
- `PUBLIC_FOLDERS` — the mirrored folders: `dust/`, `probes/`,
  `ephemerides/`, `textures/`. What each mirror copies is its own allowlist
  (`isProbePublicAsset`, `isPlanetElementPublicAsset`, the dust and texture
  predicates).
- `DUST_MANIFEST` — the dust folder's index, `dust/manifest.json`: the one
  folder member with a fixed name, so the dust allowlist, the grid's source
  declaration and the dust loader all import it from here.
- `publicRepoPath` — a name as a repo-relative `public/…` path, the form the
  step table and the mirrors declare outputs in.

Owned elsewhere, by the contract they belong to:

- **The catalogue** — `catalog-manifest.json` and the `catalog.bin.<i>`
  chunks are part of the chunk-reassembly contract,
  [`../record/README.md`](../record/README.md#on-disk-transport-chunking).
- **Rostered mirror members** — a probe trajectory or planet element table
  is named by `probeTrajectoryFilename` / `planetElementFilename` beside its
  roster; a dust chunk or texture by its mirror's member pattern.
- **`data/` inputs** — the committed file a sync copies is a source
  declaration (`scripts/*/…-source.ts`); where a mirror keeps the public
  name, that declaration builds its path from the name here.

Python writers (`build-clouds.py`, `build-runtime-binaries.py`, the bakers)
still spell their output names themselves.

`tests/public-artifact-names.test.ts` holds the invariant: no TypeScript
string literal under `src/` or `scripts/` outside this folder spells one of
these names, nor a catalogue chunk name outside `record/`.
