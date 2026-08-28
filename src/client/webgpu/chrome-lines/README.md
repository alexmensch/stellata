# Chrome lines on WebGPU

The TSL half of the chrome line seam (`../../chrome-lines/README.md` owns
the contract, the colour authoring, and why the seam exists at all). The
WebGL2 built-ins stay the shipped renderer and the semantic reference;
parity is the A/B smoke, same `/v/<blob>/` with and without the
`#renderer=webgpu` fragment.

## Files in this area

```
src/client/webgpu/chrome-lines/
  chrome-line-tsl.ts          The solid, dashed and fat strokes: three's
                              own line fragment reproduced over the MRT
                              output struct (composed *after* it, for the
                              fat one), plus its blend flip.
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

A fat line (`Line2` / `Line2NodeMaterial`) cannot be built this way — its
fragment stage is three's own segment coverage, which `fragmentNode` would
replace. That one is § The fat stroke keeps three's fragment.

## The fat stroke keeps three's fragment

`buildFatChromeLineMaterial` installs its two graphs on
`material.outputNode`, not `fragmentNode`. Three runs the built-in shading
either way, assigns the result to the `output` property, and *then* lets
`outputNode` replace what leaves the stage — so the struct is composed
over `output`, which already carries the segment coverage (three's round
endcaps, and the dash discard when dashed) folded into its alpha. The
`setMrtOutputs` swap, the `fog` force and the `premultipliedAlpha` refusal
are the same ones every other emitter carries; only the install site
differs (`../hdr/mrt-material.ts`).

**It must never take `material.transparent`.** `Line2NodeMaterial`
answers that flag in `setupDiffuseColor` by compositing against
`viewportOpaqueMipTexture()` instead of blending in hardware — a
full-frame texture read per draw of the very target it is drawing into.
So `transparent` stays **false at every opacity** and the blend is spelled
as `CustomBlending` with three's own `NormalBlending` factors:
`SrcAlpha / OneMinusSrcAlpha` on colour and **`One / OneMinusSrcAlpha` on
alpha**, which is not the same pair — letting the alpha factors default
off `blendSrc` writes `a² + dst·(1−a)` into the channel the resolve
composites against. Three keeps that blend state under `transparent:
false`: `WebGPUPipelineUtils.createRenderPipeline` skips only `NoBlending`
and opaque-`NormalBlending`, and `CustomBlending` is neither. Chart mode's
opaque flip is the same function with `NoBlending`.

`alphaToCoverage` is forced off to match the WebGL2 stroke, which never
defines `USE_ALPHA_TO_COVERAGE`. What keeps the stroke's alpha alive
through that is `NodeBuilder.isOpaque()` — it requires `NormalBlending`,
so a `CustomBlending` or `NoBlending` stroke reads false and
`NodeMaterial.setupDiffuseColor` leaves the alpha rather than forcing it
to 1.

**`transparent: false` does move the draw into the opaque list, and that
is the one asymmetry the flag buys.** `isOpaque()` decides the alpha
force above and nothing else; the render list buckets on
`material.transparent` alone (`RenderList.push`), and the renderer draws
the opaque list before the transparent one. So the WebGL2 fat stroke
sorts as transparent and this one does not. It costs nothing today
because the only consumer is the coordinate spheres' equator at
`renderOrder = -1`: it draws ahead of every transparent layer on both
backends either way, and opaque geometry simply overwrites the fragments
WebGL2's depth test would have discarded instead. **A fat stroke at a
render order that interleaves with transparent layers would composite
differently on the two backends** — check that before adding the second
consumer.

The class default is `blending = NoBlending` ("transparency is not
supported, yet"), so a fat stroke that never ran the flip draws opaque
rather than not at all — the failure mode to expect if the factors are
ever set somewhere other than `setFatChromeLineOpaque`.
