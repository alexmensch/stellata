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
  - `isShellLabelResolvable(shells, idx, worldOffset, cameraPos,
    viewportHeightPx, fovYRad)` — the label legibility gate both shells'
    visibility predicates share (§ Invariants below).
- `shell-registry.ts` — the focus-target seam (§ Boundary shells as
  focus targets): `SHELL_KEYS`, the `ShellInstance` contract, and
  `ShellRegistry` (owns per-shell geometry: localPositionInto,
  cameraDistancePc, viewingDistancePc, focusParkDistancePc,
  renderedSizePx).
- `shell-object-sids.ts` — `SHELL_OBJECT_SIDS`, the hand-written
  key → frozen-SID pin (§ SID pins).
- `shell-pick.ts` — `pickShellSilhouette`, the shared silhouette-bbox +
  label-bbox hit test (fallback tier) both shells' click / hover picks
  use, keyed on a `ShellPickSurface`.

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
  `shellReady()` is the consumer's own gate — both shells are now
  declutter-governed (no focus coupling): the heliopause is always ready
  (mesh built in its ctor), the Local Bubble ready once its mesh attaches.
  `permitted` is the declutter floor (`heliopauseShell` / `localBubbleShell`,
  both `representational`). Starts hidden until the declutter cycle permits
  it. Camera-inside is handled separately by the back-face cull.
- **Recenter.** Sol-anchored geometry (Sol = catalog origin), so the
  group parks at −worldOffset — non-zero under planet focus.

## Boundary shells as focus targets

Both shells are full search / focus / warp / pin targets under one shared
`'shell'` `TargetKind` — objects like any other, joining the kind-generic
interaction machinery with zero per-kind branches (`camera/focus/README.md`
§ FocusableProviders). The seam is additive: the gate landed the kind +
dispatch + exhaustive-map entries, and each shell instance registers into
`ShellRegistry` without touching a switch.

- **`ShellRegistry`** holds one `ShellInstance` per `SHELL_KEYS` slot.
  A `Target {kind:'shell'}` idx is the `SHELL_KEYS` index — the same value
  the SID domain's localIndex uses, so the three (Target idx, SID local
  index, `SHELL_OBJECT_SIDS` order) stay aligned. Append to `SHELL_KEYS`
  only; never reorder.
- **Registering an instance:** call `stellata.shells.register(key, {...})`
  from the shell's attach path with `label`, `sid`
  (`SHELL_OBJECT_SIDS[key]`), `card` (type line / size / provenance —
  non-luminous, so no magnitude rows), `centerAbsInto` (absolute ICRS
  center), and `extentPc` (representative radius). An absent shell leaves
  its slot empty and every dispatch falls through to null (same graceful
  path as an unloaded `lg` layer).
- **Framing.** Focus parks at `viewingDistanceForExtent(extent)` via the
  generic park-radius path — no new camera code. This aligns with the
  hide-when-inside invariant above: the pulled-out "whole shell on screen"
  distance is exactly where the back-face-culled wall becomes visible.
- **Neither shell is focus-coupled.** Visibility is purely the declutter
  floor + chart mode (+ the automatic hide-when-inside cull) — the
  heliopause was decoupled from its old Sol-focus gate once the declutter
  cycle covered it. So both render whenever their tier is decluttered on,
  independent of what's focused (a warp changes focus but not shell
  visibility). A future ~1px LOD cull is tracked separately (a shell far
  enough to be sub-pixel still draws today).
- **Label legibility floor.** The shell mesh itself has no distance
  cutoff (previous bullet), but its silhouette label is screen-space
  fixed-size text, so without a floor it would keep reading long after
  the shell has visually shrunk to nothing. Both labels' visibility
  predicates gate on `isShellLabelResolvable`: the shell's projected
  angular *radius* at the true camera distance must clear
  `FEATURE_LEGIBILITY_MIN_PX` (`util/orbit-line.ts`). That's the same
  screen-size floor the planet labels ride through the orbit-ring
  visibility gate — one legibility rule shared across labelled features,
  correct from AU-scale shells (heliopause) to hundred-pc ones (Local
  Bubble). Do **not** reuse `ShellRegistry.renderedSizePx` here: that
  carries a 1 pc distance clamp for chevron sizing, which floors an
  AU-scale shell's projected size below the threshold so its label would
  never show.

## SID pins

Neither shell is catalogued (the heliopause is generated; `local-bubble.bin`
carries no sid field), so both mint SIDs like the Sol system rather than the
in-record sibling artifacts: a committed `data/sid/shell-objects.tsv` list +
the hand-written `SHELL_OBJECT_SIDS` pin here, asserted against the ledger by
a vitest (tests import, never redefine). See `docs/sid.md` § 7. Without a SID
a shell silently drops from a shared `?v=`.

See `src/client/README.md` § Full render stack for where each consumer
sits in the render order.
