// Fill pass for the band's measured-dust froxel grid: one layer per
// log-distance slice, one fragment per screen cell, marching the Edenhofer
// grid over that cell ray's own shell. See ./README.md.

import * as THREE from 'three';
import fillVert from '../../util/fullscreen-pass.vert.glsl?raw';
import fillFrag from './froxel-fill.frag.glsl?raw';
import { fullscreenTriangleGeometry } from '../../util/fullscreen-pass';
import type { DustFieldUniforms } from '../dust-field-uniforms';
import { S_MIN_PC } from '../../milkyway/milkyway-column-pure';
import {
  RECOMPUTE_EPSILON_PC,
  movedBeyondEpsilon,
} from '../../star-pipeline/extinction/extinction-prepass-pure';
import {
  PINNED_CELL_RAD,
  PINNED_FILL_STEPS_PER_VOXEL,
  PINNED_SLICES,
} from './froxel-pins';
import {
  ROTATION_EPSILON_RAD,
  coverageSpanPc,
  fillSamplesPerRay,
  froxelGridDims,
  rotatedBeyondEpsilon,
} from './froxel-grid-pure';

const BYTES_PER_TEXEL = 2;

const axisDir = new THREE.Vector3();

export interface FroxelFillOptions {
  renderer: THREE.WebGLRenderer;
  uniforms: DustFieldUniforms;
  /** The sphere inscribed in the data cube — the cascade's measured domain. */
  coverageRadiusPc: number;
  voxelPc: number;
}

/** What the debug readout and the benchmark both report the grid as. */
export interface FroxelFillStats {
  readonly enabled: boolean;
  readonly cellsX: number;
  readonly cellsY: number;
  readonly slices: number;
  readonly texels: number;
  readonly mib: number;
  readonly fillStepPc: number;
  /** Samples the view-axis ray costs — null when it misses coverage. */
  readonly axisSamples: number | null;
  /** cells × axis samples: the fetch count the cost model prices, which holds
   *  exactly from Sol (every sightline crosses the full radius) and is an
   *  on-axis estimate anywhere else. */
  readonly predictedFetches: number;
  readonly fills: number;
}

export class FroxelFillSpike {
  /** False without EXT_color_buffer_float — no half-float render target, so
   *  the instance is inert rather than silently pricing a different format. */
  readonly supported: boolean;

  private renderer: THREE.WebGLRenderer;
  private coverageRadiusPc: number;
  private fillStepPc: number;
  private rt: THREE.WebGLArrayRenderTarget | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private scene = new THREE.Scene();
  private drawCamera = new THREE.OrthographicCamera();

  private enabled = false;
  private cellsX = 0;
  private cellsY = 0;
  private fills = 0;
  private lastCamX = Infinity;
  private lastCamY = Infinity;
  private lastCamZ = Infinity;
  private lastQuat = new THREE.Quaternion(NaN, NaN, NaN, NaN);
  private basis = new THREE.Matrix3();

  constructor({ renderer, uniforms, coverageRadiusPc, voxelPc }: FroxelFillOptions) {
    this.renderer = renderer;
    this.coverageRadiusPc = coverageRadiusPc;
    this.fillStepPc = voxelPc / PINNED_FILL_STEPS_PER_VOXEL;
    this.supported =
      renderer.getContext().getExtension('EXT_color_buffer_float') !== null;
    if (!this.supported) return;

    this.geometry = fullscreenTriangleGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uDustTexture: uniforms.uDustTexture,
        uDustBoundsPc: uniforms.uDustBoundsPc,
        uDustDensityMin: uniforms.uDustDensityMin,
        uDustLogRatio: uniforms.uDustLogRatio,
        uDustAvPerDensityPc: uniforms.uDustAvPerDensityPc,
        uAbsCameraPos: { value: new THREE.Vector3() },
        uCameraBasis: { value: this.basis },
        uTanHalfFov: { value: new THREE.Vector2() },
        uGridDims: { value: new THREE.Vector2() },
        uCoverageRadiusPc: { value: coverageRadiusPc },
        uFillStepPc: { value: this.fillStepPc },
        uSlices: { value: PINNED_SLICES },
        uSliceIndex: { value: 0 },
        uSMinPc: { value: S_MIN_PC },
      },
      vertexShader: fillVert,
      fragmentShader: fillFrag,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** A/B switch mirroring `setExtinctionPrepassEnabled`. Off is the default:
   *  the fill costs multiples of the star prepass on every camera change, so
   *  it stays parked until a measurement asks for it. */
  setEnabled(on: boolean) {
    this.enabled = on && this.supported;
    if (!this.enabled) this.releaseTarget();
    else this.invalidate();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Force the next update() to fill regardless of camera state. */
  invalidate() {
    this.lastCamX = Infinity;
    this.lastCamY = Infinity;
    this.lastCamZ = Infinity;
    this.lastQuat.set(NaN, NaN, NaN, NaN);
  }

  /**
   * Per-frame hook. Fills only when the view actually changed — a
   * view-parameterised grid is stale on rotation as well as translation, so
   * the gate is the per-star prepass's displacement ε **and** a rotation ε.
   * An idle camera costs nothing, which is half of what this spike measures.
   */
  update(camera: THREE.PerspectiveCamera, absCam: THREE.Vector3) {
    if (!this.enabled || this.material === null) return;
    if (this.material.uniforms.uDustTexture.value === null) return;
    const moved = movedBeyondEpsilon(
      this.lastCamX, this.lastCamY, this.lastCamZ,
      absCam.x, absCam.y, absCam.z,
      RECOMPUTE_EPSILON_PC,
    );
    const turned = rotatedBeyondEpsilon(
      camera.quaternion.dot(this.lastQuat),
      ROTATION_EPSILON_RAD,
    );
    if (!moved && !turned) return;
    this.renderFill(camera, absCam);
  }

  /** Fill unconditionally — the benchmark's entry point, where the gate is
   *  exactly what must not be in the way. */
  renderFill(camera: THREE.PerspectiveCamera, absCam: THREE.Vector3) {
    if (!this.enabled || this.material === null) return;
    camera.updateMatrixWorld();
    const dims = froxelGridDims(camera.fov, camera.aspect, PINNED_CELL_RAD);
    if (this.rt === null || dims.x !== this.cellsX || dims.y !== this.cellsY) {
      this.allocateTarget(dims.x, dims.y);
    }

    const u = this.material.uniforms;
    (u.uAbsCameraPos.value as THREE.Vector3).copy(absCam);
    this.basis.setFromMatrix4(camera.matrixWorld);
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    (u.uTanHalfFov.value as THREE.Vector2).set(tanY * camera.aspect, tanY);
    (u.uGridDims.value as THREE.Vector2).set(this.cellsX, this.cellsY);

    const prevTarget = this.renderer.getRenderTarget();
    for (let k = 0; k < PINNED_SLICES; k++) {
      u.uSliceIndex.value = k;
      this.renderer.setRenderTarget(this.rt, k);
      this.renderer.render(this.scene, this.drawCamera);
    }
    this.renderer.setRenderTarget(prevTarget);

    this.lastCamX = absCam.x;
    this.lastCamY = absCam.y;
    this.lastCamZ = absCam.z;
    this.lastQuat.copy(camera.quaternion);
    this.fills++;
  }

  stats(camera: THREE.PerspectiveCamera, absCam: THREE.Vector3): FroxelFillStats {
    const dims = froxelGridDims(camera.fov, camera.aspect, PINNED_CELL_RAD);
    const cells = dims.x * dims.y;
    const texels = cells * PINNED_SLICES;
    axisDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const span = coverageSpanPc(
      absCam.x, absCam.y, absCam.z,
      axisDir.x, axisDir.y, axisDir.z,
      this.coverageRadiusPc,
    );
    const axisSamples = span === null
      ? null
      : fillSamplesPerRay(span.far - Math.max(span.near, S_MIN_PC), this.fillStepPc);
    return {
      enabled: this.enabled,
      cellsX: dims.x,
      cellsY: dims.y,
      slices: PINNED_SLICES,
      texels,
      mib: (texels * BYTES_PER_TEXEL) / 1024 / 1024,
      fillStepPc: this.fillStepPc,
      axisSamples,
      predictedFetches: cells * (axisSamples ?? 0),
      fills: this.fills,
    };
  }

  private allocateTarget(cellsX: number, cellsY: number) {
    this.rt?.dispose();
    const rt = new THREE.WebGLArrayRenderTarget(cellsX, cellsY, PINNED_SLICES, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    // WebGLArrayRenderTarget replaces the texture its super built, dropping
    // whatever format the options carried — set it here or the grid silently
    // allocates 4 bytes per texel instead of the 2 the cost table prices.
    rt.texture.format = THREE.RedFormat;
    rt.texture.type = THREE.HalfFloatType;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.generateMipmaps = false;
    this.rt = rt;
    this.cellsX = cellsX;
    this.cellsY = cellsY;
  }

  private releaseTarget() {
    this.rt?.dispose();
    this.rt = null;
    this.cellsX = 0;
    this.cellsY = 0;
  }

  dispose() {
    this.releaseTarget();
    this.material?.dispose();
    this.geometry?.dispose();
    this.material = null;
    this.geometry = null;
    this.enabled = false;
    this.fills = 0;
    this.invalidate();
  }
}
