// Shared Fresnel-rim shell primitive: material + shader pair + gating
// base for translucent boundary shells (heliopause, Local Bubble).
// See src/client/fresnel-shell/README.md.

import * as THREE from 'three';
import { createDistanceGatedLabel, type LabelFrameHost } from '../ui/distance-gated-label';
import { LABEL_OFFSET_PX } from '../solar-system/planets/planet-labels';
import { angularToPx } from '../camera/controls/star-geometry';
import { isFeatureLegible } from '../util/orbit-line';
import type { ShellRegistry } from './shell-registry';
import type { EmitterMaterial } from '../solar-system/materials/emitter-material';
import { setRawChromeColour } from '../hdr/chrome/chrome-colour';
import fresnelShellVert from './fresnel-shell.vert.glsl?raw';
import fresnelShellFrag from './fresnel-shell.frag.glsl?raw';
import fresnelRimChunk from './fresnel-rim.glsl?raw';

(THREE.ShaderChunk as Record<string, string>)['stellata_fresnel_rim'] =
  fresnelRimChunk;

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
   *  shell resolves at its tuned appearance (../hdr/README.md § Chrome). */
  colourHex: number;
  /** Alpha at the silhouette (limb); face-on alpha is this × faceOnFloor. */
  alphaLimb: number;
  /** Defaults to `NormalBlending`; pass `AdditiveBlending` for a glow. */
  blending?: THREE.Blending;
  faceOnFloor?: number;
  fresnelPower?: number;
}

/**
 * The renderer-neutral contract a boundary shell's surface is built
 * through (README.md § The material seam). Each consumer builds its own —
 * colour, limb alpha and blend are per-shell, so there is nothing to
 * share.
 */
export interface ShellMaterials {
  fresnelShell(opts: FresnelShellMaterialOptions): EmitterMaterial;
}

/** The WebGL2 implementation. A `ShaderMaterial`'s own `uniforms` map is
 *  already the slot record the contract asks for. */
export function makeGlslShellMaterials(): ShellMaterials {
  return {
    fresnelShell(opts) {
      const material = createFresnelShellMaterial(opts);
      return {
        material,
        uniforms: material.uniforms,
        dispose: () => material.dispose(),
      };
    },
  };
}

/** Build the shared Fresnel-shell `ShaderMaterial`. `FrontSide` is the
 *  hide-when-inside contract: with outward-oriented winding the shell
 *  back-face-culls when the camera sits inside it, so the near-wall glow
 *  doesn't wash the scene — it appears only from beyond the boundary. */
export function createFresnelShellMaterial(
  opts: FresnelShellMaterialOptions,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fresnelShellVert,
    fragmentShader: fresnelShellFrag,
    transparent: true,
    depthWrite: false,
    blending: opts.blending ?? THREE.NormalBlending,
    side: THREE.FrontSide,
    uniforms: {
      uColour: { value: setRawChromeColour(new THREE.Color(), opts.colourHex) },
      uAlphaLimb: { value: opts.alphaLimb },
      uFaceOnFloor: { value: opts.faceOnFloor ?? DEFAULT_FACE_ON_FLOOR },
      uFresnelPower: { value: opts.fresnelPower ?? DEFAULT_FRESNEL_POWER },
    },
  });
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

  /** Chart (mono / paper) mode hides the shell. */
  setMonochrome(on: boolean): void {
    this.mono = on;
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
    this.group.visible = this.permitted && !this.mono && this.shellReady();
  }
}

/** Whether shell `shellIdx`'s projected silhouette clears the shared
 *  feature-legibility floor this frame — the resolvability gate both
 *  boundary shells' label predicates share, so a silhouette label (fixed
 *  screen-space text) hides once the shell shrinks past legibility as the
 *  camera pulls out. Same rule the planet labels ride via the orbit-ring
 *  gate: `isFeatureLegible` on the true camera distance (no size clamp),
 *  so it reads correctly from AU-scale shells to hundred-pc ones. Takes
 *  primitives rather than a `Stellata` so it's unit-testable against a
 *  bare `ShellRegistry`. */
export function isShellLabelResolvable(
  shells: ShellRegistry,
  shellIdx: number,
  worldOffset: THREE.Vector3,
  cameraPos: THREE.Vector3,
  viewportHeightPx: number,
  fovYRad: number,
): boolean {
  const distPc = shells.cameraDistancePc(shellIdx, worldOffset, cameraPos);
  if (distPc <= 0) return false;
  return isFeatureLegible(shells.extentPc(shellIdx), distPc, angularToPx(viewportHeightPx, fovYRad));
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
