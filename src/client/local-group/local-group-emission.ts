// Instanced volumetric emission renderer for Local Group objects —
// the luminous sibling of the wireframe layer. See ./README.md
// § Emission layer.

import * as THREE from 'three';
import emissionVert from './local-group-emission.vert.glsl?raw';
import emissionFrag from './local-group-emission.frag.glsl?raw';
import type { LgObject } from './local-group-loader';
import {
  buildEmissionInstanceData,
  type DiscInstanceData,
  type SersicInstanceData,
} from './local-group-emission-pure';

// Tone-map gain + magnitude calibration, seeded from the Milky Way's
// pair (milkyway.ts DEFAULT_BRIGHTNESS / GLOW_MAG_OFFSET rationale).
// LG columns integrate to ~10²–10³ F·pc vs the MW's 10⁴–10⁵, so the
// seed brightness sits higher; both knobs are dev-tunable and retuned
// together in smoke. uGlowMagOffset shifts WHERE the slider reveals
// the layer, never per-object flux ratios — those are pinned by the
// solved density0 values.
const DEFAULT_BRIGHTNESS = 2e-4;
const GLOW_MAG_OFFSET = 15.0;

const SPHERE_WIDTH_SEGMENTS = 48;
const SPHERE_HEIGHT_SEGMENTS = 24;

/** Uniforms shared by-reference with the star pipeline, as MilkyWay
 *  does — the magnitude slider gates stars and LG glow together. */
export interface LgEmissionSharedUniforms {
  uMaxAppMag: { value: number };
  uSizeSpan: { value: number };
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
  private readonly sharedTone: {
    uBrightnessScale: { value: number };
    uGlowMagOffset: { value: number };
  };
  private readonly uWorldOffset = { value: new THREE.Vector3() };

  private enabled = true;
  private chartHidden = false;

  constructor(objects: readonly LgObject[], shared: LgEmissionSharedUniforms) {
    this.sharedTone = {
      uBrightnessScale: { value: DEFAULT_BRIGHTNESS },
      uGlowMagOffset: { value: GLOW_MAG_OFFSET },
    };
    this.baseGeometry = new THREE.SphereGeometry(
      1,
      SPHERE_WIDTH_SEGMENTS,
      SPHERE_HEIGHT_SEGMENTS,
    );
    this.instanceData = buildEmissionInstanceData(objects);
    this.group = new THREE.Group();

    const { sersic, disc } = this.instanceData;
    if (sersic.count > 0) this.passes.push(this.buildPass(sersic, false, shared));
    if (disc.count > 0) this.passes.push(this.buildPass(disc, true, shared));
    for (const pass of this.passes) this.group.add(pass.mesh);
  }

  private buildPass(
    data: SersicInstanceData | DiscInstanceData,
    isDisc: boolean,
    shared: LgEmissionSharedUniforms,
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
      geometry.setAttribute('aBulge', inst(d.bulge, 4));
      geometry.setAttribute('aBulgeExt', inst(d.bulgeExt, 2));
    } else {
      const s = data as SersicInstanceData;
      geometry.setAttribute('aSersic', inst(s.sersic, 4));
      geometry.setAttribute('aUMax', inst(s.uMax, 1));
    }

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: emissionVert,
      fragmentShader: emissionFrag,
      defines: isDisc ? { FAMILY_DISC: 1 } : {},
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
        ...this.sharedTone,
        uMaxAppMag: shared.uMaxAppMag,
        uSizeSpan: shared.uSizeSpan,
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    // Instance centres span the 2 Mpc envelope while the geometry's
    // bounding sphere is the unit ball at origin — auto-culling would
    // drop everything off-centre.
    mesh.frustumCulled = false;
    mesh.renderOrder = -3;
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

  setBrightness(x: number): void {
    this.sharedTone.uBrightnessScale.value = Math.max(0, x);
  }

  setGlowMagOffset(x: number): void {
    this.sharedTone.uGlowMagOffset.value = x;
  }

  getValues() {
    return {
      brightness: this.sharedTone.uBrightnessScale.value,
      glowMagOffset: this.sharedTone.uGlowMagOffset.value,
    };
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
