# Ring systems — annulus shaders and the radial strip

Saturn, plus Uranus + Neptune's faint rings at true opacity. `../README.md`
owns the mesh-LOD regime these render inside; the strip data pipeline is
`data/textures/README.md` § Ring strips, which also carries the spans and
the Jupiter exclusion.

```
src/client/solar-system/planets/rings/
  planet-rings.vert.glsl,
  planet-rings.frag.glsl   Ring-annulus shaders (radial strip sample,
                           lit/transmitted faces, body shadow). Built and
                           driven by ../planet-mesh-layer.ts.
```

`Planet.rings` adds an annulus mesh in the body's equatorial plane (IAU
pole; host orbital plane as the no-elements fallback), textured by the
`<body>-rings.png` 1-D radial strip (RGB colour, A opacity; U =
inner→outer edge). Lit face gets full strip colour, unlit face a dimmer
transmitted factor, both fading out as illumination goes edge-on; the
far-side segment inside the body's shadow (analytic ray–ellipsoid test
toward the host) drops to a residual floor. Rendered only in the mesh-LOD
regime: alpha rides the same crossfade `uFade`, hidden until the strip
texture arrives (no representative-colour fallback), `renderOrder` 2.81
(after the body mesh) with `depthWrite: false`.

**The strip RGB is not sRGB-decoded**, which is the one thing about these
shaders that looks like a bug and isn't — `../emission/README.md`
§ Colour bookkeeping carries why.

**Body occlusion is the local depth pass's z-buffer**: meshes + annuli
render in the bracketed second pass (`../../../local-depth/README.md`),
where standard depth orders ring↔body natively — including the oblate
limb. The analytic ray–ellipsoid helper survives only for the body-shadow
term (sun ray, not camera ray). Geometry drawn near a planet body in the
MAIN pass still cannot depth-test against it (same README, § Why the main
pass cannot do this) — new close-range geometry belongs in the local pass,
not behind a new analytic trick. Edge-on the zero-thickness annulus thins
to a line, which is the physically honest look.

**Rings do dim a source behind them in the exposure statistic** — no
z-test could, they write no depth. The annulus composites over its
statistic texel like any other alpha-blended emitter, at the strip's
**face-on** opacity: a rasterised fragment carries no opening angle, so
the slant-path enhancement the source walk applied analytically
(`T = (1 − α)^(1/|sin B|)`, opaque edge-on) is gone
(`../../../hdr/attachments/README.md` § Known residuals).
