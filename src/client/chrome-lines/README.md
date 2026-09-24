# The chrome line seam

Where the line overlays' strokes get their materials. The layers
above — planet orbit rings, binary orbit paths, probe trails, the
constellation figure, the IAU boundary arcs, the galactic disc, both
coordinate spheres, the Local Group wireframe — keep every line of their
own logic (geometry rebuilds, anchored-line rebakes, visibility gates,
per-frame dash scale) and take their material from here, so the shader
side stays in one place. The primitives those
materials are handed to (`makeOrbitLineLoop` / `makeOrbitLine` /
`makeOrbitLineSegments` / `mirrorOrbitLine`) stay in `../util/orbit-line.ts`
— except the fat one ([The fat stroke brings its own object](#the-fat-stroke-brings-its-own-object)).

## Files in this area

```
src/client/chrome-lines/
  chrome-line-materials.ts   ChromeLineMaterials, the ChromeLineMaterial
                             handle, and the three stroke shapes an
                             implementation satisfies. Type-only.
  chrome-line-parts.ts       The fat line's object assembly and the plain
                             blend flip — the parts an implementation
                             does not vary.
  chrome-lines-mock.ts       Test double: three's own LineBasicMaterial /
                             LineDashedMaterial / LineMaterial + Line2,
                             which satisfy the handle's writable surface
                             without a device.
  chrome-line-materials      The shipped factory: the chrome mapping, the
    .test.ts                 blend/depth contract, the dash slots, and
                             the MRT registration's lifetime.
```

The implementation is `../webgpu/chrome-lines/tsl-chrome-lines.ts`, behind
that folder's dynamic-import boundary.

## Why a seam at all — no graph has immunity

**Both graphs the app draws go through the same renderer** — the one
scene the shell builds ([One scene per boot](../webgpu/README.md#one-scene-per-boot)) and
the local depth pass. So a built-in `LineBasicMaterial` in either reaches the HDR
target's three colour attachments with a one-output fragment, fails WGSL
pipeline creation, and **one invalid pipeline discards the whole
submit**: every planet mesh, ring annulus, atmosphere shell and star
mirror with it. Three of the consumers draw in the local pass (orbit
rings, binary orbit paths, the probe trail's mirror), which is why they
took their groups out of it until this seam existed.

## The layer writes `material`, never a wrapper

The handle carries `material`, `setOpaque()` and `dispose()`, and nothing
else: three's built-in line materials and their node twins expose the same
writable surface (`color`, `opacity`, `depthTest`, the dashed trio
`dashSize` / `gapSize` / `scale`, the fat one's `linewidth`), so a
per-frame `stroke.material.opacity = a` reaches the material unchanged and
a suite can drive a layer through the double. `ChromeLineStroke` /
`DashedChromeLineStroke` / `FatChromeLineStroke` are exactly that surface.

`dispose()` goes through the handle rather than the material because it
must also sever the material's MRT-mode registration — the same reason
[The material seam](../scene/README.md#the-material-seam) gives.

**`setOpaque()` is on the handle for a different reason: the flag it looks
like is unusable on the fat stroke.** Chart mode runs the coordinate
spheres' strokes opaque with blending off, which on every other material is
`transparent = false`; the fat stroke answers that same flag with a
full-frame texture read ([Why](../webgpu/chrome-lines/README.md#why-linebasicnodematerial-when-fragmentnode-replaces-its-shading)
`LineBasicNodeMaterial`…), so it spells `CustomBlending` factors out
instead. A layer writing `material.transparent` itself would be correct on
every stroke but that one, and quietly ruinous on it.

## The fat stroke brings its own object

`fat(spec)` is the one factory that returns a drawable as well as a
material, because the **mesh class is the renderer's own too**:
`three/addons/lines/Line2.js` reads `material.uniforms` in its
`onBeforeRender` and `.../lines/webgpu/Line2.js` writes its own
`_resolution` instead, so each throws or silently draws nothing on the
other's material. A thin line's class is shared, which is why
`../util/orbit-line.ts` keeps those. The geometry the spec's `points`
build stays with the layer's own child sweep, exactly as a thin line's
does; the handle frees the material and the registration.

**Only the constructor differs, so only the constructor is duplicated.**
`chrome-line-parts.ts`'s `assembleFatChromeLine` owns the geometry build,
`computeLineDistances`, the frustum-cull opt-out and the render order, and
takes `geom => new Line2(geom, mat)` as the caller's half, so the shipped
factory and the double cannot drift on everything around the class.

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
components into the target, so it is the built-in one.
A layer that re-authors its colour later (chart ink, a monochrome flip)
writes `stroke.material.color` through the same setter.

## One stroke shape, both passes

A local-pass stroke takes the same material as a main-pass one: reversed-z
leaves fragments on standard bracket depth already
(`../local-depth/README.md`), the same reason the probe glyph serves both
passes from one graph ([The probe glyph](../webgpu/solar-system/README.md#the-probe-glyph-is-one-material-across-both-passes)
needs no mirror variant).

## One factory per boot

`webgpu.chromeLineMaterials` is built on first read and cached for the
boot, so the shell's layers and the kind modules (through
`KindContext.webgpu`) all hold the same factory. Each stroke is
independent — the factory holds no slots two consumers could share — so
the cache buys one set of injection semantics rather than correctness.

**That read has to sit AFTER `bindSharedUniforms`.** Reading
`webgpu.chromeLineMaterials` is what builds the TSL graphs, and they
resolve the shared uniform nodes on the way — so the getter throws
`chromeLineMaterials before bindSharedUniforms` while the registry is
still unbound, in the shell's constructor, before the first frame. A new
consumer of any seam factory inherits the same ordering.
