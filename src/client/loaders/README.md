# Loaders

Runtime fetch + decode of the `public/` artefacts the build pipeline
emits. One file per artefact; each loader is the JS-side counterpart
of a builder under [`scripts/`](../../../scripts/README.md).

```
catalog-loader.ts        public/catalog-manifest.json + its
                         public/catalog.bin.<i> chunks +
                         public/constellations.json → Catalog (typed-array
                         views + name table). Fetches the manifest, then
                         the chunks one at a time in order
                         (README.md#progressive-catalog-load), decoding each as it
                         lands (byte-range chunking clears Cloudflare
                         Workers' 25 MiB per-asset limit — see
                         /scripts/catalog/record/README.md#on-disk-transport-chunking).
                         Layout, chunk and record-decode
                         helpers imported from
                         scripts/catalog/record/catalog-pure.ts — single source
                         of truth shared with the writer and the Node
                         AoS reader; the decode itself is
                         catalog-window.ts, off the main thread
                         (README.md#the-catalog-decode-worker). Exposes
                         `varType: Uint8Array` for the runtime
                         pulsation-suppress gate (see
                         `../binaries/eclipse/README.md`) plus
                         the derived `pulsRho` / `pulsColorSwing`
                         (buildPulsationParams from varType — the per-type
                         radius/colour swing the star shader + disc mirror
                         read). Exposes `velocities: Float32Array` (count×3,
                         pc/yr) alongside `positions`; the epoch-advance
                         pass below consumes it. Exposes `sid: Uint32Array`
                         (frozen Stellata IDs, /docs/sid.md#7-storage--sid-in-every-artifact) — the star
                         domain of the SID resolver
                         (`../util/sid-resolver/README.md`) and the v4 URL
                         wire both key off it. Exposes
                         `multiplicityStatus: Uint8Array` (v9:
                         single/resolved/unresolved — see
                         /scripts/catalog/multiplicity/README.md#multiplicity-status).
catalog-progressive.ts   chunk fetch scheduling + the record window each
                         landing chunk unlocks (§ Progressive catalog load).
catalog-window.ts        one record window's decode as plain typed arrays,
  (+ test)               window-relative — the pass both the worker and the
                         inline fallback run, plus the column roster the
                         memcpy back walks and the allocator the full
                         catalogue shares (README.md#the-catalog-decode-worker).
                         Column-at-a-time via decodeRecordColumn (see
                         /scripts/catalog/record/README.md#binary-catalog-format-publiccatalogbini--manifest).
catalog-decode-worker.ts that pass off the main thread, and the spawn +
catalog-decode-host.ts   inline fallback around it
  (+ host test)          (§ The catalog-decode worker).
catalog-fixture.ts       test-only catalog.bin builder — synthetic records
                         through the shipped writeStarRecord, so every
                         parse in these suites is a writer→reader
                         round-trip of the layout that ships.
catalog-decode-stub.ts   test-only Worker stand-in for the decode host,
                         parameterised on how it answers a window (decode
                         it, fail it, ignore it) plus its spawn and
                         terminate counts — the host and loader suites
                         drive the same fallback legs through one shape.
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
                         absolute grid (`../binaries/README.md#walk-active-lod`).
                         Pure +
                         vitest-pinned; the sky-position corpus drives the
                         SAME function end-to-end. See
                         /docs/science-catalog-ingestion.md#current-epoch-star-positions--space-motion-propagation-to-t.
catalog-mock.ts          test-only Catalog factory. NaN-fills Apsis
                         fields, -1 companion, lumClass=255.
dust-loader.ts           public/dust/manifest.json + chunk_X_Y_Z.bin →
                         Data3DTexture (DustField). Progressive upload:
                         zero-fill GPU texture upfront, fetch chunks
                         priority-ordered, hand each to the voxel uploader
                         as it lands (README.md#dust-voxel-upload). Manifest is
                         the contract with
                         scripts/dust/build-dust.py — both derive
                         gridSize / chunkSize / bounds / encoding from it.
                         Build-side counterpart: scripts/catalog/
                         dust-deextinction.ts reads the same artifact to
                         de-extinct absmag/ci (mirrored decode + integral).
dust-voxel-upload.ts     Landing one chunk inside the volume texture
  (+ test)               (README.md#dust-voxel-upload). Also owns
                         `createVoxelTexture` — every voxel texture,
                         volume and staging alike.
dust-voxel-readback.ts   Reading voxels back off the GPU and comparing
  (+ test)               them against the chunk files — the numeric smoke
                         behind `stellata.verifyDust()`
                         (README.md#dust-voxel-readback).
dust-renderer-mock.ts    A recording renderer stand-in, enough surface
                         for the upload and readback tests to run
                         headless.
```

## Progressive catalog load

`loadCatalog` resolves on the **first chunk carrying a whole record**, not on
the whole artifact, so boot paints a sky while the rest is still on the wire.
Records are apparent-V ordered and the chunk plan ramps from 1 MiB
([Record order,](/scripts/catalog/record/README.md#record-order) § On-disk transport
chunking), so that prefix is roughly the naked-eye sky.

The shape: one buffer pre-allocated at `manifest.totalBytes`, the chunks
fetched **one at a time in order** straight into their own slices, each
decoded as it lands. Issuing them at once splits the link N ways, so chunk 0
— the one first paint waits on — crawls in at a fraction of the bandwidth
while the other boot artifacts compete in the same pool; serialised, chunk 0
gets the whole link and the tail yields to whatever else boot needs.
`Catalog.loadedCount` grows,
`onRecordsDecoded` announces each window, and `whenComplete` settles when the
last one lands (and rejects if a chunk fails, so a caller waiting for the full
population sees the same error boot would).

**Every column is allocated at the full `count` from chunk 0**, because the
count is in the header. Nothing reallocates, no GPU buffer resizes, and every
array identity a consumer captured at boot stays valid — which is the whole
reason the tail can be filled in place.

What the undecoded tail holds, and why each is what it is:

- **`companion` is pre-filled with −1.** A zeroed `Uint32Array` decodes as
  "my companion is record 0", not as absent, so the sentinel has to be seeded
  rather than left.
- **`StarFrame.distSol` and `StarFrame.sortedDistFromSol` are both pre-filled
  with `Infinity`** — the sorted one is what the proximity window's binary
  search actually reads, and filling only `distSol` looks sufficient and is
  not ([Absorbing a chunk](../star-pipeline/star-frame/README.md#absorbing-a-chunk)).
- **Positions, magnitudes and flags stay zero**, which is safe only because
  nothing walks past `loadedCount`: the compaction kernel's thread count
  is the decoded count (`../webgpu/star/compaction/README.md`).

Three traps, all of them silent if missed:

- **The epoch baseline is extended, never re-snapshotted.** `advanceEpochTo`
  writes `base + v·Δt` back over `catalog.positions`, so a baseline taken
  before the tail landed would erase those records the first time the model
  clock crossed a bucket (`../star-pipeline/star-frame/README.md`).
- **Each landing chunk must invalidate the render gate**, or a settled camera
  never draws and the new stars simply do not appear. `Stellata`'s
  `absorbCatalogRecords` is the single place that fans a chunk out to the star
  frame, both pipelines and the gate — same shape as the dust loader's
  `onProgress` below.
- **The SID resolver's star domain attaches on the FIRST chunk and declares
  itself still filling.** A domain that answers `isComplete() === false`
  makes a miss indeterminate rather than absent, so a sid in a chunk that
  has not arrived stays `pending` and queues instead of being dropped, and
  every landing chunk calls `refresh()` to retry the queue
  ([A domain that is still filling](../util/sid-resolver/README.md#a-domain-that-is-still-filling)).
  Withholding it until the last chunk is the obvious alternative and is
  wrong — a `?v=` link's cam/tgt are in the focal object's frame, so the
  focus has to resolve before the pose is applied, not eventually
  ([A focus that resolves after the pose](../util/url-state/README.md#a-focus-that-resolves-after-the-pose)).
  `idMaps.hipToIndex` grows per chunk for the same reason.

## The catalog-decode worker

Every landing chunk's decode used to run on the main thread, and by then the
scene is already rendering off chunk 0 ([Progressive catalog load](#progressive-catalog-load)) — so each
one froze a **rendered** app rather than sitting behind a loading cover. The
decode runs in a worker; the main thread keeps the fetch, the name table and a
memcpy.

**The catalogue's own columns cannot cross.** They are allocated at the full
count from chunk 0 and filled in place, because every consumer captured those
array identities at boot, so a Transferable would detach the very arrays the
tail is still being written into. What crosses is one window's worth:
`decodeCatalogWindow` allocates arrays sized to the chunk alone and **indexed
from zero**, `catalogWindowTransfers` hands their buffers over so the window is
moved rather than cloned, and `absorb` lands each one with a single `set` at
`first × stride`. `CATALOG_WINDOW_COLUMNS` is that memcpy's roster and
`allocateCatalogColumns` sizes both the window and the full catalogue, so a
column cannot exist on one side and not the other.

Measured in Node on the shipped 388,071-record artifact, six chunks,
`--expose-gc`:

| step | cost | whose thread |
| --- | --- | --- |
| decode (26 columns + the sentinel/Sol/named pass) | 30.6 ms | the worker's |
| slicing each window's record bytes for the worker | 2.6 ms | main |
| memcpy of the decoded columns into the full ones | 2.8 ms | main |

The pre-paint window decodes inline and keeps its share on main. Every window
after it — the only decode that lands while the scene is drawing — goes to the
worker, main keeping the slice and the memcpy. Read the **split** rather than
the absolute: the same pass measures 189 ms in the browser, where the engine
is slower at `DataView` reads and boot is competing for the thread.

**A window is held once, not twice.** Peak addition while the largest chunk
(167,772 records) is in flight is 36.1 MB against 43.5 MB of full columns —
18.8 MB of decoded window plus the 16.8 MB byte slice, and the slice detaches
at `postMessage`. Nothing is resident on both sides, which is what a transfer
buys over the search index's structured clone
([The search-index worker,](../typeahead/README.md#the-search-index-worker) 64.5 MB held twice).
`stellata-8cg.52` owns the whole-app budget.

**Only the window's bytes cross, never the assembled buffer.** Transferring
that would detach the destination the remaining chunk fetches stream into, and
strand the inline fallback with nothing to read. A `slice` of the window's
records costs the 2.6 ms above.

**The name table stays main-side.** It precedes the records and is read whole,
once, so the worker returns the `FLAG_HAS_NAME` records as window-relative
indices beside the name-table offset each carries, and the main thread does the
map lookup for those alone. Sol comes back the same way, window-relative.

**The pre-paint windows decode inline; the worker is built for the tail.**
Wave 1 ends on the catalogue's first chunk ([Boot in two waves](../README.md#boot-in-two-waves)),
so every window up to that point sits behind the loading cover with
nothing drawing yet — an honest wait, and the one regime a worker cannot
improve. It can only spoil it: `new Worker` fetches its own emitted chunk,
which no `modulepreload` covers, so spawning there puts a cold round trip on
the path to first paint in order to move a decode that is competing with
nothing. `loadCatalog` therefore passes `decodeInline` for the windows before
first paint and constructs the decoder inside the tail walk, where the scene
IS drawing and each decode would otherwise be a hitch — and where the
worker's own module fetch overlaps the remaining chunk fetches instead of
blocking a paint.

**One worker for the tail**, spawned on its first window and terminated when
the last chunk lands — the chunks arrive one at a time, so a decode never
overlaps the next.

**The fallback is inline, and never rejects**: no `Worker` in the runtime, a
spawn that throws, a `postMessage` that throws, a throw inside, an `onerror`
and a worker that simply never answers all decode from the bytes the caller
already holds, and the first failure retires the worker so later windows do
not re-pay the round trip. A catalogue arriving slowly is a degradation; a
catalogue never arriving is a broken app — the same contract phase 1 holds.
`parseBinary` (Node readers, whole-buffer tests) runs `decodeInline` directly
and stays synchronous.

**Silence is a failure mode too, and it is the one with no event.** A worker
killed from outside — an out-of-memory kill on a small device, which is where
a 2.53× catalogue lands first — fires no `error`, so nothing would settle the
window in flight: the tail walk would stall mid-catalogue, `whenComplete`
would never settle, `kinds.star.ready` would never resolve, and wave 2 would
never run. `WORKER_REPLY_TIMEOUT_MS` bounds it. It is deliberately far above
any real decode, so it cannot fire on a working worker and costs a stalled
load one wait rather than a hang.

**Terminating and settling are one operation** (`stop`), so teardown and
failure cannot drift apart. `dispose` is that operation without the warning:
it ends the worker, retires the decoder so nothing respawns behind the
finished load, and settles any window still waiting to decode inline instead
of leaving its caller awaiting a reply that can no longer come.

## Dust voxel upload

`DustField` owns the ~128 MiB volume texture, the priority-ordered fetch,
the progress listeners and the dispose; `createVoxelChunkUploader` owns
writing one chunk's bytes inside the volume.

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
`DustField.dispose()`, and a write to a released texture walks three's
create-on-demand path and resurrects the whole volume.

three's backend exposes no sub-region texture write, so a chunk-sized
staging `Data3DTexture` takes the bytes as a whole upload and
`renderer.copyTextureToTexture` moves them into the volume's region. That
staging texture is reused across chunks and **must be re-marked
`needsUpdate` every time** — three's texture cache short-circuits on an
unchanged version, and the copy would then re-land the previous chunk's
bytes at the new offset. Both it and the volume come from
`createVoxelTexture`, because WebGPU rejects a copy between differing
formats and a hand-copied format is a format that can drift.

Chunk bytes are z-major with x innermost per the Python writer, which is
what the volume reads as width/height/depth.

The star vertex raymarch and the extinction prepass sample the volume
(`../webgpu/extinction/README.md`); § Dust voxel readback is how the
upload itself is verified, independently of any sampler.

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
the offset the uploader claimed?" numerically, because no pixel can answer
it — a dim sky looks the same whether one chunk or sixty landed. It re-fetches chunk
files (served from cache) and compares sampled voxels against what the GPU
holds.

- **Samples are the chunk's 8 corners plus its densest run.** Corners are
  where a wrong grid offset or a transposed axis shows up; the densest run
  guarantees non-zero evidence, since empty space reads as zero on a
  working upload and a broken one alike. `nonZeroExpected` in each report
  is that guarantee made visible — at zero, the samples prove nothing.
- **A readback that cannot work throws instead of reporting zeros**, for
  the same reason: a failed read and genuinely empty dust are both a
  buffer full of zeros.
- three has no public readback for a plain texture
  (`readRenderTargetPixelsAsync` only takes a RenderTarget), so it calls
  the backend's own `copyTextureToBuffer`, whose `faceIndex` argument is
  the 3D texture's z origin. That is the one place either dust-voxel
  module reaches past three's public surface.
- **Reads are 4 voxels wide along x.** WebGPU rejects a buffer mapping
  whose range is not a multiple of 4 bytes, so a single-texel readback is
  not available.

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
