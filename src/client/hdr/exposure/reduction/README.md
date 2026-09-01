# Reduction — the frame measures itself

The mip chain that turns the HDR target's **statistic attachment** into
three numbers — the frame's area-weighted mean luminance, the frame
fraction lit resolved surfaces cover, and the **modal** lit surface's own
brightness — and the frame-late readback of them. `../README.md`
§ Adaptation owns what the three numbers then do;
`../../attachments/README.md` owns what writes the two channels they come
out of.

## Files

```
src/client/hdr/exposure/reduction/
  reduction-pure.ts (+ test)  The level sizes, where the chain stops, the
                              weighted 2x2 combine the shader runs (the
                              EXECUTABLE SPEC, not a CPU mirror anything
                              invokes at runtime), the level-0 channel
                              expansion, the tile level's CPU combine and
                              median, and the base-exposure rescale.
  reduce.frag.glsl            One level: three weighted means, and the
                              masked-mean product formed at level 0.
  reduction-pass.ts           LuminanceReduction — the chain of targets, the
                              draws, and the readback. Needs a live GL
                              context, hence no test of its own.
  reduction-readback.ts       The pixel-pack buffer + fence (§ Latency).
```

The WebGPU boot runs the same chain through
`src/client/webgpu/hdr/reduction-webgpu.ts` — `reduction-pure.ts` is the
one executable spec both shaders are held to; the readback and fence
mechanics below are the WebGL2 half only.

## Why a buffer reduction and not a source walk

The statistic used to be a CPU walk over every drawn body plus the stars
near the camera, each contributing `L(m)` analytically. Anything the
per-source model did not represent was invisible to it — and the airlight
was exactly that: a shader-side quantity with no sample of its own. On a
backlit Titan the walk saw a body at `φ(α) → 0` contributing ~1e-4 of the
host's irradiance while the Mie forward peak painted a ring of order the
irradiance itself, a gap of **~11 magnitudes**. Ring annuli, the twilight
term and every future emitter had the same hole.

Reducing what the frame drew closes the class rather than the instance,
the same argument the occlusion measurement it replaces made about
geometry. There is no per-source model left to drift, and occlusion falls
out for free: a surface that overwrote a star's pixels overwrote its
statistic texels too.

## The chain

Level 0 is the statistic attachment itself. Each level after it is
`ceil(size / 2)` on both axes, down to the **tile level** (§ below), and
each output texel reads the (at most four) parent texels that exist:

```
mean = Σ wᵢ·meanᵢ / Σ wᵢ    surface, coverage likewise    w = Σ wᵢ / 4
```

**Every channel is a weighted mean, including the coverage one**, because
the fraction of a region that is lit surface is the mean of a 0/1 indicator
over it. Dividing two of them — `surface / coverage` — is the mean of `L`
over that region's masked texels alone, so light *outside* the mask (a
glare halo, the star field, the band) raises `L̄` and cannot touch the pin.
That division is what each **tile** hands the median (§ The tile level).

**The masked product is formed at level 0 and nowhere else.** The
attachment is RG16F — flux in R, mask in G — so the first pass expands
`(r, g)` into `(r, r·g, g)` under `uFromStatistic`, and every level after
it already carries three means. Multiplying again at a later level would
square the mask. Level 0 is also where the weight comes free: RG16F has no
alpha, so `texelFetch` returns 1, which is exactly the weight one
attachment texel should carry.

**The weight channel is what makes a non-power-of-two frame exact.** A
texel's `w · 4^k` is the number of level-0 texels behind it, that product
is additive down the chain, and the ragged last row and column of an odd
level therefore carry proportionally less. Without it the chain would
either drop or duplicate an edge at every odd step, and any level's mean
would be an edge-biased approximation rather than the frame mean.

Level 0 has no weight channel and needs none: the attachment is **RG16F**,
so a `texelFetch` returns alpha 1, which is the weight it should carry.
That is the reason the weight rides alpha rather than blue.

**Only the last level is RGBA32F.** `readPixels` guarantees the
RGBA/FLOAT pair for that format and not for RGBA16F; the tile level is a
few tens of kilobytes of it, and the fp16 levels above keep the chain's
memory in the megabytes.

## The tile level, and why the subject is a median

**The chain stops at a tile grid, not at 1x1**, and the CPU takes it from
there. `REDUCTION_TILE_TEXELS` (1024) is the budget, and the level nearest
it *in log ratio* is the one that wins — the sequence quarters, so the two
candidates either side are a factor 4 apart. At 1600x900 that is level 5,
50x29 = 1450 texels, 23 KB read back.

**`L̄` and the coverage come out exactly as the dropped tail produced
them.** A texel's `w · 4^k` is the count of level-0 texels behind it and
`4^k` is constant across one level, so weighting by `w` alone over the
whole tile level IS the frame mean. This is a SHORTER chain and one
readback, never an extra tap: 6 draws go at 1600x900, together reading
0.14 % of the chain's texels, and the cost lands almost entirely in the
first pass either way.

**What the tiles buy is `D`.** Two frame means divided give the
area-weighted mean over *every* masked texel, which pools every masked
emitter into one subject — fine while they are within ~1 mag of each
other, and hopeless otherwise. Measured, against a star disc at the ramp
foot beside a parked planet whose true `D` is 0.89:

| pooling | resulting `D` | error |
| --- | --- | --- |
| arithmetic mean (`p` = 1) | 2.02e9 | 23.4 mag |
| `p` = 1/4 | 3.01e6 | 16.3 mag |
| `p` = 1/16 | 152 | 5.6 mag |
| geometric (`p` → 0) | 12.4 | 2.9 mag |

**No exponent rescues it.** A ten-decade brightness gap cannot be pooled
away; the subject has to be **segmented**, and a chain reduced to one
texel has thrown segmentation away by construction. So `D` is the
**coverage-weighted median** across tiles of each tile's own masked mean,
weighted by the masked area behind it (`w · coverage`):

- **50 % is the breakdown point**, so a subject owning more than half the
  masked area cannot be displaced however bright the rest is. Sol's disc
  at Earth park is 71 px² against Earth's 57 255 — 0.12 % of the masked
  area — so the regression guard is discharged by construction rather
  than by a threshold.
- **Two comparable subjects: the larger wins.** A globe and its ring
  annulus are no longer one blended subject; whichever owns the majority
  of the masked area *is* the modal masked surface, which is what the pin
  should be exposing for.
- **The tile grid is the estimator's RESOLUTION, not a change of
  quantity.** A coverage-weighted tile median is a consistent estimator of
  the per-texel coverage-weighted median, so the viewport-dependent tile
  count is estimator noise rather than the framing dependence the pin's
  inputs are supposed to be free of. No dedicated resample pass to a fixed
  grid, and no per-tile solid-angle normalisation.
- **Selection, never a sort.** The median runs on the main thread inside
  `measure()`; a three-way-partition quickselect over preallocated typed
  arrays is linear in the tile count, where a sort of ~1500 tiles costs
  several times the rest of the landing. It partitions the scratch in
  place, which is safe because the scratch is refilled from every
  readback.

**Three means fit the four channels an RGBA level target already had** —
R, G, B and the weight in A — so the coverage term costs no new pass, no
new target and no widening of the attachment. What paid for it was the
highlight guard retiring: the max of the peak channel had no consumer left
(`../README.md` § Adaptation).

fp16 flushes a level texel whose local mean falls under ~6e-8 to zero.
That is a bound on *isolated* faint light — a lone threshold star
contributes ~4e-9 to `L̄`, four decades under the anchor — never on an
aggregate, because a mean does not decay down the chain the way a sum
would: a field of faint stars keeps its local average at every level.

## Pixel units — CSS, on a device-pixel grid

The attachment is the drawing buffer's size, so the reduction's mean is
over **device** pixels. Every emitter nonetheless writes a **CSS**-pixel
quantity, and the two have to agree or the statistic would move with
`devicePixelRatio`:

- An extended source writes its surface brightness through
  `uOmegaPxArcsec2`, which is already a CSS pixel's solid angle.
- A point source divides its flux by `Φ(n)·D²` with `D` the kernel's **CSS**
  diameter, so integrating the kernel over the device grid returns
  `L(m)·pixelRatio²` — and dividing by the device pixel count gives
  `L(m) / (w_css · h_css)`, the same number the extended case lands on.

Get `D` in device pixels instead and a 2x-DPR frame reads four times too
dark on the perception branch.

## Measure at the base exposure, not the live one

The target is rendered **with** the adapted, trimmed scalar, so the
reduction has to divide it back out (`rescaleToBaseExposure`) or the cut
would feed itself and +3 stops of trim would provoke a compensating cut
that cancels it. The scalar it divides by is the one live at **render**
time, captured when the readback is requested: the answer outlives the
frame it describes.

With that division the measurement is invariant to `dm` and there is no
loop. The one remaining nonlinearity is `LUMA_CEIL`.

**The `LUMA_CEIL` clamp is fine, and this is why.** The flux channel
clamps at 4096 before the write, so a wide-open frame containing Sol reads
a lower bound rather than the truth. A lower bound can only under-cut, so
the loop converges **from above**, bounded at
`2.5·log10(LUMA_CEIL / L_TARGET)` = 9.2 magnitudes of cut per measurement —
Sol from wide open settles in two frames, well inside `ADAPT_SLEW_TAU_S`.
At a settled cut nothing is clamped: Sol's pixels sit near 3500.

**A quantile inherits that argument unchanged, in one line.** A median is
monotone in every sample and the clamp lowers every sample, so the median
of the clamped tiles is at or under the median of the true ones — a lower
bound exactly as the mean was, and the same convergence-from-above bound
restates verbatim. A resolved photosphere rails five decades over the
ceiling at the base exposure and still settles in ~3 measurements.

**The mask channel never clamps and never rescales**, which is what keeps
the pin open-loop where the retired guard was not. A railed *peak* fed the
cut it had produced — clamp before `rescaleToBaseExposure` and the reported
peak becomes `LUMA_CEIL · base / live`, so a deeper cut demanded a deeper
one still, which is what Mars's hunting at park was. Coverage is a fraction
of texels: it is invariant to the exposure by construction, and only the
flux half of `D` passes through the rescale at all.

## Latency

The readback lands a frame or two after the draw it measures, which the
statistic already tolerates — the applied cut is slew-limited over
`ADAPT_SLEW_TAU_S` (300 ms), so tens of ms are far inside the ramp it
feeds. Do not make it synchronous to "fix" a lag nobody can see:
`getBufferSubData` on an unsignalled fence stalls the pipeline, which is
the whole thing the fence exists to avoid.

**One readback in flight.** A frame whose predecessor has not landed does
no GPU work at all rather than queueing a second, so the measurement
refreshes every other frame at worst (~33 ms at 60 Hz), and the chain's
cost is paid on half the frames. `readbackPending` exposes that state
because the adaptation park has to respect it: a probe opened on a frame
this class will sit out pays the statistic writes with nothing reducing
what they wrote (`../park/README.md`).

**Before the first one lands the statistic holds its last reading**, which
on a cold start is zero — no cut. That direction is deliberate: the
opposite default would let a frame go dark because a measurement had not
arrived.

**The pack buffer is orphaned before every `readPixels`.** One `STREAM_READ`
buffer re-read every other frame otherwise leaves the driver preserving the
previous contents across the new write; ANGLE stages a shadow copy to make
the `getBufferSubData` cheap, then discards it, and says so in the console
once per request. Re-declaring the storage says the old grid is dead —
nothing reads it after `poll()` has landed it. The buffer is sized to the
tile level and rebuilt with the level chain on resize, which is safe
because `measure()` refuses to touch the levels while a readback is in
flight.

## Where it runs in the frame

`stellata.ts` `animate()`, after `hdr.resolve()`, so reducing the
attachment never delays the frame it measures. It leaves the render target
at the canvas, the same contract the local depth pass keeps.

Chart mode and the float-RT fallback render nothing into the target at
all, so the pass is skipped and its last reading dropped — the statistic
reports `dm = 0` rather than adapting to a stale frame.

`fenceWhileParked` is the one exception, and it is debug-only: with it
set, `measure()` still runs across the park with a null source, issuing
the readback and nothing else. The `hdrChain` frame-cost row needs it,
because parking the chain otherwise takes the frame's only submission
barrier with it and the row would price that instead. Production chart
mode leaves it off — a readback it has no use for is not free.

Perf rows: `submit.reduction` (CPU submission) and, where the driver
exposes a timer query, `gpu.reduction` — `../../../debug/README.md`
§ GPU timing. `stellata.reduction.enabled = false` skips the chain's
draws while FREEZING the statistic at its last reading (unlike chart
mode's reset-and-drop) — a frame-cost measurement lever
(`../../../debug/frame-cost/README.md`). `measure()`'s `parked` argument
is the same skip driven per frame by the adaptation park
(`../park/README.md`) instead of by a debug toggle;
everything below about the disabled path — fence kept, landing dropped —
holds for it verbatim.

**The readback keeps running while disabled, and must.** `request()`
ends in `gl.flush()`, and on ANGLE that flush is the frame's only
submission barrier: drop it and the driver batches deeper, so
`TIME_ELAPSED` spans more overlapped work and the frame reads *slower*
with the pass off. The disabled path therefore still binds the last
level and re-requests it — same fence, only the draws removed.

**The cadence is emergent, not pinned — and measurement says that does
not matter.** `pending` is just `fence !== null`, cleared in `poll()`
only once the fence has SIGNALED, so nothing pins the rate. The worry
that follows is that removing the draws lets the GPU drain sooner, the
fence signal sooner, and the `gl.flush()` fire more often — pricing
batching depth rather than the pass.

`requestsIssued` counts what actually went out, and the frame-cost
harness reports it per dwell. At the default Sol view it read **0.25
exactly in every state of every row** — one readback per four frames,
unchanged across frames from 31 ms to 112 ms. The latency is constant in
*frames* rather than wall time, i.e. pipeline-depth buffering, which is
indifferent to what the frame costs. **Hypothesis refuted**; the counter
stays as a standing check.

What is still unexplained is the row itself: at the default Sol view,
with the fence held and the cadence identical either side, `reduction`
prices **−15.8 ms** against a `bracketMs` of 0.23 — the tightest bracket
in the dataset, so the sign is not noise. Neither the missing fence, the
stale readback, nor the cadence accounts for it. Reproduced on Safari
WebGL *and* Safari WebGPU (−1 to −1.5 ms, small but resolved), so it is
neither the ANGLE translation layer nor anything WebGL-specific.
`stellata-8cg.29` owns it, and the tile stop above is the next natural
occasion to re-take the row.

**What it lands is then thrown away, and that part is not optional.**
The grid is from whichever frame last ran the draws, while
`renderExposure` is live; pairing them breaks the invariant above and
the cut is computed from a mismatched ratio. That is a feedback loop,
not a one-off error — a wrong cut moves the exposure, which moves
`renderExposure`, which moves the next wrong cut. Measured at the
default Sol view, where the cut is deep, it drove the frame 22–58 ms
*slower* with the pass disabled; at an LG viewpoint, where the cut is
shallow, the same code read a clean +10 ms. `pendingIsStale` marks the
in-flight request so `poll()` drops it and `latest` genuinely freezes.
