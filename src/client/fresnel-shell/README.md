# src/client/fresnel-shell/ — Fresnel-rim shell primitive

Shared runtime for translucent **boundary shells**: a mesh whose alpha
peaks at the silhouette (limb) and floors to a dim value face-on, so it
reads as a soft glowing rim rather than a flat disc. Two layers consume
it — the heliopause (`solar-system/`) and the Local Bubble
(`local-bubble/`).

## Files

- `fresnel-shell.{vert,frag}.glsl` — the shader pair. The vert carries
  view-space normal + position; the frag computes
  `fresnel = pow(1 − n·v, uFresnelPower)` and
  `alpha = uAlphaLimb · mix(uFaceOnFloor, 1, fresnel)`.
- `fresnel-shell.ts`
  - `createFresnelShellMaterial(opts)` — builds the `ShaderMaterial`.
  - `FresnelShell` — abstract base owning the group, material, and the
    chart-mode + detail-cycle + floating-origin plumbing.
  - `createShellSilhouetteLabel(stellata, opts)` — a `distance-gated-label`
    with the shared shell config (bottom-right anchor, standard offset,
    0.25 chase lerp).

## Invariants

- **Hide-when-inside.** The material is `FrontSide`; each consumer orients
  its mesh winding **outward** so the shell back-face-culls when the
  camera sits inside it (the common near view). It appears only from
  beyond the boundary. Consumers also set `frustumCulled = false` on the
  mesh — bounding-sphere culling is unreliable with the camera interior.
- **Uniforms.** `uColour`, `uAlphaLimb` (limb alpha, the peak),
  `uFaceOnFloor` (face-on multiplier — 0 = pure rim, 1 = flat shell;
  default 0.04), `uFresnelPower` (rim tightness — ~2 soft halo, ~5 thin
  edge; default 2.5). Pass `blending: AdditiveBlending` for a glow that
  composites over the layers behind it; the default is `NormalBlending`.
- **Visibility.** `group.visible = permitted && !mono && shellReady()`.
  `shellReady()` is the consumer's own gate (heliopause: Sol-focus;
  Local Bubble: mesh-attached). Starts hidden until a gate opens it.
- **Recenter.** Sol-anchored geometry (Sol = catalog origin), so the
  group parks at −worldOffset — non-zero under planet focus.

See `src/client/README.md` § Full render stack for where each consumer
sits in the render order.
