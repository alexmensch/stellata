// Per-star A_V cache: renders one camera→star dust raymarch per star
// into a star-indexed float target, recomputed only when the camera
// moves beyond RECOMPUTE_EPSILON_PC. See README.md § Dust extinction.

import * as THREE from 'three';
import prepassVert from '../../util/fullscreen-pass.vert.glsl?raw';
import prepassFrag from './extinction-prepass.frag.glsl?raw';
import { fullscreenTriangleGeometry } from '../../util/fullscreen-pass';
import {
  AV_TEX_WIDTH,
  RECOMPUTE_EPSILON_PC,
  avTexHeight,
  packPositionsRgba,
  movedBeyondEpsilon,
} from './extinction-prepass-pure';

/** Uniform value-objects shared by reference with the star pipeline's
 *  sharedUniforms map: the dust-field inputs the prepass march reads,
 *  and the two consumer uniforms it owns the writes to. */
export interface ExtinctionPrepassUniforms {
  uDustTexture: { value: THREE.Data3DTexture | null };
  uDustBoundsPc: { value: number };
  uDustDensityMin: { value: number };
  uDustLogRatio: { value: number };
  uDustAvPerDensityPc: { value: number };
  uAvPrepassTex: { value: THREE.Texture | null };
  uAvPrepassEnabled: { value: number };
}

export interface ExtinctionPrepassOptions {
  renderer: THREE.WebGLRenderer;
  /** Absolute (heliocentric ICRS) star positions, xyz-interleaved —
   *  catalog.positions, NOT the floating-origin local buffer. */
  positions: Float32Array;
  count: number;
  uniforms: ExtinctionPrepassUniforms;
}

export class ExtinctionPrepass {
  /** False when EXT_color_buffer_float is unavailable — the instance is
   *  inert and star.vert stays on its in-vertex raymarch fallback. */
  readonly supported: boolean;

  private renderer: THREE.WebGLRenderer;
  private uniforms: ExtinctionPrepassUniforms;
  private rt: THREE.WebGLRenderTarget | null = null;
  private posTex: THREE.DataTexture | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();

  private dirty = true;
  private hasComputed = false;
  private forceDisabled = false;
  private lastCamX = Infinity;
  private lastCamY = Infinity;
  private lastCamZ = Infinity;

  constructor({ renderer, positions, count, uniforms }: ExtinctionPrepassOptions) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.supported =
      renderer.getContext().getExtension('EXT_color_buffer_float') !== null;
    if (!this.supported) return;

    const height = avTexHeight(count);
    this.posTex = new THREE.DataTexture(
      packPositionsRgba(positions, count),
      AV_TEX_WIDTH,
      height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.posTex.minFilter = THREE.NearestFilter;
    this.posTex.magFilter = THREE.NearestFilter;
    this.posTex.needsUpdate = true;

    this.rt = new THREE.WebGLRenderTarget(AV_TEX_WIDTH, height, {
      format: THREE.RedFormat,
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.geometry = fullscreenTriangleGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uDustTexture: uniforms.uDustTexture,
        uDustBoundsPc: uniforms.uDustBoundsPc,
        uDustDensityMin: uniforms.uDustDensityMin,
        uDustLogRatio: uniforms.uDustLogRatio,
        uDustAvPerDensityPc: uniforms.uDustAvPerDensityPc,
        uPosTex: { value: this.posTex },
        uAbsCameraPos: { value: new THREE.Vector3() },
      },
      vertexShader: prepassVert,
      fragmentShader: prepassFrag,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** Invalidate the cache — next update() recomputes regardless of
   *  camera displacement. Called on dust attach and per chunk upload. */
  markDirty() {
    this.dirty = true;
  }

  /** Dev-console A/B switch: false parks star.vert on the in-vertex
   *  raymarch fallback without touching the cache. */
  setEnabled(on: boolean) {
    this.forceDisabled = !on;
    this.syncConsumerUniforms();
  }

  /** Per-frame hook, called with the camera's absolute (heliocentric
   *  ICRS) position before the main render. Recomputes the A_V target
   *  when dirty or the camera moved beyond epsilon; otherwise free. */
  update(absCamX: number, absCamY: number, absCamZ: number) {
    if (this.rt === null || this.material === null) return;
    if (this.uniforms.uDustTexture.value === null) return;
    const moved = movedBeyondEpsilon(
      this.lastCamX, this.lastCamY, this.lastCamZ,
      absCamX, absCamY, absCamZ,
      RECOMPUTE_EPSILON_PC,
    );
    if (!this.dirty && !moved) return;

    (this.material.uniforms.uAbsCameraPos.value as THREE.Vector3)
      .set(absCamX, absCamY, absCamZ);
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);

    this.lastCamX = absCamX;
    this.lastCamY = absCamY;
    this.lastCamZ = absCamZ;
    this.dirty = false;
    this.hasComputed = true;
    this.syncConsumerUniforms();
  }

  private syncConsumerUniforms() {
    const on = this.hasComputed && !this.forceDisabled && this.rt !== null;
    this.uniforms.uAvPrepassEnabled.value = on ? 1 : 0;
    this.uniforms.uAvPrepassTex.value = on ? this.rt!.texture : null;
  }

  dispose() {
    this.uniforms.uAvPrepassEnabled.value = 0;
    this.uniforms.uAvPrepassTex.value = null;
    this.rt?.dispose();
    this.posTex?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
    this.rt = null;
    this.posTex = null;
    this.material = null;
    this.geometry = null;
    this.hasComputed = false;
    this.dirty = true;
    this.lastCamX = Infinity;
    this.lastCamY = Infinity;
    this.lastCamZ = Infinity;
  }
}
