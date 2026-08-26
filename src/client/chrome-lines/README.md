# The chrome line seam

Which shader backend the line overlays' strokes are built on. The layers
above — planet orbit rings, binary orbit paths, probe trails, the
constellation figure, the IAU boundary arcs — keep every line of their own
logic (geometry rebuilds, anchored-line rebakes, visibility gates,
per-frame dash scale) and take their material from here, so a WebGPU boot
swaps shaders without a second copy of any of it. The primitives those
materials are handed to (`makeOrbitLineLoop` / `makeOrbitLine` /
`makeOrbitLineSegments` / `mirrorOrbitLine`) stay in `../util/orbit-line.ts`.

## Files in this area

```
src/client/chrome-lines/
  chrome-line-materials.ts   ChromeLineMaterials, the ChromeLineMaterial
                             handle, and the two stroke shapes both
                             backends satisfy. Type-only.
  builtin-chrome-lines.ts    The WebGL2 implementation — three's own
                             LineBasicMaterial / LineDashedMaterial, the
                             log-depth strip, and the chrome mapping.
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

The handle carries `material` and `dispose()`, and nothing else: three's
built-in line materials and their node twins expose the same writable
surface (`color`, `opacity`, `depthTest`, and the dashed trio `dashSize` /
`gapSize` / `scale`), so a per-frame `stroke.material.opacity = a` reaches
either backend unchanged and no layer learns which one it has.
`ChromeLineStroke` / `DashedChromeLineStroke` are exactly that surface.

`dispose()` goes through the handle rather than the material because on
WebGPU it must also sever the material's MRT-mode registration — the same
reason `../scene/README.md` § The material seam gives.

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
