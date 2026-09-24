# Timestamp queries on WebGPU

Whether this backend's GPU clock can be trusted, settled at boot before
the first frame. The renderer requests `trackTimestamp: true`; what
arrives is a grant that may still be a lie, and this folder is what turns
it into an answer.

## Files in this area

```
src/client/webgpu/timestamps/
  timestamp-probe.ts (+ test)  settleTimestampSupport — one throwaway
                               timestamped pass inside a validation
                               scope; clears trackTimestamp where the
                               backend refuses it. Structural GPUDevice
                               types, no WebGPU type package.
```

The consumer side — the sample channel, the HUD, `debug.priceFrame()` —
is `../../debug/gpu-timing/README.md`, which stays the authority on why
the probe's verdict is the one admissible gate.

## The flag is a request, and a grant is not proof

three ANDs `trackTimestamp` with `hasFeature('timestamp-query')` and
clears it where the adapter withholds the feature — but **Safari 26
grants it and then reports the query set's type as an unknown enum**,
which fails the render pass descriptor, invalidates the command encoder
and discards the entire submit. Every layer stops drawing and WebKit logs
nothing, since it does not fire `onuncapturederror`.

`timestamp-probe.ts` settles it by driving one throwaway timestamped pass
inside a validation scope and clearing `trackTimestamp` when refused, so
`WebGpuSeam.timestampsAvailable` is the probe's answer, never
`hasFeature`'s.

**The probe must run before the first frame.** three caches the render
pass descriptor per render target and never clears a `timestampWrites` it
already attached, so a descriptor built while the flag was still true
stays poisoned for the backend's lifetime.

**And a grant is not a working clock either:** Chrome grants the feature
and then resolves whole frames as a large negative number, so the channel
drops any duration that is not finite and positive and degrades exactly
as the withheld case does — per pool, so a lying compute pool leaves
`gpu.frame` and every pin row that gates on it alone.

## Why the resolve is not gated on the HUD

`animate()` resolves on **every rendered frame the probe left timestamps
live on** — not only while the inspector is open, and gated on
`timestampsAvailable` alone — and it resolves **both pools**, render and
compute. A resolve is what recycles a query pool, and three keeps one per
pass type: tracking allocates a query pair per pass whether or not anyone
reads the result, so a pool nothing resolves overruns its 2048 queries
after ~1024 passes, three logs `Maximum number of queries exceeded` for
that pool, and its sampling stops until something resolves it.

**One resolve cycle in flight:** a concurrent resolve returns the same
promise and the same number, so `resolveAndPublishGpuFrame` publishes once
per completion rather than once per frame the readback spanned.

## What the figures are

Two, one per pool. The summed real duration of every **render** pass in
one frame lands as `gpu.frame`, and the perf HUD's headline reads `gpu`
rather than `submit` whenever it exists. The summed duration of that
frame's **compute** passes —
the star compaction, the extinction prepass when it recomputes — lands as
`gpu.compute`, a row of its own that is never folded into `gpu.frame`
([`gpu.frame` is the only row that prices anything](../../debug/gpu-timing/README.md#gpuframe-is-the-only-row-that-prices-anything)). Subscribers (the HUD, a `debug.priceFrame()` sweep, the
perf runner's dwell) come and go through
`../../debug/gpu-timing/gpu-frame-samples.ts` while the resolve itself is
gated on nothing but the probe's verdict.

Per-pass `gpu.*` rows have no WebGPU counterpart on purpose: three keys
per-pass timestamps by an internal uid, and the pricing differential
answers the same question without pinning three's internals.
