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
                         chunking). Layout, chunk and record-decode
                         helpers imported from
                         scripts/catalog/catalog-pure.ts — single source
                         of truth shared with the writer and the Node
                         AoS reader; the per-record decode is
                         column-at-a-time via decodeRecordColumn (see
                         scripts/catalog/README.md § Binary catalog
                         format). Exposes
                         `varType: Uint8Array` for the runtime
                         pulsation-suppress gate (see
                         `../binaries/eclipse/README.md`) plus
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
                         scripts/catalog/multiplicity/README.md § Multiplicity status).
catalog-loader.test.ts   pin for layout decode + the BigUint64Array
                         source_id handling + the v8 velocity columns +
                         the v7 sid column + a full-record writer→reader
                         round-trip through the shared writeStarRecord.
epoch-advance-pure.ts    space-motion propagation:
                         `advancePositionsToEpoch(base, velocities,
                         epochJyr, out)` writes `p(J2016) + v·(t − 2016)`
                         (float64 math, float32 write-back) into `out`
                         from an immutable J2016.0 baseline. `StarFrame`
                         (`../star-pipeline/star-frame/README.md`)
                         snapshots that baseline and advances
                         catalog.positions before `localPositions` is
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
                         priority-ordered, hand each to the voxel uploader
                         as it lands (§ Dust voxel upload). Manifest is
                         the contract with
                         scripts/dust/build-dust.py — both derive
                         gridSize / chunkSize / bounds / encoding from it.
                         Build-side counterpart: scripts/catalog/
                         dust-deextinction.ts reads the same artifact to
                         de-extinct absmag/ci (mirrored decode + integral).
dust-voxel-upload.ts     Landing one chunk inside the volume texture —
  (+ test)               the single step the dual boot splits per backend
                         (§ Dust voxel upload). Also owns
                         `createVoxelTexture` (every voxel texture, volume
                         and staging alike) and `isWebGpuRenderer`, the
                         backend test both dust-voxel modules branch on.
dust-voxel-readback.ts   Reading voxels back off the GPU and comparing
  (+ test)               them against the chunk files — the numeric smoke
                         behind `stellata.verifyDust()`
                         (§ Dust voxel readback).
dust-renderer-mock.ts    Recording WebGL2 / WebGPU renderer stand-ins,
                         enough surface for the upload and readback tests
                         to run headless.
```

## Dust voxel upload

`DustField` owns the ~128 MiB volume texture, the priority-ordered fetch,
the progress listeners and the dispose. The only backend-specific step is
writing one chunk's bytes inside the volume, and
`createVoxelChunkUploader` picks that per renderer.

**The factory marks the volume for update and then calls
`renderer.initTexture`, in that order, and owns both halves so a caller
cannot get the order wrong.** A partial write needs storage to target, and
three's WebGPU backend hands any texture it has not seen marked for update
a *shared* 1×1 2D placeholder — which it then refuses to grow, because the
version never moved. The visible result is not a dim sky: the first chunk's
own update throws `Texture already initialized`, `startLoading`'s
per-chunk catch swallows it, and every chunk logs
`dust chunk … failed` while the sky stays dust-free.

An uploader also stops writing once disposed. Chunk fetches outlive a
`DustField.dispose()`, and on WebGPU a write to a released texture walks
three's create-on-demand path and resurrects the whole volume.

- **WebGL2** — `gl.texSubImage3D` straight at the chunk's grid offset.
  Each chunk clears UNPACK_FLIP_Y / PREMULTIPLY / ALIGNMENT through
  `renderer.state` and never on the raw context: three's state cache
  suppresses a call whose tracked value already matches, so a raw poke
  desyncs that cache from GL and the NEXT flipY 2D upload anywhere in the
  app lands mirrored with no other symptom.
- **WebGPU** — three's backend exposes no sub-region texture write, so a
  chunk-sized staging `Data3DTexture` takes the bytes as a whole upload
  and `renderer.copyTextureToTexture` moves them into the volume's
  region. That staging texture is reused across chunks and **must be
  re-marked `needsUpdate` every time** — three's texture cache
  short-circuits on an unchanged version, and the copy would then re-land
  the previous chunk's bytes at the new offset. Both it and the volume come
  from `createVoxelTexture`, because WebGPU rejects a copy between differing
  formats and a hand-copied format is a format that can drift.

Chunk bytes are z-major with x innermost per the Python writer, which is
what both backends read as width/height/depth.

The star vertex raymarch and the extinction prepass sample the volume on
a WebGPU boot as of `0it.4.6` / `0it.20`
(`../webgpu/extinction/README.md`); the band's measured dust stack joins
them at `0it.5`. Before those landed a WebGPU boot streamed a texture no
pixel read — the migration's intended ordering, since each port is
smoke-blind without dust already in the texture — and § Dust voxel
readback is still how the upload itself is verified, independently of any
sampler.

**The marking rule above binds every 3D texture bound in a TSL graph, not
just the volume.** A `texture3D()` node over an unmarked placeholder gets
three's shared 1×1 **2D** substitute, which puts a 2D view on a
`texture_3d` binding: the bind group fails validation, and an invalid
bind group takes the entire submit with it — every layer in that scene
stops drawing, not just the sampler's own. Chrome reports it as
`Invalid TextureView … viewDimension: TextureViewDimension::e3D` and
recovers once a marked texture is swapped in; Safari 26 renders nothing
and logs nothing. `createVoxelTexture` does not mark, on purpose — that
is the uploader's job, paired with `initTexture` — so anything building a
placeholder from it marks its own.

## Dust voxel readback

`stellata.verifyDust()` answers "is the dust actually in the texture, at
the offset the uploader claimed?" numerically, because on a WebGPU boot no
pixel can answer it and on WebGL2 the answer arrives as a dim sky that
looks the same whether one chunk or sixty landed. It re-fetches chunk
files (served from cache) and compares sampled voxels against what the GPU
holds.

- **Samples are the chunk's 8 corners plus its densest run.** Corners are
  where a wrong grid offset or a transposed axis shows up; the densest run
  guarantees non-zero evidence, since empty space reads as zero on a
  working upload and a broken one alike. `nonZeroExpected` in each report
  is that guarantee made visible — at zero, the samples prove nothing.
- **A readback that cannot work throws instead of reporting zeros**, for
  the same reason: on WebGL2 an incomplete framebuffer and genuinely empty
  dust are both a buffer full of zeros.
- **WebGL2** reads by attaching the volume's z-slice to a framebuffer
  (`framebufferTextureLayer`) and calling `readPixels` as RGBA — the one
  combination WebGL2 accepts for every normalised colour buffer. The bind
  goes through `renderer.state`, same cache rule as the upload's
  pixel-store resets.
- **WebGPU** has no public readback for a plain texture
  (`readRenderTargetPixelsAsync` only takes a RenderTarget), so it calls
  the backend's own `copyTextureToBuffer`, whose `faceIndex` argument is
  the 3D texture's z origin. That is the one place either dust-voxel
  module reaches past three's public surface.
- **Reads are 4 voxels wide along x.** WebGPU rejects a buffer mapping
  whose range is not a multiple of 4 bytes, so a single-texel readback is
  not available and both backends read a run for symmetry.

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
