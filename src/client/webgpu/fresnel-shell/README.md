# Boundary shells on WebGPU

The Fresnel-rim shell surface, shared by the heliopause and the Local
Bubble. Its CPU half — geometry, rim params, the distance ladder — is
`../../fresnel-shell/`.

**A material, not a layer.** The shells own all of their CPU logic —
geometry, group, declutter and chart gating, floating-origin recentre,
labels, picking — and take their surface through `../../fresnel-shell/README.md` § The material seam.

## Files in this area

```
src/client/webgpu/fresnel-shell/
  fresnel-rim-tsl.ts        The rim shape and the camera-distance
                            attenuation. Shared with the cloud rim shells.
  fresnel-shell-tsl.ts      The shell surface: attenuated rim alpha over an
                            authored chrome colour.
  shell-uniform-nodes.ts    The surface's seven slots as TSL nodes.
  tsl-shell-materials.ts    The factory implementing ShellMaterials.
```

## No vertex stage

`NodeMaterial`'s own model-view-projection is exactly what
`./fresnel-shell-tsl.ts` does, and both its varyings are TSL built-ins —
`normalView` and `positionView`. So the material sets `fragmentNode`
alone, the same reasoning as three of the five solar-system surfaces
(`../solar-system/README.md` § Vertex stages).

`positionView` is the same built-in the camera-distance attenuation reads
(`../../fresnel-shell/README.md` § Camera-distance attenuation), so that
term costs no varying here either, and its `length` is the one the rim
shape's `viewDir` divides by — `.toVar()`, so the graph emits a single
root. Its math lives in
`shell-distance-pure.ts` with the graph as thin composition over it, per
`../tsl/README.md` § TSL test pattern leg 3 — what the graph renders is
the A/B parity smoke, not a unit test.

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
`setRawChromeColour`, and the chrome registry is keyed by the live
`Color` — a `uniform()` node holds one as its `.value`, so `syncMode`'s re-authoring reaches a TSL shell with
no extra registration (`../../hdr/chrome/README.md`).

Statistic and diffuse take `vec4(0)`, the identity element under both
blends a shell uses — additive for the Local Bubble, alpha-composited for
the heliopause (`../hdr/README.md` § The gate becomes the output struct).
