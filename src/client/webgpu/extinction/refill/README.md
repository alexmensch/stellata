# Spreading the extinction refill across frames

Which slots the A_V cache refills on a given frame. The kernel and the
cache gate are the parent's (`../README.md`); this folder owns only the
schedule, and `refill-slices-pure.ts` is the whole of it — a cursor, a
request flag, and one function that turns them into this frame's dispatch.

```
src/client/webgpu/extinction/refill/
  refill-slices-pure.ts       REFILL_SLICES, refillSliceLength, planRefill
    (+ test)                  and the cursor they move.
```

## The spike is the problem, not the total

A whole-catalogue refill is one thread per star × 48 taps — 18.6M volume
samples at 388,071 records, and 61M at the V≤11 synthetic set's 1,278,785.
Measured on the forced-recompute dwell before the cache gate landed: 2.4–2.9
ms at 388,071 and 7.8–8.2 ms at 1,278,785, on every frame the camera moves
more than `RECOMPUTE_EPSILON_PC`. At 1.28M that took mw50's wall-clock median
from 16.7 to 33.3 ms — a frame crossing the vsync boundary, which is a thing
the user sees, where the same total spread under the boundary is not.

Spreading changes no total. One slice of `1/REFILL_SLICES` of the catalogue
dispatches per frame, so a whole refill takes `REFILL_SLICES` frames and
each costs that fraction.

## The cursor, and why a request never restarts it

`planRefill` holds a `base` — the next slot to refill, or `count` for a
parked cursor — and a `pending` flag. A request (camera displacement past
the epsilon, a moved gate bound, a re-packed position table, a dust chunk)
**starts** a cycle from a parked cursor and otherwise only sets `pending`.
The cursor advances one slice per frame, and on reaching the end wraps to
slot 0 if `pending` is set, or parks.

Restarting on every request is the obvious spelling and it starves the
catalogue: camera displacement fires on **every** frame of a warp, and an
epoch scrub fires `refreshPositions` nearly as often, so slice 0 would be
refilled forever and every other star would keep the value its last
completed cycle gave it.

**Every star is refilled within `REFILL_SLICES` frames of any request,
wherever in the cycle the request lands.** With the cursor at slice *k* when
a request arrives, slices *k…S−1* refill over the next *S−k* frames, the
wrap then covers *0…k−1* over the *k* after that, and *(S−k) + k = S*. That
is the bound the staleness below rests on, and the test that pins it sweeps
the request across every position in the cycle.

## The staleness this buys, and what sets REFILL_SLICES

A_V depends on camera **position** only — the ray is camera→star — so a
star's value is stale by however far the camera has moved since that star's
slice ran, at most `REFILL_SLICES` frames' worth. Extinction varies on the
dust texture's ~5 pc voxel scale, about **3 mmag of A_V per pc** of camera
displacement (`../../../star-pipeline/extinction/README.md` § The prepass
cache, which sizes `RECOMPUTE_EPSILON_PC` off the same rate). So the error
is `REFILL_SLICES × (displacement per frame) × 3 mmag/pc`.

The vantage that maximises it is inside the dust cube, flying, at any epoch
— the clock moves stars rather than the camera, and a star's own motion over
±5,000 yr is far under a voxel. At `REFILL_SLICES` = 4 and 60 fps, a 100 pc/s
fly-through through the plane is 1.7 pc per frame and 20 mmag, against the
~1.5 mag column the disc itself reaches. Outside the cube the rate is zero:
a warp's per-frame displacement is enormous and its staleness is the dust in
a segment that has none.

**It is a transient, and it closes itself.** The moment the camera settles
the cycle runs out and every star is exact again within `REFILL_SLICES`
frames. Raising the constant divides the per-frame cost and multiplies that
error by the same factor — re-derive the line above before moving it.

## Three places a whole-catalogue dispatch is still the right one

- **The first fill.** Until the buffer is whole, `uAvPrepassEnabled` stays
  0 and every consumer runs its own in-vertex march, 8–12 times per visible
  star per frame — dearer than the dispatch it would be waiting on. So the
  boot fill is one dispatch and the cursor parks behind it.
- **`verifyExtinction()`.** The parity check is a bit compare against one
  reference march at one camera, and a spread refill leaves up to
  `REFILL_SLICES` cameras in the buffer. It refills whole first, so what it
  compares is the march rather than the schedule (`../README.md` § The
  prepass kernel).
- **The pick mirror.** `warmAvReadback` maps the buffer only while the
  cursor is parked. A copy issued mid-cycle is superseded by the next
  slice before the hover dwell that wanted it can read a byte, which is the
  same argument the camera-under-way gate it replaces was making — and a
  parked cursor means nothing has asked for a refill, so it covers that
  case too (`../README.md` § Cold reads).
