// Shared Fresnel-rim shell primitive: material + shader pair + gating
// base for translucent boundary shells (heliopause, Local Bubble).
// See src/client/fresnel-shell/README.md.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { createDistanceGatedLabel } from '../ui/distance-gated-label';
import { LABEL_OFFSET_PX } from '../solar-system/planet-labels';
import fresnelShellVert from './fresnel-shell.vert.glsl?raw';
import fresnelShellFrag from './fresnel-shell.frag.glsl?raw';

const DEFAULT_FACE_ON_FLOOR = 0.04;
const DEFAULT_FRESNEL_POWER = 2.5;

export interface FresnelShellMaterialOptions {
  colour: THREE.Color;
  /** Alpha at the silhouette (limb); face-on alpha is this × faceOnFloor. */
  alphaLimb: number;
  /** Defaults to `NormalBlending`; pass `AdditiveBlending` for a glow. */
  blending?: THREE.Blending;
  faceOnFloor?: number;
  fresnelPower?: number;
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
      uColour: { value: opts.colour },
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
  protected readonly material: THREE.ShaderMaterial;
  private mono = false;
  private permitted = true;

  protected constructor(material: THREE.ShaderMaterial, renderOrder: number) {
    this.group = new THREE.Group();
    this.group.renderOrder = renderOrder;
    this.group.visible = false;
    this.material = material;
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
    this.material.dispose();
  }

  /** Subclass gate AND'd into visibility alongside `permitted`/`!mono`. */
  protected abstract shellReady(): boolean;

  protected refreshVisibility(): void {
    this.group.visible = this.permitted && !this.mono && this.shellReady();
  }
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
  stellata: Stellata,
  opts: ShellSilhouetteLabelOptions,
): void {
  createDistanceGatedLabel(stellata, {
    ...opts,
    labelDir: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    offsetPx: LABEL_OFFSET_PX,
    lerp: 0.25,
  });
}
