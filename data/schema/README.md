# Baker constants

`constants.json` is the one spelling of every fact the Python asset bakers
(dust, cloud surfaces, Local Bubble, textures, and the cloud model behind
`build-clouds.py`) share with TypeScript. Neither language owns a copy:
TypeScript reads it through `src/client/util/baker-constants.ts`, Python
through `scripts/util/baker_constants.py` (`CONSTANTS`, a plain
`json.load`).

Not external data, and nothing here is frozen: a value changes by editing
this file, after which every reader agrees by construction. A value that
is a property of one artifact — a build parameter the client needs to
read that artifact back — travels in the artifact instead, written by its
baker; this file holds what both sides need *before* any artifact exists.

## Adding a fact

1. Add the key here, camelCase, units in the name (`…Deg`, `…Km`, `…Pc`).
2. Export it from `baker-constants.ts` under an explicit readonly type —
   the wrapper is the only TypeScript module that imports the JSON.
3. Read it in Python from `CONSTANTS`. A Python entry point puts the repo
   root on `sys.path` so `scripts.util` imports.
4. Delete the old copies on both sides in the same commit.

## Blocks

| Key | What | TS readers | Python readers |
|---|---|---|---|
| `galacticFrame` | J2000 IAU galactic centre and north pole, ICRS degrees | `galactic/galactic-coords.ts` | `scripts/clouds/cloud_model.py` |
