# Priced passes — what each row of a `priceFrame` table costs

`buildPassToggles` is the roster: one entry per row, each knowing whether
its pass is active at the current view and how to turn it off. This folder
is that roster and the measured history behind the rows that do not read as
their name suggests; the sweep itself, its preconditions and the gates a
row is read through are `../README.md`.

## Files in this area

```
src/client/debug/frame-cost/passes/
  passes.ts (+ test)   buildPassToggles and the PassToggle contract —
                       every pass's present() and disable(), and the
                       restore each disable returns.
  passes-pure.ts       PRICED_PASS_KEYS, the roster in table order, and
                       the emptyPass row's default count. Dependency-free
                       so a caller can validate a requested key without
                       pulling the renderer in.
```

## The roster

`buildPassToggles`: the local depth pass (`localDepthPass.enabled`), MW
band (`milkyway.setEnabled`), LG volumetric emission, molecular-cloud
absorption (`setAbsorptionEnabled`), the HDR chain and its four
decomposition rows (§ Decomposing the HDR chain), the luminance
reduction (`reduction.enabled`), the star core depth-mask
(`setCoreMaskEnabled`), the planet depth pre-stamp
(`meshLayer.setDepthStampEnabled`, present only while some body's mesh is
opaque — `../../../solar-system/planets/depth-stamp/README.md`), and the
extinction prepass A/B. A pass inactive at the
current view/state is skipped, not measured as zero.

Four rows are not what they look like:

- **`hdrChain`** disables via `hdr.setChartMode(true)` — the whole-target
  park, which also stops the statistic attachment and flips emitters to
  inline tone-mapping. Its row prices target-chain-vs-direct-to-canvas,
  not the resolve draw alone. The park also stops `measure()` being
  called at all, so the toggle sets `reduction.fenceWhileParked` for the
  duration: without it the row prices the loss of the frame's only
  submission barrier on top of the chain (`../README.md` § The readback
  cadence confound).
- **`extinctionPrepass`** ADDS the in-vertex raymarch when disabled, so
  its `savedMs` is normally negative: the row is what the cache saves.
- **`emptyPass`** ADDS `clearDepth()` calls to the local depth pass when
  disabled (`localDepthPass.extraEmptyPasses`). On WebGPU three encodes a
  clear as its own render pass and submit — every colour attachment loaded
  and stored, nothing drawn — so `−savedMs` is the per-pass floor at the
  current buffer size, times the count (`docs/render-rules.md` § 8).
  **One pass is often under `bracketMs`, and the row then does not
  resolve** — it read −0.45 at a 0.5 bracket at Sol. Raising the count
  (`{ passes: ['emptyPass'], emptyPasses: 4 }`, or `--empty-passes 4` on
  the runner, which stamps it into the saved run's `params`) buys a
  tighter bound on the boundaries together: four read −0.10 at a 0.10
  bracket at Sol. **Read that as the total, not as four times a per-pass
  figure.** Dividing assumes the clears add, and consecutive clears with
  nothing drawn between them are what a driver would coalesce — untested,
  and a bound cannot tell a small linear cost from a coalesced one
  (`docs/render-rules.md` § 8). The real frame already
  carries one such pass wherever a local cluster is active: the
  `clearDepth()` between the main render and the local repaint. On WebGL2
  a clear is a state command inside the current framebuffer, so the row
  should read ~0 there — an expectation, not yet a measurement: on
  `raf-delta` a baseline under one refresh interval cannot show a
  sub-millisecond addition, and the WebGL2 rows taken so far sat there.
  Those rows now say so themselves — `cadenceBound`
  (`../README.md` § Reading a row).
- **`reduction`** keeps its readback fence while disabled and drops only
  the chain draws. Dropping the fence too priced the loss of the frame's
  only ANGLE submission barrier — see
  `../../../hdr/exposure/reduction/README.md`. Keeping it is necessary and
  **still not sufficient** — the row reads solidly negative at the
  default Sol view with the fence held, the readback cadence identical
  in both states, and `bracketMs` at 0.23. Reproduced 2026-08-16 with
  the exposure pinned: −18.2 ms at bracket 15.1 and −52.4 ms at bracket
  0.33, limit mags equal — and at Earth close approach (−10.5 and
  −14.1, brackets 6.6 / 7.0). The sign tracks the vantage: negative at
  both deep-cut views, positive at both dm-0 views, and it flips
  positive when the statistic writes are masked (§ The compression
  probe). Unexplained; check `disabledLimitMag` against
  `baselineLimitMag` before believing any one reading, and expect the
  negative at deep-cut vantages.

A fourth thing to know before reading rows at a no-cut vantage: the
adaptation park (`../../../hdr/exposure/park/README.md`) stops the reduction
draws and the statistic writes wherever the cut is not the measurement's,
and the exposure pin freezes it there (collapsing a mid-probe park to
parked, so every dwell prices the same state). At those vantages the
`reduction` and `statisticWrites` rows price an already-parked frame and
should read ~0 — the park working, not the instrument failing.

**Which vantages those are widened, so a stale table will disagree.** The
park used to engage only inside the slew's settle band, i.e. at a cut of
~0; it now also engages wherever the **display floor** governs, and the
default Sol view is exactly that case. So the numbers below taken at Sol —
`statisticWrites` +40.5 to +54.6 %, quoted there as the positive control
showing "the park stays off wherever the cut is live" — describe the
pre-park build at that vantage. The cut at Sol is live in the sense that it
is −6.29 mag, and dead in the sense that the measurement does not set it;
the park now reads the second. The three dm-0 vantages are unchanged, and
the surviving positive control is any vantage where the eye branch or the
pin governs.

Measured over all five canon vantages, 3 runs each, 6.774 Mpx: neither
row resolved at any of the three dm-0 vantages, against canon's resolved
`reduction` of +17.6 % (MW50), +26.3 % (MW120) and +32–45 % (LG). The
decisive row is MW-plane 120° on a settled instrument — a 29.67 ms frame
at a 0.007 ms bracket, `reduction` reading −0.027 ms. Sol was the positive
control: `statisticWrites` still resolved +40.5 to +54.6 % (canon +47.7 /
+50.2) — the park of the day stayed off there, which the floor-regime park
above changed.

**Sol re-measured after the floor-regime park, 2026-08-24** (Chrome,
timer-query, 6.774 Mpx, panel closed, 119 samples): `statisticWrites`
`savedMs` −0.016 at a 0.125 ms bracket, i.e. the row no longer resolves at
all, against the +40.5–54.6 % above. `baselineLimitMag` and
`disabledLimitMag` both held at 1.511 across the sweep, so the pin did its
job and the differential priced the pass rather than a denser star field.
Sol has therefore joined the three dm-0 vantages: **all four now price an
already-parked frame**, and the surviving positive control is Earth close
approach, where the resolved-surface pin governs and the park stays off.
The 41.4 ms baseline that sweep ran against is a *fully parked* frame — the
hold collapses the probe for the whole dwell, so the steady-state frame at
Sol sits above it by the duty-cycle share reasoned two paragraphs up.

**Every `statisticWrites` figure above predates the vertex-stage collapse**
(`../../../star-pipeline/collapse/README.md`, 2026-08-20). Re-measured
after it on the canon's own instrument — WebGL2 in Chrome, `timer-query`,
6.774 Mpx,
default Sol view, limit mags equal at 1.511, `noiseMs` 4.1, `bracketMs` 9.3,
readback 0.25 in both states — the row reads **50.7 ms / 50.6 % on a 100.2 ms
frame** (2026-08-21). Two readings, and the second is the one to carry:

- **The absolute cost fell 57–68 %** (118.9 / 156.3 → 50.7 ms), and the whole
  Sol frame fell with it — a canon-implied ~249–311 ms to 100.2 ms, 2.5–3.1×.
- **The share did not move**: ~48–50 % of the Sol frame before, 50.6 % after.
  Both attachments' write traffic scales with quad area, so shrinking the quad
  cuts the display and statistic writes alike. This page's headline claim
  survives the fix built to attack it, and the surviving 50.7 ms is a live
  target rather than a residue.

Instrument matters because two of the three combinations this machine offers
cannot be read against the canon at all: WebGPU makes the row structurally
null (§ Decomposing the HDR chain), and Safari's WebGL2 exposes no timer
query, so it falls to `raf-delta` wall time — a different method, which
`../README.md` § Preconditions forbids comparing across.

**These rows price the fully parked frame, not the duty cycle.** The pin
collapses the machine to parked for the whole sweep, so no probe runs
inside a dwell and the differential cannot see one. The steady-state cost
has to be reasoned from the cadence instead: the chain already only ran
on one rendered frame in four (`baselineReadback` 0.25 in every row at
every vantage), and a parked cycle is the probe interval, the wait for a
frame the chain can draw on, and the frames its readback is in flight — so
the measurement's GPU work falls by roughly 60 %, not the ~83 % the
interval alone suggests. Quoting these ~0 rows as the real-world saving
overstates it.

## Decomposing the HDR chain

Four rows split the `hdrChain` aggregate. Each is a marginal cost
against the same baseline and they overlap — `mrtAttachments` contains
most of `statisticWrites`, `summation` and `reduction` — so never sum
them; read each against the aggregate.

- **`tonemapOp`** — `hdr.setTonemapEnabled(false)`: the resolve goes
  straight pass-through with the target and attachments untouched. The
  operator's ALU alone.
- **`statisticWrites`** — masks attachment 1 out of every emitter draw;
  the clear keeps writing it, so the reduction runs over an empty
  attachment. Prices the emitters' statistic write bandwidth — NOT the
  attachment's load/store, which only `mrtAttachments` removes.
  **This row resolves on WebGL2 only.** There the mask puts `NONE` in
  slot 1 and the write does not happen. On WebGPU it is a uniform
  multiplying the statistic texel to the blend's identity element
  (`../../../webgpu/hdr/README.md` § The gate becomes the output struct):
  the fragment still emits its three-member struct and the additive
  blend still read-modify-writes the RG16F texel, so the row prices one
  multiply and reads ~0 no matter how large the write bandwidth is. A
  null row there is the lever's construction, not a finding — the
  WebGPU-valid write-bandwidth lever is `mrtAttachments`, which rides
  the real `setMrtOutputs` attachment swap.
- **`summation`** — skips the downsample and collapses the resolve's
  kernel to one centre tap: the convolution machinery, with the diffuse
  writes still paid.
- **`summationTaps`** — the downsample still runs; only the resolve's
  off-centre taps drop. Prices the kernel's taps alone, so `summation`
  minus this row is the downsample's share (both marginal against the
  same baseline — difference them, don't sum them).
- **`mrtAttachments`** — rebuilds the target with attachment 0 alone
  (holding the fence, as `hdrChain` does): attachments 1 and 2 outright —
  writes, load/store, the summation's source and the reduction's. What
  `hdrChain` saves beyond this row plus `tonemapOp` is the single fp16
  target itself against direct-to-canvas.

### The compression probe — does the reduction's cost track content?

The reduction reads 12–23 ms at vantages whose cut is exactly zero and
~zero at Earth close approach, same buffer; the working hypothesis is
lossless framebuffer compression — reducing a nearly-empty attachment is
nearly free. The test, at a vantage where the row is expensive:
`stellata.hdr.setStatisticWritesEnabled(false)`, then
`debug.priceFrame({ passes: ['reduction'] })`. The attachment is
cleared-to-zero, maximally compressible; a reduction row that collapses
to ~zero means the cost tracks the attachment's content, not the chain's
draws. Restore with `setStatisticWritesEnabled(true)`.

Measured 2026-08-16 at MW-plane 50°, exposure pinned, 6.774 Mpx: the row
did **not** collapse — reduction over the cleared attachment read
48.1 ms against 18.4 ms live (brackets 6.4 / 2.1), with the
reduction-off floors matching across the two states. Reducing the
emptiest possible attachment costs 2.6× the full star field, so "nearly
empty compresses well" is refuted. Working hypothesis, unverified: a
cleared-but-never-written surface stays in fast-clear metadata state and
sampling it forces a per-frame resolve, while a surface fully
overwritten by smooth resolved-disc texels samples cheap.

Replicated at the default Sol view: +43.1 ms at bracket 3.2 — the sign
flips from that vantage's live-writes negative, and the ~45 ms cost of
reducing a cleared attachment is vantage-independent. One gotcha the
replication exposed: masking the writes BEFORE the sweep lets the cut
fade to zero during the warmup, so the pin captures the wide-open limit
(7.8) rather than the live one — the differential stays internally
clean, but the scene is not comparable to unmasked runs at the same
vantage. The `limitMag` columns are the tell.
