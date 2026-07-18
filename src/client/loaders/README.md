# Loaders

Runtime fetch + decode of the `public/` artefacts the build pipeline
emits. One file per artefact; each loader is the JS-side counterpart
of a builder under [`scripts/`](../../../scripts/README.md).

```
catalog-loader.ts        public/catalog-manifest.json + its
                         public/catalog.bin.<i> chunks +
                         public/constellations.json → Catalog (typed-array
                         views + name table). Fetches the manifest, then
                         all chunks in parallel, and reassembles via the
                         shared `assembleCatalogChunks` contract before
                         decoding (byte-range chunking clears Cloudflare
                         Workers' 25 MiB per-asset limit — see
                         scripts/catalog/README.md § On-disk transport
                         chunking). Layout + chunk helpers imported from
                         scripts/catalog/catalog-pure.ts — single source
                         of truth shared with the writer. Exposes
                         `varType: Uint8Array` for the runtime
                         pulsation-suppress gate (see
                         `../binaries/README.md` § Eclipse photometry) plus
                         the derived `pulsRho` / `pulsColorSwing`
                         (buildPulsationParams from varType — the per-type
                         radius/colour swing the star shader + disc mirror
                         read). Exposes `velocities: Float32Array` (count×3,
                         pc/yr) alongside `positions`; the epoch-advance
                         pass below consumes it. Exposes `sid: Uint32Array`
                         (frozen Stellata IDs, docs/sid.md § 7) — the star
                         domain of the SID resolver
                         (`../util/sid-resolver/README.md`) and the v4 URL
                         wire both key off it. Exposes
                         `multiplicityStatus: Uint8Array` (v9:
                         single/resolved/unresolved — see
                         scripts/catalog/README.md § Multiplicity status).
catalog-loader.test.ts   pin for layout decode + the BigUint64Array
                         source_id handling + the v8 velocity columns +
                         the v7 sid column + a full-record writer→reader
                         round-trip through the shared writeStarRecord.
epoch-advance-pure.ts    space-motion propagation:
                         `advancePositionsToEpoch(base, velocities,
                         epochJyr, out)` writes `p(J2016) + v·(t − 2016)`
                         (float64 math, float32 write-back) into `out`
                         from an immutable J2016.0 baseline. The Stellata
                         constructor snapshots that baseline and advances
                         catalog.positions before `_localPositions` is
                         derived, so every downstream consumer inherits
                         current-epoch positions by construction; the
                         per-frame `maybeReAdvanceEpoch` re-runs the same
                         pass whenever the (scrubbed) model clock crosses a
                         `bucketEpochJyr` bucket (1/20 Julian year —
                         sub-pixel drift per bucket even for Barnard's).
                         `jdeToJulianEpochYear` converts the model clock's
                         JD to the propagation's Julian-year base;
                         `maxSpeedPcPerYr` bounds scrub-range drift for
                         the load-epoch distance-window consumers;
                         `writeAdvancedLocal` forms one star's local-frame
                         position `(base + v·Δt) − origin` in float64 —
                         `BinaryOrbitField`'s per-frame reset uses it so a
                         drifting unfocused pair doesn't snap onto the float32
                         absolute grid (`../binaries/README.md` § Walk-active
                         LOD). Pure +
                         vitest-pinned; the sky-position corpus drives the
                         SAME function end-to-end. See
                         docs/science-catalog-ingestion.md §
                         Current-epoch star positions.
catalog-mock.ts          test-only Catalog factory. NaN-fills Apsis
                         fields, -1 companion, lumClass=255.
dust-loader.ts           public/dust/manifest.json + chunk_X_Y_Z.bin →
                         Data3DTexture (DustField). Progressive upload:
                         zero-fill GPU texture upfront, fetch chunks
                         priority-ordered, gl.texSubImage3D each as it
                         lands. Manifest is the contract with
                         scripts/dust/build-dust.py — both derive
                         gridSize / chunkSize / bounds / encoding from it.
                         Build-side counterpart: scripts/catalog/
                         dust-deextinction.ts reads the same artifact to
                         de-extinct absmag/ci (mirrored decode + integral).
```

## Where the other layer loaders live

The wiki rule for runtime fetch helpers is "live with the subsystem
that owns the layer's render code", so:

- `cloud-loader.ts` → [`src/client/molecular-clouds/`](../molecular-clouds/README.md)
  (`public/clouds.json` → `Cloud[]`).
- `local-group-loader.ts` → [`src/client/local-group/`](../local-group/README.md)
  (`public/local-group.json` → `LgObject[]`).

This folder holds only the cross-cutting loaders (`catalog` =
universally consumed, `dust` = read by the star pipeline shader, not
its own layer).

## Adding a loader

If a new artefact lives under `public/` and is consumed by a single
subsystem, the loader belongs in that subsystem's folder. Add it
here only when the artefact is consumed across multiple layers or
has no natural single owner.
