# Render rules — what every layer owes the frame

General render, performance and architecture rules that apply to any
layer Stellata draws, present or future. A rule lands here when it is
true of every layer, not one; a layer's own README carries what is
specific to it, and `authoring-patterns.md` carries write-time process
(how to author the diff, not what the frame must do). Each rule states
**Rule / Why / How to apply / Where it is enforced or measured**.

Every rule below is evaluated **per frame, from the live vantage and the
live exposure**. AGENTS.md § Camera-anywhere, any-epoch forbids the
design-time shortcut "from Sol, today, this rounds away"; the rules here
are the opposite move — the frame itself decides, each time it is drawn,
what can and cannot reach the display, and skips only what provably
cannot. The complementary upper bound is SCIENCE.md § Defer detail until
zoom affordance: do not add detail the user can never get close enough
to see.

Two measured facts frame everything below (`src/client/debug/frame-cost/
README.md`, five vantages, 6.774 Mpx, Chrome): the frame is fill-bound —
linear in pixels — and the largest costs are passes that touch every
pixel whether or not anything visible is in them. Doing less work per
pixel and skipping work that cannot reach a pixel is the whole programme.

## 1. Draw at visible count, not catalogue count

**Rule.** An instanced population feeds its draw a compacted index of the
instances that can reach the display from this vantage — never the
whole catalogue with the invisible members culled inside the shader.

**Why.** A vertex that early-outs still ran. The star passes issue the
full catalogue count in two to three passes every frame, and the mag
prefilter's ~30-instruction exit still costs a measured ~9 ms
pixel-independent floor in the main pass at the default view (the
dpr 2 → 0.5 scaling run recorded in stellata-8cg.1's notes). The
extinction prepass is per-vertex too, so its share *grows* as resolution
falls. Three.js frustum culling is off on every layer
(`frustumCulled = false`) because floating-origin rebasing invalidates
the bounding spheres three would test — so today nothing is culled at
all, and a population out of view still pays its full vertex floor.

**How to apply.** Any population past roughly ten thousand instances
computes a visible index once per frame and draws that: on WebGL2 a
CPU frustum test plus a magnitude window over the population's own
distance-sorted index (`star-pipeline/star-frame/README.md`
§ `forEachStarNearCamera` is the existing binary-searched window);
on WebGPU a compute pass that compacts the visible list and issues an
indirect draw, so the GPU never sees the catalogue count. A reorder
that changes instance identity must sweep every consumer of the old
order (picker sorted arrays and binary relation indices are index-
coupled; URL-state references are not).

**Where.** The design gate for the WebGL2 half is stellata-8cg.5; the
compute half is stellata-0it.15. Priced by `debug.priceFrame()` at the
canonical vantages before and after.

## 2. Contribution-gated liveness

**Rule.** Every scene layer declares, per frame, whether it can put a
display-visible pixel on screen from this vantage at this exposure. A
layer that cannot skips its draw and its per-frame update.

**Why.** This is the layer-level twin of the per-star vertex-stage
collapse (rule 4). Layers pay their draw and their CPU update from every
vantage, and with frustum culling off (rule 1) a molecular cloud behind
the camera, a shell subtending a fraction of a pixel, or an emitter whose
peak is under the display floor all cost what they would cost if they
were filling the screen. The precedents already in the tree are exactly
this test done ad hoc: the star core mask draws only when some star is
close enough to subtend `RESOLVED_DISC_MIN_PX`; the planet mesh hides at
`meshFadeFromPhysPx(physPx) <= 0`; the galactic disc sets
`visible = false` when its distance-faded opacity reaches zero; probe
markers gate on `isFeatureLegible` over the fleet extent.

**How to apply.** Three admissible tests, all physical — never a distance
band keyed on where Sol is:

1. **Frustum.** The layer's bounding volume, in the renderer-local
   frame, lies wholly outside the view frustum.
2. **Legibility.** The layer's projected extent is below the shared
   legibility floor: `isFeatureLegible(sizePc, distancePc, pxPerRad)`
   against `FEATURE_LEGIBILITY_MIN_PX` (`util/orbit-line.ts`), with
   `angularDiameterPx` (`camera/controls/star-geometry.ts`) as the
   projection. Do not write a second projected-size helper.
3. **Brightness.** The layer's peak surface brightness at the live
   exposure is below the display floor — the extended-source threshold
   `stellataExtendedThresholdSb` (22.0 mag/arcsec² at the shipped
   instrument, `hdr/emission/README.md` § Extended sources).

"Prefilter with the bound, decide with the predicate"
(`hdr/exposure/README.md` § What "visible" means to a pick path) holds
here too: the layer test is the conservative bound side, and it must
only ever *dim* — a layer the bound admits may still draw nothing, a
layer it rejects must be one that could not have drawn.

**A layer that skips must reset every dirty-track sentinel on the way
out** (`authoring-patterns.md` § Sentinel-init), or it holds stale state
and refuses to repaint when it becomes visible again. `FresnelShell`
starting `permitted = false` so it agrees with its constructor's
`group.visible = false` is the worked example
(`fresnel-shell/fresnel-shell.ts`).

**Where.** The contract lives on `SceneLayer` beside `timeBehaviour`
(`scene/README.md` § Declaring how time moves a layer is the model: a
required discriminated union, because an omitted hook reads as an answer
and the failure it prevents is silence). The design gate and the
per-layer adoption are the liveness epic under stellata-8cg;
stellata-9mm.231 (sub-pixel shells) is its first child.

## 3. Reduced-resolution additive sums for band-limited emitters

**Rule.** A smooth extended emitter whose structure scale is far above
the pixel may render at the resolution its own summation kernel implies,
into an additive-sum target, upsampled once bilinearly — with every
non-linear operator (knee, tone map, dither) applied *after* the sum.

**Why.** The band, the Local Group emission and the cloud absorption
write the HDR target's diffuse attachment, and the resolve averages that
attachment over the rod-summation patch of about 13 arcminutes before
compositing (`hdr/summation/README.md`). Anything a reduced-resolution
render loses, that average was already removing — provided the upsample
happens before or inside the summation. The band is pure fill: it priced
at 36–60 % of frame across the canonical vantages and scaled 7.2× with
pixel count while a 50°→120° FOV change made it *cheaper*
(`frame-cost/README.md`). Early-z buys nothing here, because no occluder
sits in front of most band pixels.

**How to apply.** The sum is what is bandlimited, so keep it linear all
the way to the upsample: rgb and the scalar the knee runs on are stored
raw, and the knee is applied to the *summed* field. Attachments of one
render target must share dimensions, so a reduced-resolution emitter is
a separate pass and target — which also removes an attachment from the
main target, and the main target's extra attachments priced at 53–86 %
of frame, so that side effect may be the larger prize. Depth tests
against foreground occluders blur at the reduced edge; the exposure
statistic those emitters write needs its own path. Whole-frame
downscaling is **not** this rule — it degrades resolved content, and
the standing ruling is that it reads as garbage; the adaptive-quality
epic stays optional.

**Where.** stellata-8cg.4 (reopened) is the design gate; visual sign-off
is a browser decision, never the perf runner's.

## 4. Invisible is not free

**Rule.** Bound the cost of an invisible instance in the vertex stage,
and the cost of an invisible layer at the draw (rule 2). Never assume a
fragment that writes nothing was free.

**Why.** A fragment that writes nothing still rasterises its quad and
pays read-modify-write blend bandwidth on every attachment its pass
opens; at a deep adaptation cut that is most of the star field, and the
statistic-attachment write row measured about half of the default-view
frame. The vertex-stage collapse (a star past the glow taper becomes an
off-screen sentinel; one below the display floor shrinks to a
`uSizeMin` quad while its flux integral is preserved) cut the Sol frame
2.5–3.1× — and the write row's *share* did not move, because both
attachments scale with quad area. That is the doctrine in one number:
shrinking what is drawn is the lever; drawing it invisibly is not.

**How to apply.** Per instance: sentinel out exactly at the same bound
the fragment stage uses (the live threshold, so the EV trim moves both
together), and collapse the kernel — not the star — under the display
floor derived from half an 8-bit step with a stacking margin. Per layer:
rule 2. The display floor is derived once
(`star-pipeline/collapse/glow-collapse-pure.ts`); a second derivation of
it anywhere is a drift point.

**Where.** `src/client/star-pipeline/collapse/README.md` is the star
instance and the durable argument; the frame-cost canon carries the
measurements.

## 5. Flux-conserving aggregation for point populations

**Rule.** A level-of-detail stand-in for a group of point sources
deposits exactly the light of the members it replaces — summed flux,
flux-weighted colour, one extinction column — and is used only when the
group's angular extent is below the legibility floor.

**Why.** Below the legibility floor the eye cannot separate the members,
so a stand-in that conserves flux and colour is invisible as a
level-of-detail change; above it, it is not. This is what lets the drawn
instance count stop tracking the catalogue count (rule 1) as the
catalogue deepens (stellata-cns, ~1.25 M rows at V ≤ 11).

**How to apply.** Index the population spatially (a tree splitting space
into eight cubes per level, holding member IDs — never positions, which
are CPU-side and epoch-advanced), carry per node the summed flux and
flux-weighted colour, and choose the cut each frame by walking from the
root and refining only nodes whose projected extent exceeds the floor,
under an instance budget. One extinction column per stand-in is
admissible when the dust gradient across the node's angular size is
below the display floor — state the vantage and the epoch when claiming
it. Epoch drift over the clock's ±5000 yr range is sub-parsec for the
whole catalogue (Barnard's star, the fastest, moves about half a parsec),
so pad node bounds by the catalogue's maximum displacement at build
time, or rebuild the index past a threshold; do not let a drifted member
be culled at a node edge.

**Where.** Design bead under stellata-cns.1; the HDR peak of a stand-in
comes through `stellataPointSourcePeak` from the summed flux, and the
extinction prepass provides one texel per stand-in.

## 6. Depth is a pipeline property

**Rule.** No static fragment-depth write anywhere in a pipeline; a depth
contract is satisfied by removing writes, never by adding draws; draw
count per subsystem is part of parity.

**Why.** Any static `gl_FragDepth` / `frag_depth` write disables early-z
— the hardware skipping a pixel's shading when it is already known to be
hidden — for the *whole* pipeline, not the branch that needed it, and
neither GLSL ES nor WGSL has a conservative-depth qualifier. A port child
that answers "one program per pass" with a second draw over the same
330 k instances has made the frame cost more than the renderer it
replaced.

**How to apply.** `src/client/webgpu/README.md` § Early-z is the
authority for the star layer's depth-honest design and stays so; the
vitest scanners `tests/shader-frag-depth.test.ts` and
`tests/tsl-frag-depth.test.ts` hold the allowlist at empty.

## 7. One writer per buffer per submit

**Rule.** A GPU buffer that stellata writes itself is written at most
once per submit, or it is given per-draw slots.

**Why.** `GPUQueue.writeBuffer` is a queue operation: every write in a
frame lands before any command recorded in that frame's submit executes.
So N draws that share one uniform or storage buffer, each preceded by a
`writeBuffer`, all read the *last* bytes written — the first N−1 draws
render with the wrong data and nothing reports it. Three.js's own
material uniforms are per-object and unaffected; the exposure is in
anything we write directly.

**How to apply.** Per-draw buffers, 256-byte dynamic-offset slots within
one buffer, or a per-view ring sized to the number of draws sharing a
submit. Design this into any storage-buffer path before it exists: the
compute prepass (stellata-0it.15, storage buffers indexed by
`instance_index`), the binary-orbit delta upload, and any raw WGSL
kernel. Related validation trap, already guarded in
`debug/gpu-timing/README.md`: `mapAsync` on a buffer with a pending copy
in a not-yet-submitted encoder fails — defer the map to a microtask
after the submit.

**Where.** The audit of the existing storage-buffer designs is a bead
under stellata-0it; `webgpu/README.md` carries the pointer.

## 8. Submits and passes are costs

**Rule.** Count render passes and queue submits per frame before
splitting any pass for attribution or convenience; prefer fewer, wider
passes.

**Why.** On the WebGPU backend each `renderer.render` call is its own
command encoder and submit, and each render pass on a tile-based GPU
(Apple silicon shades the screen in small tiles held in fast on-chip
memory) pays a full store and reload of the target through main memory
at the pass boundary — of the order of half a millisecond to two
milliseconds per pass at 5–7 Mpx, independent of what the pass draws.
The exposure reduction chain is one render per level; the local-depth
pass, the tone map and the extinction prepass are more. A dozen submits
where one would do is a cost with no pixel attached to it.

**How to apply.** Measure the per-pass floor once with the runner (an
empty extra pass, differenced), then read every "add a pass" proposal
against it; stellata-8cg.48 (reduce 4×4 per level, halving the chain)
is the shape of the fix.

**Where.** Submit-and-pass count spike under stellata-0it.

## 9. Measurement canon

**Rule.** Wall clock is the total; GPU slots are attribution. Only a
differential prices a pass. Every renderer-touching PR states its
measured frame cost against the current pin — the cost of a feature is
known before it merges, not discovered in an audit.

**Why and how, as a list — each line has been paid for:**

- **Only `gpu.frame` differentials price a pass.** Disable the pass,
  re-dwell, difference the medians. Per-pass timer scopes over-attribute
  on tile-based GPUs: consecutive passes retire concurrently, so each
  scope reports the shared interval and a sum bills it once per pass —
  per-pass numbers are ordinal at best, never additive, never converted
  to a frame rate. `debug.priceFrame()` automates the differential
  (`debug/frame-cost/README.md` owns the roster, the gates `noiseMs` /
  `bracketMs`, and how to read a row).
- **Absolute numbers do not reproduce; ratios at the same buffer and the
  same clock do.** The frame is linear in pixels, so `bufferMpx` is
  stamped on every row and only same-buffer tables compare. `method`
  (`timer-query` / `timestamp` / `raf-delta`) is stamped too and never
  compared across; `raf-delta` is the one clock every browser and
  backend share, so a cross-backend table pins it.
- **Exposure is pinned for the sweep**, because every pass that writes
  the statistic attachment is an input to the exposure — unpinned, a
  toggle changes what the frame draws and the row prices a different
  scene. `baselineLimitMag` / `disabledLimitMag` must agree.
- **The instrument drifts** — Apple-silicon clocks ramp under load — so
  baselines are bracketed either side of every disabled dwell and
  differenced against their mean.
- **Chrome quantises WebGPU timestamps to 65,536 ns** (2¹⁶; pinned over
  310 samples). A differential under that is a bucket, not a result. A
  granted `timestamp-query` feature can still resolve garbage; the boot
  probe's verdict, not the grant, decides which clock a run gets.
- **Never compare headless to headed**, Safari-under-inspector to
  anything (the dev-server fan-out runs ~50× slower there), or a
  production build to the dev server.
- **The perf runner is human-armed and reads clocks only.** It never
  takes a pixel readback and is never used for appearance or UX
  decisions; a run starts only after the operator has prepared the
  machine and created the arm marker. Its protocol and flags live with
  the runner; its results go to bead notes with the run file's path,
  never into a README.
- **Render on demand is the other half of the budget.** A frame that is
  not drawn costs nothing; `render-gate/README.md` owns when a frame is
  drawn and stays the authority.

**Where.** `debug/gpu-timing/README.md` (the clocks), `debug/frame-cost/
README.md` (the differential), the perf-runner sub-epic under
stellata-8cg (the headless instrument and the pin).

## 10. Pointers into the write-time rules

Adopting any rule above across every layer is
`authoring-patterns.md § Pattern coverage across peers`: enumerate the
peer set in the PR body and grep the old pattern to zero. Per-frame
state that a skip leaves behind is `§ Sentinel-init`. Time inside any of
these decisions is `Stellata.getT()`, never `Date.now()`
(`§ Single source of truth for time / camera state / world offset`).
