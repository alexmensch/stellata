# src/client/fresnel-shell/ — Fresnel-rim shell primitive

Shared runtime for translucent **boundary shells**: a mesh whose alpha
peaks at the silhouette (limb) and floors to a dim value face-on, so it
reads as a soft glowing rim rather than a flat disc. Two layers consume
the full primitive — the heliopause (`solar-system/`) and the Local
Bubble (`local-bubble/`); the molecular-cloud rim shells consume the
`stellata_fresnel_rim` chunk, the shared vertex stage
(`fresnel-shell.vert.glsl`), and the shared rim constants
(`SHELL_RIM_BLUE`, `SHELL_RIM_ALPHA_LIMB`) with their own fragment
stage (`molecular-clouds/cloud-rim.frag.glsl`).

## Files

- `fresnel-rim.glsl` — two functions, registered by `fresnel-shell.ts` as
  the `stellata_fresnel_rim` ShaderChunk and shared with
  `molecular-clouds/cloud-rim.frag.glsl`: `fresnelRimAlpha`, the rim-alpha
  formula (`fresnel = pow(1 − n·v, uFresnelPower)`,
  `alpha = uAlphaLimb · mix(uFaceOnFloor, 1, fresnel)`), and
  `shellDistanceAttenuation`, the camera-distance factor on it
  (§ Camera-distance attenuation).
- `shell-distance-pure.ts` (+ test) — the attenuation's CPU mirror and the
  authored constants every backend and consumer reads
  (`NEAR_FADE_EXTENT_FRAC`, `DEPTH_DIM_REF_PC`, `DEPTH_DIM_POWER`,
  `nearFadePcForExtent`). Vitest-pinned.
- `fresnel-shell.{vert,frag}.glsl` — the shader pair. The vert carries
  view-space normal + position; the frag applies the rim chunk.
- `fresnel-shell.ts`
  - `ShellMaterials` + `makeGlslShellMaterials()` — the material seam
    (§ The material seam below), and the only way in: the
    `ShaderMaterial` builder behind it is module-private, so a consumer
    cannot take a surface that skips the seam.
  - `FresnelShell` — abstract base owning the group, material, and the
    chart-mode + detail-cycle + floating-origin plumbing, plus
    `setRimParams` (§ Camera-distance attenuation).
  - `RimParams` + `applyRimParams(uniforms, p)` — the six live rim slots
    and the one writer behind every consumer's `setRimParams`, so a lever
    cannot reach one surface's block and miss the identically-keyed slot
    on another's.
  - `createShellSilhouetteLabel(stellata, opts)` — a `distance-gated-label`
    with the shared shell config (bottom-right anchor, standard offset,
    0.25 chase lerp).
  - `isShellLabelResolvable(shells, idx, worldOffset, cameraPos,
    viewportHeightPx, fovYRad)` — the label legibility gate both shells'
    visibility predicates share (§ Invariants below).
- `shell-materials.test.ts` — the seam's guard: the two factories' slot
  keys pinned against each other, the chrome inverse landing on the same
  mapped colour on either side, and the TSL dispose severing its MRT
  registration.
- `shell-module.ts` (+ test) — the shell `ObjectKindModule`
  (`../kinds/README.md`): one module whose `attach` constructs BOTH
  shell layers (heliopause + Local Bubble) and registers them into its
  internal registry, plus the focusable / card / hover / search / SID /
  declutter / label legs.
- `shell-registry.ts` — the shell kind's internal runtime (§ Boundary
  shells as focus targets): `SHELL_KEYS`, the `ShellInstance` contract,
  and `ShellRegistry` (owns per-shell geometry: localPositionInto,
  cameraDistancePc, viewingDistancePc, focusParkDistancePc,
  renderedSizePx). Instantiated per shell-module; no longer a
  top-level registry on `Stellata`.
- `shell-object-sids.ts` — `SHELL_OBJECT_SIDS`, the hand-written
  key → frozen-SID pin (§ SID pins).
- `shell-pick.ts` — `pickShellSilhouette`, the shared silhouette-bbox +
  label-bbox hit test (fallback tier) both shells' click / hover picks
  use, keyed on a `ShellPickSurface`.

## The material seam

Both shells take their surface from a `ShellMaterials` factory rather
than building a `ShaderMaterial` directly, so a WebGPU boot swaps shaders
without a second copy of any shell logic — geometry, group, declutter and
chart gating, recentre, labels and picking all stay as they were. The
WebGPU twin is `../webgpu/fresnel-shell/README.md`; `shell-module.ts`
passes `kindCtx.webgpu?.shellMaterials` and falls back to
`makeGlslShellMaterials()`.

Each consumer builds **its own** surface — colour, limb alpha and blend
are per-shell, so there is nothing to share and no refcount to keep.

`FresnelShell` holds the returned `EmitterMaterial` and exposes only its
`.material` to subclasses (which need it for the mesh); `dispose` goes
through the handle, because on WebGPU it must also sever the material's
MRT-mode registration and a bare `material.dispose()` would not.

## Invariants

- **Hide-when-inside.** The material is `FrontSide`; each consumer orients
  its mesh winding **outward** so the shell back-face-culls when the
  camera sits inside it (the common near view). It appears only from
  beyond the boundary. Consumers also set `frustumCulled = false` on the
  mesh — bounding-sphere culling is unreliable with the camera interior.
- **Uniforms.** `uColour` — set from the factory's `colourHex` option,
  which is mapped through the tone-map inverse (`../hdr/README.md`
  § Chrome) so the shell resolves at its tuned appearance; pass an
  authored sRGB hex, never a pre-built `THREE.Color`. Then
  `uAlphaLimb` (limb alpha, the peak),
  `uFaceOnFloor` (face-on multiplier — 0 = pure rim, 1 = flat shell;
  default 0.04), `uFresnelPower` (rim tightness — ~2 soft halo, ~5 thin
  edge; default 2.5). Then the three attenuation slots —
  `uNearFadePc` off the required `nearFadePc` option, `uDepthDimRefPc` and
  `uDepthPower` seeded from the shared constants and deliberately not
  options (§ Camera-distance attenuation). Pass
  `blending: AdditiveBlending` for a glow that
  composites over the layers behind it; the default is `NormalBlending`.
- **Visibility.** `group.visible = permitted && !mono && shellReady()`.
  `shellReady()` is the consumer's own gate — both shells are now
  declutter-governed (no focus coupling): the heliopause is always ready
  (mesh built in its ctor), the Local Bubble ready once its mesh attaches.
  `permitted` is the declutter floor (`heliopauseShell` / `localBubbleShell`,
  both `representational`). Camera-inside is handled separately by the
  back-face cull.
- **`mono` and `permitted` both start false, agreeing with
  `group.visible`, so a shell renders nothing until the declutter cycle
  pushes a permission.** `Stellata`'s constructor seeds that push
  (`applyDetailPreset` at the end of construction). Without it a shell
  whose `shellReady()` needs no attach step never appears at all:
  `detailPermitted` is a per-frame *read* cache, and an imperative layer
  never consults it. Don't "fix" a missing shell by defaulting `permitted`
  true — that just lets an unrelated `refreshVisibility()` caller reveal a
  shell nobody permitted, which is precisely how this failed before. The
  Local Bubble's attach path calls `setMonochrome` and was accidentally
  rescued by it; the heliopause has no attach step, so it stayed invisible
  on every fresh load while its label (a per-frame reader) showed.
- **Recenter.** Sol-anchored geometry (Sol = catalog origin), so the
  group parks at −worldOffset — non-zero under planet focus.

## Camera-distance attenuation

Two factors multiply the rim alpha, both off the fragment's own distance
from the camera. View space puts the camera at the origin, so that
distance is `length(positionView)` — free on both backends, no extra
varying and no per-frame CPU work.

    nearFade = clamp(d / uNearFadePc, 0, 1)
    depthDim = pow(clamp(uDepthDimRefPc / d, 0, 1), uDepthPower)

**`uNearFadePc` is per-material; the depth pair deliberately is not.**
The near-fade exists so a wall the camera is crossing ramps out instead of
popping — the shells are `FrontSide`, so without it the wall vanishes the
instant the camera passes inside. That reach has to scale with the
consumer, which spans five orders of magnitude, so all three derive it
from one shared *proportion* of their own extent
(`nearFadePcForExtent`) rather than three authored distances: the
heliopause off `HELIOPAUSE_EXTENT_PC` (120 AU), the Local Bubble off its
loader's measured `extentPc`, the cloud rim off one representative radius
because a single material serves all ~96 clouds.

The depth dimming is the opposite case. Its whole job is making relative
brightness read as relative distance — a cloud beyond the Local Bubble
wall must come out dimmer than the wall — and that is only expressible on
one absolute pc scale. A per-shell or normalised falloff cannot state it,
so `DEPTH_DIM_REF_PC` is shared and no material takes it as an option.
It is inverse-linear by default: clouds span ~50–2000 pc, so the
inverse-square exponent is a 1600× range that blacks out everything past
the nearest handful.

The heliopause takes the depth term too and it is a no-op there — at AU
scale `uDepthDimRefPc / d` clamps to 1 from every distance the shell is
visible from — which beats a per-material opt-out flag.

**Chart mode is excluded by structure, not by a condition.** Ink density
varying with distance would break the flat printed-atlas convention. Both
boundary shells hide outright in chart mode, and the cloud rim's chart arm
returns before it reaches the shared chunk, so there is nothing to gate;
`molecular-clouds/cloud-glsl-drift.test.ts` pins that the attenuation is
unreachable from the chart arm. Do not add a branch that would look
load-bearing and is not.

**Sweeping the constants.** `setRimParams` takes the same six-field record
on both `stellata.kinds.shell` (fanned out to both shells) and
`stellata.kinds.cloud.layer`. The depth pair spans both kinds, so settling
it by eye means the same call on each — a sweep on one alone leaves the
other on the old scale and the comparison the term exists for is
meaningless.

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
- **Registering an instance:** the shell module's `attach` registers
  each shell with `label`, `sid` (`SHELL_OBJECT_SIDS[key]`), `card`
  (type line / size / provenance — non-luminous, so no magnitude rows),
  `centerAbsInto` (absolute ICRS center), and `extentPc`
  (representative radius). An absent shell leaves its slot empty and
  every dispatch falls through to null (same graceful path as an
  unloaded `lg` layer); the SID domain attaches regardless — the
  module's `sids()` list is static.
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
