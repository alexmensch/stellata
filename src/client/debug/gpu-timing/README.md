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
`undefined` after one `warnOnce`. So the boot records the answer once as
`WebGpuSeam.timestampsAvailable` (`../../webgpu/README.md` § Timestamps)
and consumers ask that rather than assuming the flag took: with no
timestamps the headline stays `submit` and a pricing sweep degrades to
`raf-delta` instead of claiming a clock it does not have.

### A granted feature can still resolve garbage

**Chrome grants `timestamp-query` and then resolves nonsense.** Measured on
Chrome/Dawn, a whole frame comes back at ≈ **−1.7 × 10⁹ ms** — the negation
of a raw GPU timestamp (1.7 × 10¹⁵ ns ≈ 20 days of counter), so one half of
a pass's timestamp pair resolves unwritten while the other holds an
absolute counter. Safari 26 grants the same feature and resolves honestly,
so this is a backend fault, not a property of the API.

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

**The resolve must run on EVERY rendered frame**, not only while the HUD
is open. Tracking allocates the query pair whether or not anyone reads the
result, and only the resolve recycles the pool: a gated resolve overran
the 2048-query pool after ~1024 frames (~17 s), logged
`WebGPUTimestampQueryPool: Maximum number of queries exceeded`, and then
stopped sampling until something resolved. `animate()` resolves
unconditionally; the subscriber list decides only whether a sample lands.

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
