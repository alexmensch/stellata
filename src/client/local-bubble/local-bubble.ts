// Translucent Fresnel shell of the Local Bubble's dust wall. See
// src/client/local-bubble/README.md.

import * as THREE from 'three';
import type { LocalBubbleMesh } from './local-bubble-loader';
import localBubbleVert from './local-bubble.vert.glsl?raw';
import localBubbleFrag from './local-bubble.frag.glsl?raw';

// Dim additive tints — the camera sits inside the cavity, so the inner
// face is the common view; the outer face is seen only from beyond the
// wall (>200 pc out). Distinct hues so the shell's orientation reads.
const INNER_COLOUR = new THREE.Color(0x4a6a8c);
const OUTER_COLOUR = new THREE.Color(0x8c6a4a);
const ALPHA_LIMB = 0.5;
const FACE_ON_FLOOR = 0.04;
const FRESNEL_POWER = 2.5;

export class LocalBubbleShell {
  readonly group: THREE.Group;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry | null = null;
  private mesh: THREE.Mesh | null = null;
  private centroidAbs = new THREE.Vector3();
  private mono = false;
  // Detail-cycle permission (floor 'representational'); AND'd with the
  // chart gate. False hides the shell.
  private permitted = true;

  constructor() {
    this.group = new THREE.Group();
    // renderOrder −1 (with the galactic disc): a background shell, so the
    // local stars inside it composite on top. See src/client/README.md
    // § Render order.
    this.group.renderOrder = -1;
    this.group.visible = false;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: localBubbleVert,
      fragmentShader: localBubbleFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uInnerColour: { value: INNER_COLOUR },
        uOuterColour: { value: OUTER_COLOUR },
        uAlphaLimb: { value: ALPHA_LIMB },
        uFaceOnFloor: { value: FACE_ON_FLOOR },
        uFresnelPower: { value: FRESNEL_POWER },
      },
    });
  }

  /** Build the shell from a parsed mesh. Idempotent — replaces any prior
   *  mesh. Vertex positions are absolute ICRS pc (Sol origin); `recenter`
   *  applies the floating origin. */
  attach(data: LocalBubbleMesh): void {
    this.disposeGeometry();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    this.geometry.computeVertexNormals();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    // The camera sits inside the ~200 pc shell; auto bounding-sphere
    // culling is unreliable there, so clip per-vertex on the GPU.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = this.group.renderOrder;
    this.group.add(this.mesh);
    this.centroidAbs.set(data.centroid[0], data.centroid[1], data.centroid[2]);
    this.group.visible = this.visibleNow();
  }

  /** Volume-centroid in renderer-local coords (absolute − worldOffset),
   *  the label anchor. Written into `out`. */
  centroidLocalInto(worldOffset: Readonly<THREE.Vector3>, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.centroidAbs).sub(worldOffset);
  }

  /** Floating-origin recentre. Vertices are absolute Sol-origin ICRS pc,
   *  so the group sits at −worldOffset. */
  recenter(newOrigin: Readonly<THREE.Vector3>): void {
    this.group.position.copy(newOrigin).negate();
  }

  setPermitted(on: boolean): void {
    this.permitted = on;
    this.group.visible = this.visibleNow();
  }

  setMonochrome(on: boolean): void {
    this.mono = on;
    this.group.visible = this.visibleNow();
  }

  private visibleNow(): boolean {
    return this.mesh !== null && this.permitted && !this.mono;
  }

  dispose(): void {
    this.disposeGeometry();
    this.material.dispose();
  }

  private disposeGeometry(): void {
    if (this.mesh) this.group.remove(this.mesh);
    this.geometry?.dispose();
    this.geometry = null;
    this.mesh = null;
  }
}
