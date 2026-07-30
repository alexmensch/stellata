// The GPU coverage measurement: an occluder-depth pass, one fragment per
// light source, and an async readback. Design in README.md.

import * as THREE from 'three';
import { angularToPx } from '../../../camera/controls/star-geometry';
import { fullscreenTriangleGeometry } from '../../../util/fullscreen-pass';
import fullscreenVert from '../../../util/fullscreen-pass.vert.glsl?raw';
import type { MemberSphere } from '../../../local-depth/slice-pure';
import coverageFrag from './coverage.frag.glsl?raw';
import { CoverageReadback } from './coverage-readback';
import {
  clearRingSlot,
  type CoverageRingSources,
  type CoverageSource,
  landTransmission,
  measuredSourceCount,
  packRingSlot,
  packSourceTexels,
} from './coverage-pack-pure';
import {
  COVERAGE_DEPTH_SCALE,
  COVERAGE_MAX_RINGS,
  COVERAGE_MAX_SOURCES,
  coverageBracket,
} from './coverage-pure';

export type { CoverageRingSources, CoverageSource, RingOccluder } from './coverage-pack-pure';

export interface CoveragePassDeps {
  /** The scene the occluders come from — the local depth pass's own, so
   *  the measurement runs against the geometry the frame actually drew. */
  occluderScene: THREE.Scene;
  /** The member spheres the local pass partitioned this frame. Empty means
   *  no cluster is active, and therefore nothing close enough to occlude. */
  spheres: () => readonly MemberSphere[];
  rings: CoverageRingSources;
  /** Viewport in CSS px, held by reference so resizes reach it. */
  viewport: { value: THREE.Vector2 };
}

export class CoveragePass {
  private readonly deps: CoveragePassDeps;
  private readonly scene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera();
  private readonly size = new THREE.Vector2();
  private readonly sourceTexels = new Float32Array(COVERAGE_MAX_SOURCES * 4);
  private readonly keys = new Int32Array(COVERAGE_MAX_SOURCES);
  private readonly transmission = new Map<number, number>();
  private readonly ringCentre = Array.from(
    { length: COVERAGE_MAX_RINGS }, () => new THREE.Vector4());
  private readonly ringPole = Array.from(
    { length: COVERAGE_MAX_RINGS }, () => new THREE.Vector4());
  private readonly ringAlphaScale = new Float32Array(COVERAGE_MAX_RINGS);

  /** Null until the first `ensureResources`; false parks the pass for the
   *  session on hardware with no float-renderable target. */
  private supported: boolean | null = null;
  private sourceTexture: THREE.DataTexture | null = null;
  private placeholder: THREE.DataTexture | null = null;
  private depthRt: THREE.WebGLRenderTarget | null = null;
  private coverageRt: THREE.WebGLRenderTarget | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private readback: CoverageReadback | null = null;

  constructor(deps: CoveragePassDeps) {
    this.deps = deps;
  }

  /**
   * Mean throughput over `sourceKey`'s footprint: 1 for anything the last
   * completed measurement did not cover, which is the direction that cannot
   * invent a dark frame — an unmeasured source keeps all its flux and so can
   * only ever provoke a cut.
   */
  transmissionFor(sourceKey: number): number {
    return this.transmission.get(sourceKey) ?? 1;
  }

  /**
   * Measure this frame's sources against this frame's occluder depth, and
   * leave the result in flight. Call **after** the local depth pass, whose
   * spheres set the bracket and whose scene supplies the geometry; restores
   * the render target and the camera's near/far before returning.
   */
  measure(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    sources: readonly CoverageSource[],
    count: number,
  ): void {
    this.consume();
    // One readback in flight, so a frame whose predecessor has not landed
    // does no GPU work at all rather than queueing a second.
    if (this.readback?.pending === true) return;
    const bracket = coverageBracket(this.deps.spheres());
    if (bracket === null || count <= 0) {
      this.transmission.clear();
      return;
    }
    if (!this.ensureResources(renderer)) return;
    const n = measuredSourceCount(count);
    this.writeSources(sources, n);
    this.writeRings(camera);
    this.writeUniforms(camera, bracket, n);
    this.renderOccluderDepth(renderer, camera, bracket);
    renderer.setRenderTarget(this.coverageRt);
    renderer.render(this.scene, this.quadCamera);
    this.readback?.request(n);
    renderer.setRenderTarget(null);
  }

  /** Land a completed readback into the transmission map. Keys come from
   *  the frame that issued it — nothing is uploaded while one is in flight,
   *  so `this.keys` still describes those texels. */
  private consume(): void {
    const done = this.readback?.poll();
    if (!done) return;
    landTransmission(this.keys, done.pixels, done.count, this.transmission);
  }

  private writeSources(sources: readonly CoverageSource[], n: number): void {
    packSourceTexels(sources, n, this.sourceTexels, this.keys);
    if (this.sourceTexture !== null) this.sourceTexture.needsUpdate = true;
  }

  private writeRings(camera: THREE.PerspectiveCamera): void {
    let slot = 0;
    this.deps.rings.forEachRingOccluder(camera, (ring) => {
      if (slot >= COVERAGE_MAX_RINGS) return;
      packRingSlot(ring, this.ringCentre[slot], this.ringPole[slot]);
      this.ringAlphaScale[slot] = ring.alphaScale;
      const u = this.material?.uniforms;
      if (u) u[`uRingStrip${slot}`].value = ring.strip;
      slot++;
    });
    for (let i = slot; i < COVERAGE_MAX_RINGS; i++) {
      clearRingSlot(this.ringCentre[i], this.ringPole[i]);
      this.ringAlphaScale[i] = 0;
    }
  }

  private writeUniforms(
    camera: THREE.PerspectiveCamera,
    bracket: { nearPc: number; farPc: number },
    n: number,
  ): void {
    const u = this.material?.uniforms;
    if (!u) return;
    const viewport = this.deps.viewport.value;
    const fovYRad = THREE.MathUtils.degToRad(camera.fov);
    const tanHalfY = Math.tan(0.5 * fovYRad);
    u.uSourceCount.value = n;
    (u.uBracketPc.value as THREE.Vector2).set(bracket.nearPc, bracket.farPc);
    (u.uViewportPx.value as THREE.Vector2).copy(viewport);
    (u.uTanHalfFov.value as THREE.Vector2).set(tanHalfY * camera.aspect, tanHalfY);
    // The same pixels-per-radian the sample's diameterPx was measured with,
    // so the shader's self-occlusion radius inverts it exactly.
    u.uPxPerRadian.value = angularToPx(viewport.y, fovYRad);
  }

  private renderOccluderDepth(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    bracket: { nearPc: number; farPc: number },
  ): void {
    const near0 = camera.near;
    const far0 = camera.far;
    const autoClear0 = renderer.autoClear;
    camera.near = bracket.nearPc;
    camera.far = bracket.farPc;
    camera.updateProjectionMatrix();
    renderer.autoClear = true;
    renderer.setRenderTarget(this.depthRt);
    renderer.render(this.deps.occluderScene, camera);
    renderer.autoClear = autoClear0;
    camera.near = near0;
    camera.far = far0;
    camera.updateProjectionMatrix();
  }

  /** Lazy, and re-derived from the renderer every frame so window resize
   *  and pixel-ratio changes need no hook of their own. */
  private ensureResources(renderer: THREE.WebGLRenderer): boolean {
    if (this.supported === false) return false;
    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) {
      this.supported = false;
      return false;
    }
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x * COVERAGE_DEPTH_SCALE));
    const h = Math.max(1, Math.floor(this.size.y * COVERAGE_DEPTH_SCALE));
    if (this.depthRt !== null) {
      this.depthRt.setSize(w, h);
      return true;
    }
    if (gl.getExtension('EXT_color_buffer_float') === null) {
      this.supported = false;
      return false;
    }
    this.supported = true;

    // A depth TEXTURE so the shader can sample it, at DEPTH_COMPONENT24 —
    // the local pass's own attachment stays untouched (README.md § The
    // depth bracket). The colour attachment is a throwaway three requires.
    const depthTexture = new THREE.DepthTexture(w, h);
    this.depthRt = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture,
    });
    this.coverageRt = new THREE.WebGLRenderTarget(COVERAGE_MAX_SOURCES, 1, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.sourceTexture = new THREE.DataTexture(
      this.sourceTexels, COVERAGE_MAX_SOURCES, 1,
      THREE.RGBAFormat, THREE.FloatType,
    );
    this.sourceTexture.minFilter = THREE.NearestFilter;
    this.sourceTexture.magFilter = THREE.NearestFilter;
    this.sourceTexture.needsUpdate = true;
    this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.placeholder.needsUpdate = true;

    this.geometry = fullscreenTriangleGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uSources: { value: this.sourceTexture },
        uSourceCount: { value: 0 },
        uOccluderDepth: { value: depthTexture },
        uBracketPc: { value: new THREE.Vector2(1, 2) },
        uViewportPx: { value: new THREE.Vector2(1, 1) },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uPxPerRadian: { value: 1 },
        uRingCentre: { value: this.ringCentre },
        uRingPole: { value: this.ringPole },
        uRingAlphaScale: { value: this.ringAlphaScale },
        uRingStrip0: { value: this.placeholder },
        uRingStrip1: { value: this.placeholder },
        uRingStrip2: { value: this.placeholder },
      },
      vertexShader: fullscreenVert,
      fragmentShader: coverageFrag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.readback = new CoverageReadback(gl, COVERAGE_MAX_SOURCES);
    return true;
  }

  dispose(): void {
    this.scene.clear();
    this.readback?.dispose();
    this.depthRt?.depthTexture?.dispose();
    this.depthRt?.dispose();
    this.coverageRt?.dispose();
    this.sourceTexture?.dispose();
    this.placeholder?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
    this.readback = null;
    this.depthRt = null;
    this.coverageRt = null;
    this.sourceTexture = null;
    this.placeholder = null;
    this.material = null;
    this.geometry = null;
    this.supported = null;
    this.transmission.clear();
  }
}
