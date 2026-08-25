# Boundary shells on WebGPU

The TSL half of the Fresnel-rim shell primitive: one surface, shared by
the heliopause and the Local Bubble. The WebGL2 shaders
(`../../fresnel-shell/`) stay the shipped renderer and the semantic
reference; parity is the A/B smoke, same `/v/<blob>/` with and without
the `#renderer=webgpu` fragment.

**It ports as a material swap, not a layer.** The shells keep every line
of their CPU logic — geometry, group, declutter and chart gating,
floating-origin recentre, labels, picking — and take their surface
through `../../fresnel-shell/README.md` § The material seam.

## Files in this area

```
src/client/webgpu/fresnel-shell/
  fresnel-rim-tsl.ts        TSL mirror of the stellata_fresnel_rim chunk.
                            Shared with the cloud rim shells exactly as
                            the GLSL chunk is.
  fresnel-shell-tsl.ts      The shell surface: rim alpha over an authored
                            chrome colour.
  shell-uniform-nodes.ts    TSL uniform-node twins of the GLSL factory's
                            four slots, transcribed key-for-key.
  tsl-shell-materials.ts    The factory implementing ShellMaterials.
```

## No vertex stage

`NodeMaterial`'s own model-view-projection is exactly what
`fresnel-shell.vert.glsl` does, and both its varyings are TSL built-ins —
`normalView` and `positionView`. So the material sets `fragmentNode`
alone, the same reasoning as three of the five solar-system surfaces
(`../solar-system/README.md` § Vertex stages).

`normalView` normalises after interpolation where the GLSL normalises at
use; the drawn value is the same.

## `FrontSide` is load-bearing, not a default

The hide-when-inside contract lives in the material's `side`, not in the
geometry: with outward-oriented winding the shell back-face-culls when the
camera sits inside it, which is the common near view for both consumers
(`../../fresnel-shell/README.md` § Invariants). `NodeMaterial` happens to
default to `FrontSide`, so this is set explicitly — a default that agrees
with an invariant by coincidence is not the invariant being stated.

## Chrome, so both extra attachments write zero

A shell renders **into** the HDR target (it must depth-test against the
scene) but never multiplies exposure: `uColour` goes through
`setRawChromeColour` here exactly as it does on the GLSL path, and the
chrome registry is keyed by the live `Color` — a `uniform()` node holds
one as its `.value`, so `syncMode`'s re-authoring reaches a TSL shell with
no extra registration (`../../hdr/chrome/README.md`).

Statistic and diffuse take `vec4(0)`, the identity element under both
blends a shell uses — additive for the Local Bubble, alpha-composited for
the heliopause (`../hdr/README.md` § The gate becomes the output struct).
