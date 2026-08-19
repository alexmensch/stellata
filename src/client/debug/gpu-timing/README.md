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
strictly better than the WebGL2 figure, and available on Safari, which has
no WebGL2 timer query at all.

Three consequences, none of them a limitation to work around:

- **No one-query ceiling and no rotation.** Passes are timed
  concurrently, so nothing samples at 1/N the frame rate.
- **A timestamp resolve is not an exclusive resource.** The render loop
  resolves unconditionally and `gpu-frame-samples.ts` fans the result out,
  so the HUD and a pricing sweep can read the same frames. The
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

One reporting caveat: a resolve coalesces with any resolve already in
flight, and the returned figure is the newest frame in the batch — earlier
frames' passes are dropped, not summed into it. So samples can arrive at
fewer than one per frame under load. Each sample is still one honest
frame, which is what the ring average needs.
