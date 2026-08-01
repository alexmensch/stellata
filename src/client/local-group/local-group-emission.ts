// Instanced volumetric emission renderer for Local Group objects —
// the luminous sibling of the wireframe layer. See ./README.md
// § Emission layer.

import * as THREE from 'three';
import emissionVert from './local-group-emission.vert.glsl?raw';
import emissionFrag from './local-group-emission.frag.glsl?raw';
import type { HdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { markDiffuseEmitter } from '../hdr/statistic/statistic-attachment';
import type { LgObject } from './local-group-loader';
import {
  buildEmissionInstanceData,
  EMISSION_STEPS_DISC,
  EMISSION_STEPS_SERSIC,
  type DiscInstanceData,
  type SersicInstanceData,
} from './local-group-emission-pure';

const SPHERE_WIDTH_SEGMENTS = 48;
const SPHERE_HEIGHT_SEGMENTS = 24;

export interface LgEmissionDeps {
  /** `HdrPipeline.emitterUniforms`, by reference so exposure, pixel
   *  solid angle and the inline-operator branch reach both family
   *  passes with one write. This layer only reads them — the exposure
   *  model is the only thing that moves the glow's brightness. */
  hdr: HdrEmitterUniforms;
}

interface FamilyPass {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.ShaderMaterial;
}

export class LocalGroupEmission {
  readonly group: THREE.Group;
  /** Packed instance data, exposed for tests / debug read-back. */
  readonly instanceData: { sersic: SersicInstanceData; disc: DiscInstanceData };

  private readonly baseGeometry: THREE.SphereGeometry;
  private readonly passes: FamilyPass[] = [];
  private readonly uWorldOffset = { value: new THREE.Vector3() };

  private enabled = true;
  private chartHidden = false;

  constructor(objects: readonly LgObject[], deps: LgEmissionDeps) {
    this.baseGeometry = new THREE.SphereGeometry(
      1,
      SPHERE_WIDTH_SEGMENTS,
      SPHERE_HEIGHT_SEGMENTS,
    );
    this.instanceData = buildEmissionInstanceData(objects);
    this.group = new THREE.Group();

    const { sersic, disc } = this.instanceData;
    if (sersic.count > 0) this.passes.push(this.buildPass(sersic, false, deps));
    if (disc.count > 0) this.passes.push(this.buildPass(disc, true, deps));
    for (const pass of this.passes) this.group.add(pass.mesh);
  }

  private buildPass(
    data: SersicInstanceData | DiscInstanceData,
    isDisc: boolean,
    deps: LgEmissionDeps,
  ): FamilyPass {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = this.baseGeometry.index;
    geometry.setAttribute('position', this.baseGeometry.getAttribute('position'));
    geometry.instanceCount = data.count;
    const inst = (arr: Float32Array, itemSize: number) =>
      new THREE.InstancedBufferAttribute(arr, itemSize);
    geometry.setAttribute('aCenterAbs', inst(data.centerAbs, 3));
    geometry.setAttribute('aQuat', inst(data.quat, 4));
    geometry.setAttribute('aAxes', inst(data.axes, 3));
    geometry.setAttribute('aColor', inst(data.color, 3));
    if (isDisc) {
      const d = data as DiscInstanceData;
      geometry.setAttribute('aDisc', inst(d.disc, 3));
    } else {
      const s = data as SersicInstanceData;
      geometry.setAttribute('aSersic', inst(s.sersic, 4));
      geometry.setAttribute('aUMax', inst(s.uMax, 1));
    }

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: emissionVert,
      fragmentShader: emissionFrag,
      defines: isDisc
        ? { FAMILY_DISC: 1, EMISSION_STEPS: EMISSION_STEPS_DISC }
        : { EMISSION_STEPS: EMISSION_STEPS_SERSIC },
      // Same render contract as the MilkyWay volumetric pass: BackSide
      // gives one fragment per ray with the back face as the natural
      // exit; entry is computed analytically in the fragment shader.
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uWorldOffset: this.uWorldOffset,
        // Exposure, pixel solid angle, and the inline-operator branch.
        // Owned by HdrPipeline; this layer only reads them.
        ...deps.hdr,
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    // Instance centres span the 2 Mpc envelope while the geometry's
    // bounding sphere is the unit ball at origin — auto-culling would
    // drop everything off-centre.
    mesh.frustumCulled = false;
    mesh.renderOrder = -3;
    markDiffuseEmitter(mesh);
    return { mesh, geometry, material };
  }

  /** Per-frame: refresh the floating-origin offset the vertex shader
   *  subtracts from each instance's absolute centre. */
  update(worldOffset: THREE.Vector3): void {
    if (!this.groupVisible()) return;
    this.uWorldOffset.value.copy(worldOffset);
  }

  private groupVisible(): boolean {
    const visible = this.enabled && !this.chartHidden;
    this.group.visible = visible;
    return visible;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.groupVisible();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Chart (paper) mode hides the volumetric glow entirely — the
   *  wireframes carry the LG chart aesthetic. */
  setChartHidden(hidden: boolean): void {
    this.chartHidden = hidden;
    this.groupVisible();
  }

  dispose(): void {
    for (const pass of this.passes) {
      pass.geometry.dispose();
      pass.material.dispose();
    }
    this.passes.length = 0;
    this.baseGeometry.dispose();
    this.group.clear();
  }
}
