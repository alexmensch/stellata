# The pick's CPU copy of the A_V table

WebGPU has no synchronous readback, so the one behaviour the port cannot
reach by parity is the pick's cold read. This folder owns the copy that
closes it; the kernel that fills the buffer is the parent's (`../README.md`).

```
src/client/webgpu/extinction/mirror/
  av-mirror.ts    AvMirror — one mapped copy of the count-long A_V buffer,
                  its per-generation staging gate, and the epoch that drops
                  a copy the next dispatch has already superseded.
```

## Cold reads — the one behaviour that is not parity

`readAvMag(idx)` is synchronous on WebGL (`gl.readPixels`, memoised) and
the pick paths call it that way: a star's extinction decides whether the
renderer put a pixel on screen for it, so a pick gated on the intrinsic
magnitude selects stars the frame drew black.

WebGPU has **no synchronous readback**, and that is not a latency to
shorten but a shape the design has to take. `getArrayBufferAsync` stages
a `copyBufferToBuffer` and maps it, resolving frames later — so a copy
issued *by* the pick lands after the verdict it was meant to decide, and
the caller has already read `null` as "no cache, not no dust"
(`../../../star-pipeline/extinction/README.md` § Reading A_V back) and erred
toward *pickable*. No per-star refinement of that read closes it. The
value has to be on the CPU **before** the pick asks.

**`warmAvReadback()` is the whole mechanism**: one mapped copy of the
entire `count`-long buffer into a `Float32Array` mirror, which
`readAvMag` then answers out of — exactly, for every star in the
catalogue, at no further GPU cost until the next recompute. The pointer
events that precede a pick are what drive it (`onPickImminent` on
`../../../hover/hover-engine.ts` → `Stellata.notifyPickImminent`), so the
280 ms hover dwell and the click FSM's own hold each cover the map's
latency and the **first** hover already rejects a star behind heavy dust.

**The whole table, not the candidates, because the event does not know
them.** A candidate list is what the pick's own catalogue scan produces,
one dwell later; the pointer event that has to start the copy knows only
that *a* pick is coming. Warming what the event knows means warming
everything — and 1.48 MiB copied once beats racing the scan.

**The generation is what bounds the cost, not the event rate.** The
mirror is dropped on every recompute and re-read at most once per
recompute, so a `pointermove` sweep across a dusty field costs one copy
and a still pointer costs none. `AvMirror`'s own **epoch** — bumped by every
`invalidate` — drops a read that resolves against a superseded buffer,
which is the WebGL twin's `avCache.clear()` expressed for a promise that can
outlive the thing it was reading. A map that *fails* consumes that one
attempt rather than re-arming, so a device refusing the copy cannot turn a
pointer sweep into a 1.48 MiB-per-event drip.

**Two counters, because they answer different questions.** `staged` is the
generation a copy was issued for and stops a second copy inside one
generation; the epoch is what the resolve checks, and it moves on every
dispatch whether or not anything asked for a copy. Collapsing them would
let a copy issued before a dispatch answer picks after it.

**A refill still cycling warms nothing at all**, which is the other half of
that bound and the one the generation counter alone does not give. A warp,
a focus lerp or a camera simply turning asks for a refill every frame
(`../refill/README.md` § A view change is a refill request), so the cursor
never parks, the generation advances every frame, and a copy issued against
one is superseded before the 280 ms dwell that wanted it can read a byte —
every such copy is spent and dropped, at 1.48 MiB a frame for as long as the
motion lasts. `warmAvReadback` therefore returns early while the cursor is
mid-cycle, and the pick reads `null` and errs pickable across that stretch
either way. **The gate is the cursor, not the recompute**: a dust chunk
landing on a parked camera recomputes too, and the frame its cycle parks on
is one a pick can still be staged for. The frame-cost lever that forces a
recompute every frame at a parked camera is the same shape, and keying this
gate on the recompute instead would swallow it — it would also spend 1.48
MiB a frame on a live pointer, which is why that lever is dwell-only
(`../../../debug/frame-cost/passes/README.md` § The extinction rows). A
parked cursor also means the buffer belongs to one completed cycle rather
than to a half-written one, which is the second thing the mirror needs and
the camera the old gate watched never said (`../refill/README.md` § Three
places).

A drag announces nothing either: hover is suppressed for its duration
anyway, and the camera motion under it would invalidate each copy before
the next event. The residual hole is that shape and only that shape — a
pick dispatched while the camera is still crossing more than
`RECOMPUTE_EPSILON_PC` per frame reads `null` and errs pickable, as every
pick did before. Hover cannot reach it (it needs a `pointermove` the
drag latch swallows); a click during a focus lerp can.

Why not the alternatives: reading the buffer on every recompute is
1.5 MB per read and a warp recomputes every frame, which spends it
exactly where nobody picks; marching on the CPU needs the ~128 MiB voxel
grid the loader uploads and drops, and would be a second implementation
of the integral free to drift from the shader's.

The copy goes through `getArrayBufferAsync` with a **null target**, which
creates its staging buffer per call and destroys it after the map. three
also offers a `ReadbackBuffer` target that holds one across calls; it
trades 1.48 MiB of VRAM for the renderer's whole life against a create
and destroy per warm, and with the camera gate above a warm is a
per-settle event rather than a per-frame one. On the integrated and
mobile floor the parent sizes for (`../README.md` § What it costs, and what
it holds), the resident megabyte is the dearer half of that trade.
