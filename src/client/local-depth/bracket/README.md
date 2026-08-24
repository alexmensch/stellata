# Local-pass bracket math — partitioning and depth precision

Member bounding spheres → the `[near, far]` bracket(s) the local depth
pass renders in, and the depth-precision argument that sizes them. The
pass itself, its cluster API and its compositing rules live one level
up (`../README.md`); this folder owns only how far the bracket reaches
and how finely depth resolves inside it.

Two encodings are live at once during the WebGPU migration: 24-bit
fixed-point depth, sliced (WebGL2, shipped) and reversed-z Depth32Float
with a single bracket (WebGPU). Both are derived below.

## Files

- `slice-pure.ts` — the whole bracket (`computeBracket`, near/far floors
  applied — the reversed-z K = 1 render range), its partition
  (`computeDepthSlices`), and the depth quantum of each encoding
  (`depthQuantumPc`, `reversedDepthQuantumPc`). Pure; no three.js.
- `slice-pure.test.ts` — pins every headline number in this README,
  including a float32 sweep of the realised quantum.

## Depth slices — unconditionally correct painter's partitioning

One 24-bit bracket cannot span a metre-scale probe (near ~0.3 m) and
Saturn's rings at 10⁵ km. `computeDepthSlices` therefore splits the
members' depth range into K equal-ratio slices, each within
`maxSliceRatio`, rendered **far→near with `clearDepth` between**.

- **Correctness needs no gaps.** A fragment farther than another can
  never land in a strictly nearer slice, so far→near painting with
  per-slice z-tests reproduces global depth ordering exactly.
  Geometry spanning a boundary (an orbit ring) simply draws in every
  slice; the slice near/far planes clip-partition its fragments, and
  the union is the complete primitive with correct per-slice depth.
- **Cost** is one extra render of a small scene per slice. K = 1–2 for
  mesh-only brackets, ~4 when an orbit-ring bound contains the camera
  (near floors at `NEAR_MIN_PC`).
- **Seam artefacts:** a fragment exactly on a boundary is measure-zero
  (float equality); no visible seam is expected. Verify in smoke; an
  epsilon overlap is the fallback if one ever shows.
- **WebGPU:** the reversed-z decision below collapses the partition to
  K = 1; the sliced form stays live on WebGL2 until cutover deletes
  that path.

## Precision analysis

### 24-bit standard depth, sliced — the shipped WebGL2 mechanism

Standard perspective depth quantum at distance `z` in `[near, far]`
(24-bit buffer, the WebGL2 default renderbuffer):

```
δz(z) = z²·(far − near) / (far·near·2²⁴)   ⇒   δz(z)/z ≤ (far/near)/2²⁴
```

A feature of physical size `s` at distance `z` is z-orderable iff
`s > δz(z)`, i.e. iff its angular size exceeds `(far/near)/2²⁴` rad at
the slice's far edge. Setting

```
maxSliceRatio = 2²⁴ · (fovY/viewportH) / SLICE_RATIO_SAFETY    (SAFETY = 4)
```

makes the smallest orderable feature at the far edge subtend **¼ px**
— everything the user can see is orderable, with margin growing
linearly toward the near plane. The bound adapts to FOV: zooming to
10° tightens the ratio (more slices), 120° relaxes it. At the default
50° / 1080 px view, `maxSliceRatio ≈ 3389`.

Pinned partitions: Saturn + rings from Mimas' orbit floor 1 slice ·
stretched to Titan 2 · full system incl. Neptune's orbit ring 4 ·
metre-scale probe near Saturn 4.

### Reversed-z Depth32Float — decision record (stellata-0it.18)

The WebGPU migration turns reversed-z on renderer-wide
(`reversedDepthBuffer: true`, established by stellata-0it.3): three's
finite-far reversed mapping `d = n·(f−z) / (z·(f−n))` (depth 1 at
near, 0 at far) into a Depth32Float attachment. Depth is stored as a
*float*, whose ulp scales with the value — `ulp(d) ≤ d·2⁻²³` — so the
world-space quantum is

```
δz(z)/z ≤ 2⁻²³ · (1 − z/f)  ≈  1.2e-7,  independent of f/n
```

**Precondition: the float32 attachment is the whole argument, and
three infers it for the CANVAS alone.** `reversedDepthBuffer` makes
`getCurrentDepthStencilFormat` pick `depth32float` only when the
render context carries no depth texture — and for any render target
three auto-creates one, `DepthFormat`/`UnsignedIntType` =
`depth24plus`, regardless of the reversed flag. So a target that
merely sets `depthBuffer: true` gets FIXED-POINT depth: a uniform
`δd = 2⁻²⁴`, i.e. `δz ≈ 2⁻²⁴·z²/n` — 262 AU at Neptune's ring against
the main pass's near, and ~20,000 km at Saturn inside a K = 1 bracket
whose near floored at `NEAR_MIN_PC` (the shipped bug: the whole ring
system inside one depth step of the body). The HDR target therefore
carries an **explicit `FloatType` depth texture** — the same move
three's own `PassNode` makes under `reversedDepthBuffer`. Asserted,
never assumed: `boot-webgpu.ts` refuses a boot whose renderer dropped
`reversedDepthBuffer`, and `WebGpuHdrPipeline` throws at target
creation unless the depth texture is `FloatType` with no stencil.

The bound is scale-free: it holds at every camera distance, bracket
ratio, and epoch, so the camera-anywhere check passes structurally
rather than case-by-case (the epoch moves which bodies are close, not
the bound). A feature is z-orderable iff it subtends ≥ 2⁻²³ rad
≈ 0.025″ — 1.5e-4 px at the default 50°/1080 px view, 7.4e-4 px at the
tightest FOV the app allows (`FOV_MIN_DEG` = 10°) — so the ¼-px
criterion above holds with 339× margin at any bracket ratio, 1695×
tighter than the sliced 24-bit guarantee (`maxSliceRatio/2²⁴ ≈
2.0e-4`).

Two second-order terms the closed form omits, both swept against the
actual float32 pipeline rather than assumed (`slice-pure.test.ts`).
`ulp(d) ≤ d·2⁻²³` is worst-case over the binade, so realised
resolution runs several× *better* than the bound; against that, float
cancellation in `z_clip = n·f/(f−n) − n·z/(f−n)` bites as `z → f`,
which is exactly where the outermost members sit, and eats most of the
`(1 − z/f)` refinement — at `z = 0.9f` the realised quantum is >3× what
storage alone predicts. Net across the extreme probe→Neptune bracket
(ratio 2e13), realised `δz/z` stays within [5.5e-9, 7.4e-8] end to
end: under the 1.2e-7 headline everywhere, so the bound survives the
cancellation it does not model. The eaul spike corroborates: AU-scale
disc ordering with zero z-flicker at the main pass's own planes
(near 1e-12 / far 1e5 pc).

Pinned scenarios, vantages exactly as in `slice-pure.test.ts`:
reversed-z evaluated at the main pass's own unchanged planes, sliced
24-bit in the local bracket that scenario actually produces. The
relative bound makes every row epoch-uniform.

| Scenario (pinned vantage) | reversed-z δz | sliced 24-bit | gain |
| --- | --- | --- | --- |
| Saturn centre from Mimas' orbit floor, 185,500 km | 22 m | 11.3 km (K=1) | 512× |
| Uranus centre from Miranda's orbit floor, 129,900 km | 15.5 m | 6.1 km (K=1) | 393× |
| Probe at its park, ~2 m — but the main-pass near (1e-12 pc ≈ 31 km) clips it | 238 nm | 772 nm (K=4) | 3.2× |
| Neptune's orbit ring at the bracket far, 41.8 AU | 746 km = the same 1.5e-4 px | 791,000 km (K=4) | 1061× |

So the main pass, at its own unchanged planes, out-orders the sliced
bracket wherever it can draw at all — by ~400–1000× on the mesh cases,
and least (3×) at the probe, where standard depth close to its own
near plane was already good. The binding constraint moves from depth
precision to the near plane: the probe sits inside it.

**Precondition: this covers standard-depth materials only.** Every
non-raw material in the main pass currently writes the three.js
log-depth chunk (MW band, molecular clouds, dust particles, planet
glare, probes), which overwrites projection depth with the ~0.14 AU
quantum of `../README.md` § Why the main pass cannot do this —
reversed-z does nothing for those. The migration retires that whole
category along with reversed-z (the frag-depth design gate,
stellata-0it.1), so the claim above holds after that lands, not before.

### Decision — keep the pass, collapse to K = 1

Slicing existed solely because one 24-bit standard-depth bracket
cannot span probe → Neptune within the ratio bound; reversed-z float32
is ratio-free, so the partition retires. The pass itself survives on
properties that are not depth precision and do not fall out of
reversed-z:

1. **Painter's compositing over the finished frame.** Members overlay
   volumetric and screen-space layers (MW band raymarch, molecular-
   cloud absorption, additive glow already blended into the frame)
   that have no per-fragment depth relation to them — valid because
   nothing non-member sits between the camera and a local body.
   Folding members into the main pass would force depth-aware ray
   termination into each such layer plus a layer-graph reorder.
2. **Dynamic near.** The bracket doubles as near-plane management:
   the camera parks at 0.3 m (`NEAR_MIN_PC`) while the main camera
   keeps near = 1e-12 pc. Retirement would need a global or dynamic
   main-pass near instead.
3. **Member suppression** keeps close-range compositing isolated from
   the main pass's Max/additive blend semantics; the mirror machinery
   is sunk cost that ports mechanically.

Retiring the pass buys none of that back and breaks WebGL2/WebGPU A/B
parity during dual-boot. Keeping slicing carries a partition whose
guarantee is now redundant, at a measured price: the pass costs 30–42%
of frame near stars and is fill-bound (4.68× on an area cut against
the frame's 3.04×), with slice-count overdraw a leading candidate
cause and the K≈4 vantages exactly the expensive ones
(stellata-8cg.25). K = 1 deletes the slice loop (single `clearDepth` +
one bracketed render), draws boundary-spanning geometry once, and
inherits reversed-z in-bracket automatically — the pass camera's
projection comes from the same reversed `makePerspective`, because the
renderer stamps `reversedDepth` on whatever camera it is handed and
`updateProjectionMatrix` reads it.

**What K = 1 gives up, and why that is safe here.** The partition is
the only mechanism ordering `depthWrite: false` translucent geometry
*across* brackets: the depth test cannot (nothing writes depth) and
three sorts transparent objects per object, by centroid. Two
properties cover the loss. Intra-body order is pinned by explicit
`renderOrder` (mesh 2.8 → rings 2.81 → atmosphere 2.82,
`../../solar-system/planets/planet-mesh-layer.ts`), which the
partition never supplied anyway. And orbit rings are
`LineBasicMaterial` with uniform colour and uniform opacity, so
alpha-over is commutative and a ring's own near/far self-overlap is
order-independent. The residual is cross-body translucent overlap
between bodies that would have landed in different brackets — the
K≈4 vantage. Smoke it: camera inside Neptune's orbit ring with several
rings drawn, watching the crossings for order flicker under scrub.
**That smoke is BLOCKED until `stellata-0it.27`** — orbit rings are the
translucent geometry it turns on, and they do not draw on the only boot
that takes K = 1 (the pass's line layers are parked there,
`../README.md` § Live providers). So the residual is argued, not yet
observed; run it as 0it.27's first check.

Shipped: `LocalDepthPass.render` takes the K = 1 branch whenever the
renderer reports `reversedDepthBuffer` (`computeBracket`, one
`clearDepth` + one bracketed render); the WebGL2 sliced path lives
until 0it.14 deletes it.

**Rejected encodings** (updated 2026-08-18):

- *Reversed-Z* — REVERSED: no longer an encoding this pass chooses, it
  inherits one. See above.
- *Local log depth* — rejection stands: with a tight far it
  degenerates to linear-in-w (uniform quantum `far/2²⁴`), which
  *fails* the small-moon case the moment far is generous (quantum
  357 km at far = 40 AU vs Miranda's 235 km radius). Standard depth's
  z² falloff concentrates precision exactly where bodies resolve.
