// Instanced volumetric emission renderer for Local Group objects —
// the luminous sibling of the wireframe layer. See ./README.md
// § The two passes.

import * as THREE from 'three';
import type { HdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import type { EmitterMaterial } from '../../solar-system/materials/emitter-material';
import {
  makeGlslLgEmissionMaterials, type LgEmissionMaterials,
} from './lg-emission-materials';
import { markDiffuseEmitter } from '../../hdr/attachments/attachment-gate';
import type { LgObject } from '../local-group-loader';
import {
  buildEmissionInstanceData,
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
  surface: EmitterMaterial;
}

export class LocalGroupEmission {
  readonly group: THREE.Group;
  /** Packed instance data, exposed for tests / debug read-back. */
  readonly instanceData: { sersic: SersicInstanceData; disc: DiscInstanceData };

  private readonly baseGeometry: THREE.SphereGeometry;
  private readonly passes: FamilyPass[] = [];
  private readonly uWorldOffset = { value: new THREE.Vector3() };
  private readonly materials: LgEmissionMaterials;

  private enabled = true;
  private chartHidden = false;

  constructor(
    objects: readonly LgObject[],
    deps: LgEmissionDeps,
    materials?: LgEmissionMaterials,
  ) {
    this.materials = materials ?? makeGlslLgEmissionMaterials({
      uWorldOffset: this.uWorldOffset, hdr: deps.hdr,
    });
    this.baseGeometry = new THREE.SphereGeometry(
      1,
      SPHERE_WIDTH_SEGMENTS,
      SPHERE_HEIGHT_SEGMENTS,
    );
    this.instanceData = buildEmissionInstanceData(objects);
    this.group = new THREE.Group();

    const { sersic, disc } = this.instanceData;
    if (sersic.count > 0) this.passes.push(this.buildPass(sersic, false));
    if (disc.count > 0) this.passes.push(this.buildPass(disc, true));
    for (const pass of this.passes) this.group.add(pass.mesh);
  }

  private buildPass(
    data: SersicInstanceData | DiscInstanceData,
    isDisc: boolean,
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

    const surface = this.materials.emission(isDisc);

    const mesh = new THREE.Mesh(geometry, surface.material);
    // Instance centres span the 2 Mpc envelope while the geometry's
    // bounding sphere is the unit ball at origin — auto-culling would
    // drop everything off-centre.
    mesh.frustumCulled = false;
    mesh.renderOrder = -3;
    markDiffuseEmitter(mesh);
    return { mesh, geometry, surface };
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
      pass.surface.dispose();
    }
    this.passes.length = 0;
    this.baseGeometry.dispose();
    this.group.clear();
  }
}
