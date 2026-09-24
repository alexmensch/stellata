// Shared Fresnel-rim shell primitive: material seam + gating base for
// translucent boundary shells (heliopause, Local Bubble).
// See src/client/fresnel-shell/README.md.

import * as THREE from 'three';
import { createDistanceGatedLabel, type LabelFrameHost } from '../overlays/distance-gated-label';
import { LABEL_OFFSET_PX } from '../solar-system/planets/labels/planet-labels';
import { angularToPx } from '../camera/controls/star-geometry';
import type { ShellRegistry } from './shell-registry';
import type { EmitterMaterial } from '../scene/emitter-material';

export const DEFAULT_FACE_ON_FLOOR = 0.04;
export const DEFAULT_FRESNEL_POWER = 2.5;

/** Dim additive cool tint shared by the Local Bubble shell and the
 *  molecular-cloud rim shells — one annotation colour for "boundary of
 *  a thing you can't actually see". */
export const SHELL_RIM_BLUE = 0x5a7a9c;

/** Limb alpha shared by the same two consumers — one rim strength so a
 *  cloud shell and the Local Bubble wall read as the same annotation
 *  vocabulary. */
export const SHELL_RIM_ALPHA_LIMB = 0.5;

export interface FresnelShellMaterialOptions {
  /** Authored sRGB hex; mapped through the tone-map inverse here so the
   *  shell resolves at its tuned appearance (../hdr/README.md#chrome--non-physical-layers-keep-their-authored-look). */
  colourHex: number;
  /** Face-on alpha is this × `faceOnFloor`. */
  alphaLimb: number;
  /** The shell's representative radius (pc). Both camera-distance reaches
   *  come off it via `rimDistancesForExtent` — consumers span five orders
   *  of magnitude, so neither is authored per shell. A shell whose extent
   *  arrives with its mesh passes 0 and writes both at attach. */
  extentPc: number;
  /** Defaults to `NormalBlending`; pass `AdditiveBlending` for a glow. */
  blending?: THREE.Blending;
  faceOnFloor?: number;
  fresnelPower?: number;
}

/** The live rim levers, in one vocabulary across every rim consumer —
 *  the boundary shells and the ~96 cloud rims (§ Dev-console levers).
 *  The two distance reaches are also how a shell whose extent arrives with
 *  its mesh states them, as one `rimDistancesForExtent` record. */
export interface RimParams {
  alphaLimb?: number;
  faceOnFloor?: number;
  fresnelPower?: number;
  nearFadePc?: number;
  depthDimRefPc?: number;
  depthPower?: number;
}

/** Write whichever rim slots the caller named. One writer for every rim
 *  consumer, so a lever cannot reach one surface's uniform block and miss
 *  the identically-keyed slot on another's. */
export function applyRimParams(
  uniforms: Record<string, THREE.IUniform>,
  p: RimParams,
): void {
  if (p.alphaLimb !== undefined) uniforms.uAlphaLimb.value = p.alphaLimb;
  if (p.faceOnFloor !== undefined) uniforms.uFaceOnFloor.value = p.faceOnFloor;
  if (p.fresnelPower !== undefined) uniforms.uFresnelPower.value = p.fresnelPower;
  if (p.nearFadePc !== undefined) uniforms.uNearFadePc.value = p.nearFadePc;
  if (p.depthDimRefPc !== undefined) uniforms.uDepthDimRefPc.value = p.depthDimRefPc;
  if (p.depthPower !== undefined) uniforms.uDepthPower.value = p.depthPower;
}

/**
 * The renderer-neutral contract a boundary shell's surface is built
 * through (README.md#the-material-seam). Each consumer builds its own —
 * colour, limb alpha and blend are per-shell, so there is nothing to
 * share.
 */
export interface ShellMaterials {
  fresnelShell(opts: FresnelShellMaterialOptions): EmitterMaterial;
}

/** Base for a Sol-anchored translucent shell layer. Owns the group, the
 *  shared material, and the chart-mode (`mono`) + detail-cycle
 *  (`permitted`) gates; subclasses supply the mesh and a `shellReady`
 *  gate (Sol-focus, mesh-attached, …) that AND's into visibility. */
export abstract class FresnelShell {
  readonly group: THREE.Group;
  protected readonly material: THREE.Material;
  private readonly surface: EmitterMaterial;
  private mono = false;
  /** Starts false so it agrees with `group.visible` below: the shell shows
   *  only once the declutter cycle has actually pushed a permission, which
   *  `Stellata`'s constructor seeds. Starting it true left the two fields
   *  disagreeing, and a shell whose `shellReady` needs no attach step (the
   *  heliopause) then rendered nothing until the user cycled the detail
   *  level. */
  private permitted = false;
  /** Starts true, agreeing with the registry's own seeded contribution
   *  state — unlike `permitted`, nothing has to push this one before the
   *  shell may draw; the first skip is what turns it off. */
  private contributing = true;

  protected constructor(surface: EmitterMaterial, renderOrder: number) {
    this.group = new THREE.Group();
    this.group.renderOrder = renderOrder;
    this.group.visible = false;
    this.surface = surface;
    this.material = surface.material;
  }

  /** Detail-cycle permission (declutter floor). */
  setPermitted(on: boolean): void {
    this.permitted = on;
    this.refreshVisibility();
  }

  /** Live rim levers — the same call the cloud layer takes. */
  setRimParams(p: RimParams): void {
    applyRimParams(this.surface.uniforms, p);
  }

  /** Chart (mono / paper) mode hides the shell. */
  setMonochrome(on: boolean): void {
    this.mono = on;
    this.refreshVisibility();
  }

  /** Contribution gate — a third term of the conjunction rather than a
   *  bare `group.visible` write, because nothing repaints this layer per
   *  frame: `refreshVisibility` runs only on a pushed change, so a raw
   *  write would leave the shell hidden forever after one skip. */
  setContributing(on: boolean): void {
    this.contributing = on;
    this.refreshVisibility();
  }

  /** Floating-origin recentre. The shell is Sol-anchored and Sol is the
   *  catalog origin, so its renderer-local position is −worldOffset —
   *  non-zero under planet focus, where the origin sits on the planet. */
  recenter(newOrigin: Readonly<THREE.Vector3>): void {
    this.group.position.copy(newOrigin).negate();
  }

  /** Live rendered visibility — the actual `group.visible` conjunction. */
  isVisible(): boolean {
    return this.group.visible;
  }

  dispose(): void {
    this.surface.dispose();
  }

  /** Subclass gate AND'd into visibility alongside `permitted`/`!mono`. */
  protected abstract shellReady(): boolean;

  protected refreshVisibility(): void {
    this.group.visible =
      this.contributing && this.permitted && !this.mono && this.shellReady();
  }
}

/** Whether shell `shellIdx`'s projected silhouette clears the shared
 *  feature-legibility floor this frame — the resolvability gate both
 *  boundary shells' label predicates share, so a silhouette label (fixed
 *  screen-space text) hides once the shell shrinks past legibility as the
 *  camera pulls out. It is `ShellRegistry.isLegible` under a viewport /
 *  FOV pair rather than a plate scale, which is the same test the layer's
 *  contribution verdict runs — so a label can never outlive the mesh it
 *  names, or the mesh the label. Takes primitives rather than a
 *  `Stellata` so it's unit-testable against a bare `ShellRegistry`. */
export function isShellLabelResolvable(
  shells: ShellRegistry,
  shellIdx: number,
  worldOffset: THREE.Vector3,
  cameraPos: THREE.Vector3,
  viewportHeightPx: number,
  fovYRad: number,
): boolean {
  return shells.isLegible(
    shellIdx, worldOffset, cameraPos, angularToPx(viewportHeightPx, fovYRad));
}

export interface ShellSilhouetteLabelOptions {
  elementId: string;
  sampleCount: number;
  getWorldSample: (i: number, out: THREE.Vector3) => void;
  visible: () => boolean;
}

/** A distance-gated silhouette label carrying the shared shell config:
 *  bottom-right anchor, standard label offset, 0.25 chase lerp. The label
 *  hugs the projected silhouette and auto-hides when the camera is inside
 *  the shell (a sample crosses behind the near plane). */
export function createShellSilhouetteLabel(
  host: LabelFrameHost,
  opts: ShellSilhouetteLabelOptions,
): () => void {
  return createDistanceGatedLabel(host, {
    ...opts,
    labelDir: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    offsetPx: LABEL_OFFSET_PX,
    lerp: 0.25,
  });
}
