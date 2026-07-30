# Reduction — the frame measures itself

The mip chain that turns the HDR target's **statistic attachment** into
two numbers — the frame's area-weighted mean luminance and its brightest
pixel — and the frame-late readback of them. `../README.md` § Adaptation
owns what the two numbers then do; `../../README.md` § Statistic
attachment owns what writes them.

## Files

```
src/client/hdr/exposure/reduction/
  reduction-pure.ts (+ test)  The level sizes, the weighted 2x2 combine the
                              shader runs (the EXECUTABLE SPEC, not a CPU
                              mirror anything invokes at runtime), and the
                              base-exposure rescale.
  reduce.frag.glsl            One level: weighted mean of the flux channel,
                              max of the peak channel.
  reduction-pass.ts           LuminanceReduction — the chain of targets, the
                              draws, and the readback. Needs a live GL
                              context, hence no test of its own.
  reduction-readback.ts       The pixel-pack buffer + fence (§ Latency).
```

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
`ceil(size / 2)` on both axes, down to 1x1, and each output texel reads
the (at most four) parent texels that exist:

```
mean = Σ wᵢ·meanᵢ / Σ wᵢ        peak = max peakᵢ        w = Σ wᵢ / 4
```

**The weight channel is what makes a non-power-of-two frame exact.** A
texel's `w · 4^k` is the number of level-0 texels behind it, that product
is additive down the chain, and the ragged last row and column of an odd
level therefore carry proportionally less. Without it the chain would
either drop or duplicate an edge at every odd step, and the 1x1 would be
an edge-biased approximation rather than the frame mean.

Level 0 has no weight channel and needs none: the attachment is **RG16F**,
so a `texelFetch` returns alpha 1, which is the weight it should carry.
That is the reason the weight rides alpha rather than blue.

**Only the last level is RGBA32F.** `readPixels` guarantees the
RGBA/FLOAT pair for that format and not for RGBA16F; one texel of it costs
nothing, and the fp16 levels above keep the chain's memory in the
megabytes.

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

**The `LUMA_CEIL` clamp is fine, and this is why.** Both channels clamp at
4096 before the write, so a wide-open frame containing Sol reads a lower
bound rather than the truth. A lower bound can only under-cut, so the loop
converges **from above**, bounded at `2.5·log10(LUMA_CEIL / L_CAP)` = 8.4
magnitudes of cut per measurement — Sol from wide open settles in two
frames, well inside `ADAPT_SLEW_TAU_S`. At a settled cut nothing is
clamped: Sol's pixels sit near 3500.

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
cost is paid on half the frames.

**Before the first one lands the statistic holds its last reading**, which
on a cold start is zero — no cut. That direction is deliberate: the
opposite default would let a frame go dark because a measurement had not
arrived.

## Where it runs in the frame

`stellata.ts` `animate()`, after `hdr.resolve()`, so reducing the
attachment never delays the frame it measures. It leaves the render target
at the canvas, the same contract the local depth pass keeps.

Chart mode and the float-RT fallback render nothing into the target at
all, so the pass is skipped and its last reading dropped — the statistic
reports `dm = 0` rather than adapting to a stale frame.

Perf rows: `submit.reduction` (CPU submission) and, where the driver
exposes a timer query, `gpu.reduction` — `../../../debug/README.md`
§ GPU timing.
