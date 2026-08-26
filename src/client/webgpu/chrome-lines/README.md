# Chrome lines on WebGPU

The TSL half of the chrome line seam (`../../chrome-lines/README.md` owns
the contract, the colour authoring, and why the seam exists at all). The
WebGL2 built-ins stay the shipped renderer and the semantic reference;
parity is the A/B smoke, same `/v/<blob>/` with and without the
`#renderer=webgpu` fragment.

## Files in this area

```
src/client/webgpu/chrome-lines/
  chrome-line-tsl.ts          The solid and dashed strokes: three's own
                              line fragment reproduced over the MRT
                              output struct.
  tsl-chrome-lines.ts         The factory implementing ChromeLineMaterials.
```

Both are covered against the WebGL2 half by
`../../chrome-lines/chrome-line-materials.test.ts`.

## The fragment is a transcription, not a re-derivation

`LineBasicMaterial` emits `vec4(diffuse, opacity)` and — into a render
target — no colour-space encode. So the stroke's colour member is
`vec4(materialColor, materialOpacity)`, read off the **same two material
properties** the WebGL path reads. That is what makes the parity claim
structural rather than tuned: a consumer's `material.color` /
`.opacity` write lands in this graph, and the authored chrome mapping
(`../../hdr/chrome/README.md`) needs no WebGPU variant.

The dashed stroke adds three's own dash rule over the same properties —
`lineDistance × materialLineScale`, discarded across the gap half of each
`dashSize + gapSize` period. The `lineDistance` attribute is the
consumer's own, for the reason `../../chrome-lines/README.md` gives.

Both are chrome, so **both extra attachments write `vec4(0)`** — the
blend's identity element under this alpha-composited blend, which leaves
the destination exactly as the WebGL gate's `NONE` did
(`../hdr/README.md` § The gate becomes the output struct).

## The encode the built-in path lost

three encodes linear→sRGB for the canvas and nothing for a render target.
With `outputColorSpace` pinned to the working space
(`../README.md` § Output colour space) it now encodes for **neither**, so
a stroke reaching the canvas would render linear-dark. The single-output
graph therefore owns that encode, selected on the `uHdrTarget` node
mirror, which is 0 exactly when the target is unbound — chart mode. The
struct graph stays linear, because there the target is bound.

**Never restore it by unpinning `outputColorSpace`**: that re-encodes
every ported emitter a second time and prices a hidden full-resolution
pass into every frame.

The branch is a `select`, not a graph swap, because the two off-cases of
`setMrtOutputs(false)` are different — chart mode (canvas, encode) and
the single-attachment frame-cost lever (still a target, no encode) — and
the swap carries one bit.

## Why `LineBasicNodeMaterial` when `fragmentNode` replaces its shading

The class is chosen for its **property surface**, not its graph:
`materialColor` / `materialOpacity` / `materialLineScale` resolve against
`material.color` / `.opacity` / `.scale`, and a bare `NodeMaterial` has
no `color` to resolve — `materialColor` would silently fall back to
`vec3()` and every stroke would render black.

A fat line (`Line2` / `Line2NodeMaterial`) cannot be built this way: its
fragment stage is three's own segment coverage, which `fragmentNode` would
replace. That one needs the struct composed *after* the built-in shading
(`material.outputNode` over the `output` property), and it must never take
`material.transparent` — `Line2NodeMaterial` answers that flag by
compositing against `viewportOpaqueMipTexture()` instead of blending in
hardware, a full-frame texture read per draw of the very target it is
drawing into. Spell `CustomBlending` factors out instead. No consumer
needs it yet; the coordinate sphere's equator is the one that will.
