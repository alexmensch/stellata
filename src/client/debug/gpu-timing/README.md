# GPU timing — how a frame's real GPU cost is measured

Where the `gpu.*` rows come from, and why the two backends give a
different number of them. The HUD that displays them is
[`../README.md`](../README.md); the harness that prices one pass is
[`../frame-cost/README.md`](../frame-cost/README.md).

## Files in this area

```
src/client/debug/gpu-timing/
  gpu-timer.ts (+ test)          EXT_disjoint_timer_query_webgl2 wrapper —
                                 one rotating scope per frame. WebGL2 only.
  gpu-frame-samples.ts (+ test)  Fan-out channel for whole-frame GPU
                                 durations the render loop measures itself.
                                 Publishes on WebGPU; the HUD and the
                                 pricing harness both subscribe.
  fake-gl.ts                     Test-only WebGL2 timer-query stub, shared
                                 by gpu-timer + perf-hud tests. The WebGPU
                                 path needs no equivalent — its double is a
                                 host with `rendererGL: null` plus a call to
                                 `publishGpuFrameSample`.
```

## `gpu.frame` is the only row that prices anything

`GPU_WHOLE_FRAME_SCOPE` (`gpu.frame`) exists on both backends and means
the same thing on both: real GPU milliseconds for one whole frame. The
perf HUD's headline says `gpu` whenever that row exists and `submit` (CPU
wall-time around the render calls) when it does not — **presence of the
row, never which timer object exists**, because the two backends produce
it by unrelated means.

**To price a single pass, disable it and difference `gpu.frame`.** That
is true on both backends, for different reasons (§ WebGL2, § WebGPU), and
`../frame-cost/` automates it.

## WebGL2 — one query at a time, and it over-attributes

`gpu-timer.ts` wraps `EXT_disjoint_timer_query_webgl2`. The extension is
feature-detected at panel open; absent it (Safari exposes none)
`gpuBegin`/`gpuEnd` stay no-ops and no `gpu.*` row appears at all.

**One query at a time — this shapes everything.** WebGL2 permits exactly
one active `TIME_ELAPSED` query per context and exposes no timestamp
queries, so scopes cannot nest or overlap within a frame. Each frame
times a single scope and rotates to the next, so **N scopes sample at 1/N
the frame rate**. The ring-buffer averages stay meaningful; the per-frame
histogram is still driven by `frame.total`, never by these.

**Never add the per-pass `gpu.*` rows together, and never ratio one
against `gpu.frame`.** Two problems compound. Rotation means two scopes
never sample the same frame, so their averages describe different work.
Worse, the per-pass scopes **over-attribute** on ANGLE/Metal: measured on
an M4, `gpu.main` came within 1 % of `gpu.frame` while `gpu.localDepth`
was a further 83 % of the frame on top of it — a sum of 42.7 ms against a
measured frame of 23.4 ms. Elapsed time is derived from pass boundaries,
and on a tile-based deferred renderer a pass's fragment work executes
when that pass is finalised, not necessarily inside the query that
encoded it. The per-pass rows are a relative signal — does this scope
respond to this change — and nothing more.

Because `gpu.frame` encloses the inner scopes, `begin()` refuses the inner
ones on its turn and their `end()` calls must leave the enclosing query
running — `endQuery` takes no handle, so closing on a label mismatch would
stop the clock early. Pinned in `gpu-timer.test.ts`.

Two further properties a reader will otherwise get wrong:

- **Results are async** — a query resolves some frames after submission,
  so `gpu.*` rows lag the scene by a frame or two.
- **A disjoint event invalidates everything in flight.** Reading
  `GPU_DISJOINT_EXT` clears it, so it is read exactly once per drain and
  applied to every result in that pass; those samples are dropped, not
  reported low.

## WebGPU — an exact frame total, and no per-pass rows at all

The renderer boots with `trackTimestamp: true`, and three then allocates a
timestamp query **pair per render pass**, automatically, with no scope
calls from us. `resolveTimestampsAsync('render')` returns the summed real
duration of every pass belonging to one frame. So `gpu.frame` here is a
sum of true per-pass measurements rather than one derived elapsed span —
strictly better than the WebGL2 figure, and available wherever the adapter
grants the feature.

**`trackTimestamp: true` is a request, not a grant.** three ANDs it with
`hasFeature('timestamp-query')` at backend init and clears it silently
where the adapter withholds the feature; every resolve then returns
`undefined` after one `warnOnce`. A granted feature is still not a working
one, so `webgpu/timestamp-probe.ts` drives a timestamped pass through a
validation scope at boot and clears the flag where it is refused. The boot
records that verdict once as
`WebGpuSeam.timestampsAvailable` (`../../webgpu/README.md` § Timestamps)
and consumers ask that rather than assuming the flag took: with no
timestamps the headline stays `submit` and a pricing sweep degrades to
`raf-delta` instead of claiming a clock it does not have.

### The resolved duration is quantised — a floor under every differential

**Chrome does not hand back a continuous number.** Measured 2026-08-25 on
an M4 over a `#renderer=webgpu` boot: across **310 distinct resolved frame
durations**, every one is an exact multiple of **65,536 ns** (2¹⁶,
≈ 65.5 µs), and their greatest common divisor is exactly that. The browser
is quantising the timestamp; it is not a property of the work measured.

**Differencing `gpu.frame` is the only thing that prices a pass (above),
so this is the floor that method runs into.** A differential under
≈ 65.5 µs is a quantisation bucket rather than a measurement: two
configurations whose true costs differ by less than one bucket can report
byte-identical durations, and a pass that prices at "exactly zero cheaper"
may simply be sub-quantum. Price passes that clear the floor by a healthy
multiple, or accumulate across many frames — never read a single small
differential as a result.

It also explains a reading that looks like a broken timer: two resolves
320 frames apart returning the same duration to nine significant figures
(12.648447999999998 against 12.648448000000002 — one integer nanosecond
delta, differing only in float64 noise). Steady-state work landing in the
same bucket, not a frozen or cached clock.

**Why 310 samples settles it.** A common divisor is strictly an upper
bound: if the real step were half as large, the durations would still all
divide by it. But each varied sample then has to land on a 65,536
boundary by luck, so 310 of them agreeing is that coin flip won 309 times
over. Reproduce by collecting unique durations across a minute of
animating scene and taking their greatest common divisor in nanoseconds —
more samples can only ever lower the answer, and these did not.

Measured on Chrome/ANGLE-Metal. Safari exposes no GPU timer at all, so
there is nothing to compare against there, and this figure should be
re-derived per browser and per GPU rather than assumed. The standing
record is `stellata-8cg.1`'s notes.

### A granted feature can still resolve garbage

**Chrome grants `timestamp-query` and then resolves nonsense.** Measured on
Chrome/Dawn, a whole frame comes back at ≈ **−1.7 × 10⁹ ms** — the negation
of a raw GPU timestamp (1.7 × 10¹⁵ ns ≈ 20 days of counter), so one half of
a pass's timestamp pair resolves unwritten while the other holds an
absolute counter. Safari 26 grants the same feature and then rejects the
query set, taking every submit down with it (`../../webgpu/README.md`
§ Timestamps) — so of the two backends measured, one grants and lies and
the other grants and breaks. The grant is a backend claim about itself,
not a property of the API.

Recording it produced both halves of the symptom, and neither looked like a
bad number: the headline reads `gpu` off the row's *presence*, so it kept
claiming a GPU measurement, while the table lists its top 8 rows by average
**descending** — an average of −1.7 × 10⁹ sorts `gpu.frame` off the bottom.
A `gpu` headline above a table with no `gpu.*` row in it at all.

So the channel drops any duration that is not finite and positive, says so
once per tab, and latches `gpuFrameSamplesAreSound()` false; the headline
falls back to `submit` and a sweep to `raf-delta`. That is the same
degradation the withheld-feature path already had, reached one step later —
**the grant is necessary, never sufficient.** A zero is NOT a fault: three
seeds `lastValue` at 0 and returns it from every early-out that measured
nothing, so zeros are dropped silently and leave the backend sound.

Three consequences, none of them a limitation to work around:

- **No one-query ceiling and no rotation.** Passes are timed
  concurrently, so nothing samples at 1/N the frame rate.
- **A timestamp resolve is not an exclusive resource.** The render loop
  resolves every rendered frame and `gpu-frame-samples.ts` fans the result
  out, so the HUD and a pricing sweep can read the same frames. The
  closed-panel precondition in `../frame-cost/README.md` is WebGL2-only.
- **Per-pass durations exist but are not public API.** three keys them by
  an internal `timestampUID` (`<uid>:f<frameId>`) reachable only through
  `renderer.backend.get(renderContext)`. Naming our passes off that would
  pin an internal representation for a number the differential already
  gives us honestly, so **there are no per-pass `gpu.*` rows on WebGPU** —
  the `submit.*` CPU rows and `debug.priceFrame()` cover that ground.

**The resolve must run on EVERY rendered frame that has a clock**, not only
while the HUD is open. Tracking allocates the query pair whether or not
anyone reads the result, and only the resolve recycles the pool: a resolve
gated on the HUD overran the 2048-query pool after ~1024 frames (~17 s),
logged `WebGPUTimestampQueryPool: Maximum number of queries exceeded`, and
then stopped sampling until something resolved. So the subscriber list
decides only whether a sample lands, never whether the resolve runs.

The single admissible gate is `WebGpuSeam.timestampsAvailable`, which
`animate()` passes to `resolveAndPublishGpuFrame`. Where the probe cleared
`trackTimestamp`, three's `initTimestampQuery` returns before allocating a
pool, so that frame has no queries to overrun and the resolve would only
log `WebGPURenderer: Timestamp tracking is disabled.` — the warning Safari
surfaced when the gate was missing.

**One resolve in flight at a time — the guard is load-bearing.** A resolve
spans the frames its `mapAsync` readback takes, and three coalesces: a
concurrent caller gets back the SAME promise, so it recycles no queries and
yields the same number. Publishing per call therefore put ONE frame's
duration in the ring k times, k being the frames the readback spanned. That
is not a cosmetic duplicate — it inflates the sample count `noiseMs`
divides by (√k too tight, so rows read as resolved that did not), and the
adjacent repeats drive `baselineLag1` / `disabledLag1` positive, which
`../frame-cost/README.md` § Reading a row tells you to read as drift.
`resolveAndPublishGpuFrame` holds one resolve in flight and publishes once
per completion; skipping the call while one is pending costs the pool
nothing, because three resets the pool's counter before the GPU work.

The batch also covers every frame since the last resolve but returns only
the newest frame's total — earlier frames' passes are dropped, not summed
into it. So samples arrive at fewer than one per rendered frame under load,
and each one is a single honest frame, which is what the ring average and
the dwell medians need.

### The resolved-uid trim — three's Map never shrinks on its own

`TimestampQueryPool.timestamps` is a `Map<uid, ms>` three writes on every
resolve and **never clears, trims or deletes** — verified in 0.185.1 across
both implementations, where the base class only ever `get`s and `has`es it.
Keys are `<contextUid>:f<frameId>`, unique per frame, so nothing overwrites
an entry: the Map grows for the tab's whole life at one entry per render
pass per frame. That is ~216k entries an hour at 60 fps for a *single*
pass, and the post-cutover frame submits several.

`dropResolvedTimestamps` clears it once each resolve settles, on the
success and the failure path alike. Clearing is safe because **nothing
reads it**: `resolveQueriesAsync` computes its total from the mapped result
buffer and its own offset list, never from the Map, and the only readers
are `Backend.getTimestamp` / `hasTimestampQuery` — which three itself never
calls and stellata never calls either, since there are no per-pass `gpu.*`
rows on this backend by design (above).

Two properties the tests pin. It runs **after** the resolve settles, never
before — trimming early would race the write three does inside
`resolveQueriesAsync`. And it is **inert at every level** where a three
bump might move the shape, because it reaches past the public surface and a
throw would land inside the render loop.

This is a stopgap: the durable fix is upstream, clearing resolved uids at
the end of `_resolveQueries` so every WebGPU app benefits and we carry no
divergence. Deliberately **not** folded into `patches/three@0.185.1.patch`
— that patch exists to be deleted at the three bump, and a second hunk
would make the bump re-verify an unrelated fix. Re-check this section
against the three version in `package.json` when that lands.

### Watching the raw sample stream

**The HUD cannot show you this.** The panel displays the ring's *average*,
so neither the arrival rate nor a run of repeated values is visible in it —
and the coalescing bug above is only ever visible as repeats. Subscribe
instead. On the dev server the module URL is the one the app itself
imported, so a dynamic import returns the same instance and the same
subscriber list rather than a second copy of the channel:

```js
import('/debug/gpu-timing/gpu-frame-samples.ts').then(({ onGpuFrameSample }) => {
  const seen = [];
  const off = onGpuFrameSample((ms) => seen.push(ms));
  setTimeout(() => {
    off();
    const dupes = seen.filter((v, i) => i > 0 && v === seen[i - 1]).length;
    console.log(`${seen.length} samples, ${dupes} adjacent duplicates`);
    console.log(seen.map((v) => v.toFixed(3)).join(' '));
  }, 5000);
});
```

`.then` rather than `await`: Safari's console has no top-level await, and
parses `await import(...)` as an identifier followed by a keyword —
`SyntaxError: Unexpected keyword 'import'`. Safari is also the only browser
this check can run in (§ A granted feature can still resolve garbage), so
the awaited form is unusable, not merely less portable.

Keep frames coming for the window — the render gate skips ticks where
nothing invalidated the frame (`../../render-gate/README.md`), and a still
camera over a paused clock produces no samples at all because it produces no
frames. An open debug panel holds the gate open, which is the easy way.

Expect **zero adjacent duplicates** and appreciably fewer samples than
rendered frames. Duplicates are bit-identical when they occur (it is
literally the same resolved number handed to k callers), so exact equality
is the right test and no tolerance is wanted. A count approaching one per
rendered frame *with* duplicates is the in-flight guard regressed.
