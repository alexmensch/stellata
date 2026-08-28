# The chrome line seam

Which shader backend the line overlays' strokes are built on. The layers
above — planet orbit rings, binary orbit paths, probe trails, the
constellation figure, the IAU boundary arcs, the galactic disc, both
coordinate spheres, the Local Group wireframe — keep every line of their
own logic (geometry rebuilds, anchored-line rebakes, visibility gates,
per-frame dash scale) and take their material from here, so a WebGPU boot
swaps shaders without a second copy of any of it. The primitives those
materials are handed to (`makeOrbitLineLoop` / `makeOrbitLine` /
`makeOrbitLineSegments` / `mirrorOrbitLine`) stay in `../util/orbit-line.ts`
— except the fat one (§ The fat stroke brings its own object).

## Files in this area

```
src/client/chrome-lines/
  chrome-line-materials.ts   ChromeLineMaterials, the ChromeLineMaterial
                             handle, and the two stroke shapes both
                             backends satisfy. Type-only.
  builtin-chrome-lines.ts    The WebGL2 implementation — three's own
                             LineBasicMaterial / LineDashedMaterial /
                             LineMaterial + Line2, the log-depth strip,
                             and the chrome mapping.
  chrome-line-parts.ts       The two parts neither backend varies: the
                             fat line's object assembly and the plain
                             blend flip. Both implementations call it.
  chrome-line-materials      Both backends against each other: the chrome
    .test.ts                 mapping, the blend/depth contract, the dash
                             slots, and the MRT registration's lifetime.
```

The WebGPU twin is `../webgpu/chrome-lines/tsl-chrome-lines.ts`, behind
that folder's dynamic-import boundary.

## Why a seam at all — the local depth pass has no immunity

A main-pass mesh that never ported is merely inert on a WebGPU boot: it
sits in the shell's scene, which that boot does not render. **A group
handed to the local depth pass has no such immunity** — that pass renders
on both backends, so a built-in `LineBasicMaterial` there reaches the HDR
target's three colour attachments with a one-output fragment, fails WGSL
pipeline creation, and **one invalid pipeline discards the whole pass
submit**: every planet mesh, ring annulus, atmosphere shell and star
mirror with it. Three of the five consumers draw in that pass (orbit
rings, binary orbit paths, the probe trail's mirror), which is why they
took their groups out of it until this seam existed.

## The layer writes `material`, never a wrapper

The handle carries `material`, `setOpaque()` and `dispose()`, and nothing
else: three's built-in line materials and their node twins expose the same
writable surface (`color`, `opacity`, `depthTest`, the dashed trio
`dashSize` / `gapSize` / `scale`, the fat one's `linewidth`), so a
per-frame `stroke.material.opacity = a` reaches either backend unchanged
and no layer learns which one it has. `ChromeLineStroke` /
`DashedChromeLineStroke` / `FatChromeLineStroke` are exactly that surface.

`dispose()` goes through the handle rather than the material because on
WebGPU it must also sever the material's MRT-mode registration — the same
reason `../scene/README.md` § The material seam gives.

**`setOpaque()` is on the handle for a different reason: the flag it looks
like is unusable on one backend.** Chart mode runs the coordinate spheres'
strokes opaque with blending off, which on every other material is
`transparent = false`; a WebGPU fat stroke answers that same flag with a
full-frame texture read (`../webgpu/chrome-lines/README.md` § Why
`LineBasicNodeMaterial`…), so it spells `CustomBlending` factors out
instead. A layer writing `material.transparent` itself would be correct on
three of the four combinations and quietly ruinous on the fourth.

## The fat stroke brings its own object

`fat(spec)` is the one factory that returns a drawable as well as a
material, because the **mesh class is backend-specific too**:
`three/addons/lines/Line2.js` reads `material.uniforms` in its
`onBeforeRender` and `.../lines/webgpu/Line2.js` writes its own
`_resolution` instead, so each throws or silently draws nothing on the
other's material. A thin line's class is shared, which is why
`../util/orbit-line.ts` keeps those. The geometry the spec's `points`
build stays with the layer's own child sweep, exactly as a thin line's
does; the handle frees the material and the registration.

**Only the constructor differs, so only the constructor is duplicated.**
`chrome-line-parts.ts`'s `assembleFatChromeLine` owns the geometry build,
`computeLineDistances`, the frustum-cull opt-out and the render order for
both backends, and takes `geom => new Line2(geom, mat)` as the caller's
half — the seam exists to stop the two sides drifting, so the parts that
are not backend-specific may not be copies.

**Nothing writes the fat stroke's screen-space width divisor.** Since
r185 both `LineSegments2` variants set it from `renderer.getViewport()`
before every draw, so an app-side resize hook would be a second writer of
a number three already owns (`../galactic/coord-spheres/README.md`).

## Colour is authored once, at construction

`solid(colour, …)` / `dashed(colour, …)` take an authored sRGB hex and map
it through the tone-map inverse (`setBuiltinChromeColour`) so the stroke
resolves at that appearance out of the HDR pass
(`../hdr/chrome/README.md`). Which of the two chrome setters applies is
not a free choice: these materials emit **linear** working-space
components into the target on both backends, so it is the built-in one.
A layer that re-authors its colour later (chart ink, a monochrome flip)
writes `stroke.material.color` through the same setter.

## `localPass` is a GLSL-only argument

`solid(colour, opacity, localPass)` strips three's log-depth chunks so
fragments keep standard bracket depth — required for anything drawn in the
local depth pass (`../local-depth/README.md`). On the TSL side it is
**inert**: reversed-z deleted the chunks it would strip, the same reason
the probe glyph serves both passes from one graph
(`../webgpu/solar-system/README.md` § The probe glyph needs no mirror
variant). It stays in the signature because the GLSL path still needs it
and the WebGL2 build is still the shipped one.

## One factory per boot

`stellata.ts` resolves the backend once (`webgpu?.chromeLineMaterials ??
builtinChromeLineMaterials()`) and injects the result into every consumer;
kind modules read it off `KindContext.chromeLines` rather than reaching for
the seam themselves. Each stroke is independent — the factory holds no
slots two consumers could share — so a second factory would be harmless,
but the single one is what keeps the injection sites uniform.

**That resolve has to sit AFTER `bindSharedUniforms`.** Reading
`webgpu.chromeLineMaterials` is what builds the TSL graphs, and they
resolve the shared uniform nodes on the way — so the getter throws
`chromeLineMaterials before bindSharedUniforms` while the registry is
still unbound, in the shell's constructor, before the first frame. Nothing
in the suite sees it: the WebGL2 boot takes the `??` branch, so typecheck
and every test stay green while the WebGPU boot is dead. It shipped that
way once. A new consumer of any seam factory inherits the same ordering.
