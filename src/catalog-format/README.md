# catalog-format

What the build pipeline (`scripts/`) writes and the viewer (`src/client/`)
reads: the catalogue record layout and its codec, the artefact schemas,
and the rules both sides apply to a record's fields — its display name, its
search labels, its spectral class and radius. Also the names of the files
the pipeline writes for itself, because the step table may import nothing
else at load (`pipeline-outputs/`).

**It imports nothing outside itself but `/src/astro-core/`** — no `scripts/`,
no `src/client/`. The viewer reaches pipeline code only through this tree,
so a contract the two sides share has one statement, and the tree lifts
into its own workspace package unchanged.

## Subfolders

Each has its own README.

- `record/` — the v10 `catalog.bin` layout and both directions of its codec,
  the record order, the transport chunk plan, the `search-index.json` wire
  entry.
- `naming/` — the display-name composer, the Greek spellings it reads, and
  the search corpus built from the same strings.
- `spectral/` — the Morgan-Keenan parser and the Stefan-Boltzmann radius
  chain.
- `boundaries/` — the `constellation-boundaries.json` wire shape, its
  quantisation and fade statistics.
- `ephemerides/` — the planet element tables: roster, wire schema,
  sampler, public file names.
- `probes/` — the probe trajectories: roster, wire schema, public file
  names.
- `local-group/` — the `local-group.json` schema: object row, emission
  block, version, distance envelope.
- `public-artifacts/` — the name of every other file and folder under
  `public/` the viewer fetches, imported by the viewer and every TypeScript
  writer.
- `baker-artifacts/` — the versions, magic and encode ranges of the
  artifacts the Python bakers write, and the header gate their loaders open
  with.
- `pipeline-outputs/` — where the files the pipeline writes and the viewer
  never fetches land: the names an outputs module declares.
