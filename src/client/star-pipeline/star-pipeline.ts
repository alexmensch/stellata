import * as THREE from 'three';
import type { Catalog } from '../loaders/catalog-loader';
import { markStatisticEmitter } from '../hdr/attachments/attachment-gate';
import { interleavePulsParams } from './pulsation/pulsation-params-pure';
import { STAR_PASS_CORE_MASK, STAR_PASS_DISC, STAR_PASS_GLOW } from './star-pass';

// Disc-pass blending state. Applied at material construction and re-applied
// on chart-mode -> colour-mode swap-back, since chart mode swaps the disc
// material to MultiplyBlending. Single source of truth for the four
// CustomBlending fields plus the depth flags, so a change to the blend
// equation only needs to touch one site.
export function applyDiscBlendDefaults(m: THREE.Material) {
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquation = THREE.MaxEquation;
  m.premultipliedAlpha = false;
  m.depthWrite = true;
  m.depthTest = true;
}

// Glow-pass blending state — the additive sibling of
// applyDiscBlendDefaults, shared by the star pipeline, its local-pass
// mirror, the planet body field, and the WebGPU port's NodeMaterial
// (hence THREE.Material — every field set here lives on the base class)
// so the four fields live in one place. Additive so overlapping distant
// glows accumulate; no depth write so co-located glows all contribute;
// depth test on so a glow behind a disc drawn earlier is occluded.
// Re-applied on chart-mode -> colour-mode swap-back (chart flips glow to
// MultiplyBlending).
export function applyGlowBlendDefaults(m: THREE.Material) {
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.blending = THREE.AdditiveBlending;
  m.premultipliedAlpha = false;
}

// Chart-mode ink blending — the swap every emitter drawing flat ink on
// paper takes, shared so the three call sites cannot diverge.
//
// `premultipliedAlpha` is load-bearing, not cosmetic: three.js REFUSES
// MultiplyBlending without it, and the refusal is silent-ish — it logs,
// issues no blendFunc at all, then caches the swap as applied so it
// never retries. The draw inherits whatever blend func the previous
// material left, which is why the symptom is order-dependent (correct
// entering chart on load, white discs toggling in) rather than a
// consistent failure.
export function applyMonochromeBlend(m: THREE.Material) {
  m.blending = THREE.MultiplyBlending;
  m.premultipliedAlpha = true;
  m.depthWrite = false;
  m.depthTest = false;
}

/**
 * The disc + glow pair's whole chart-mode swap, both directions, for one
 * backend. `discDefaults` is the only thing that differs between them:
 * the GLSL disc writes its own `gl_FragDepth` and restores
 * `applyDiscBlendDefaults` as-is, while the TSL disc must come back with
 * `depthWrite` off (`../webgpu/star/star-disc-tsl.ts`).
 *
 * Both materials need `needsUpdate` — the blend state is compiled into
 * the program on either backend, and a swap that skips it renders with
 * the previous mode's blending.
 */
export function applyChartBlendSwap(
  disc: THREE.Material,
  glow: THREE.Material,
  on: boolean,
  discDefaults: (m: THREE.Material) => void,
) {
  if (on) {
    applyMonochromeBlend(disc);
    applyMonochromeBlend(glow);
  } else {
    discDefaults(disc);
    applyGlowBlendDefaults(glow);
  }
  disc.needsUpdate = true;
  glow.needsUpdate = true;
}

/** The per-vertex unit-square corner + index pair every star quad
 *  geometry starts from (main pipeline, local mirror by reference, and
 *  the WebGPU port's). Corners span [-0.5, +0.5]². */
export const STAR_QUAD_CORNERS = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
export const STAR_QUAD_INDEX = [0, 1, 2, 1, 3, 2];

export interface StarPipelineOptions {
  scene: THREE.Scene;
  catalog: Catalog;
  /** Per-star log10(physicalRadius_solar). Decoded shader-side via
   *  `pow(10, iLogRadius)` and multiplied by `uRSunPc` to recover parsecs. */
  logRadii: Float32Array;
  /** Per-star luminosity class as Float32 (255 = unknown, preserved
   *  through the conversion and handled inside the shader). */
  lumClassF32: Float32Array;
  /** Per-star distance from Sol in pc. Replaces the shader's old
   *  `length(iPosition)` derivation, which broke when iPosition shifted
   *  to local-frame after the floating-origin recentre. */
  distSol: Float32Array;
  /** Per-star best Apsis Teff (K). 0 = no Apsis solution; gates the
   *  shader's Apsis-direct routing tier (`iTeffApsis > 0`). Built from
   *  the catalog's gspphot/gspspec fields by `bestApsisTeff` upstream. */
  teffApsis: Float32Array;
  /** Buffer backing the dynamic `iPosition` attribute. Owned by the
   *  caller — Stellata's floating-origin recentre rewrites it in place
   *  and bumps `iPositionAttr.needsUpdate`. Must outlive the pipeline. */
  localPositions: Float32Array;
  /** Buffer backing the dynamic `iCompositeSuppress` attribute. 1.0
   *  collapses the disc and core-mask passes for that instance to an
   *  off-screen clip-space sentinel; the additive glow pass still runs.
   *  Written by `BinaryOrbitField` for sub-pixel binary secondaries.
   *  Must outlive the pipeline. */
  compositeSuppress: Float32Array;
  /** Buffer backing the dynamic `iEclipseDim` attribute. 1.0 = no
   *  occlusion; < 1.0 dims the back component's contribution to the
   *  glow pass so a sub-pixel binary pair shows a proper photometric
   *  dip when one star transits the other from the camera viewpoint.
   *  Written by `EclipsePhotometryField`. Must outlive the pipeline. */
  eclipseDim: Float32Array;
  /** Per-instance pulsation-suppress flag. 1.0 zeros the GCVS-amplitude
   *  radial pulsation in the vertex shader. Built once at catalog-load
   *  from `varType` alone (binary-independent); not rewritten per-frame.
   *  See src/client/binaries/eclipse/README.md § Pulsation gate for eclipsing
   *  binaries. */
  suppressPulsation: Float32Array;
  vertexShader: string;
  fragmentShader: string;
  /** Shared uniforms map. Each pass spreads it with its own
   *  `uRenderMode`; the value-object identities are preserved so a
   *  single uniform write propagates to disc + glow + core-mask. */
  sharedUniforms: Record<string, THREE.IUniform>;
  /** Bounding-sphere radius (pc) covering every star in the catalog —
   *  feeds three.js frustum culling (we disable it on the meshes too,
   *  but the bound is still useful as documentation of the world span). */
  boundingSphereRadiusPc: number;
}

/**
 * Owns the InstancedBufferGeometry + the three RawShaderMaterials + their
 * meshes that make up the star render pipeline:
 *
 *   - core depth-mask (renderOrder -4, depth-only, gated each frame)
 *   - disc pass (renderOrder 0, opaque, per-channel max blending)
 *   - glow pass (renderOrder 1, additive)
 *
 * One geometry feeds all three; uRenderMode is the only divergent
 * uniform, so the three materials share the rest of the uniforms map by
 * reference. dispose() walks all owned resources in the right order.
 *
 * Per-frame uniform writes land on the shared map itself
 * (src/client/frame/shared-uniforms.ts), which the materials hold by
 * reference — the encapsulation here is resource ownership + dispose.
 */
export class StarPipeline {
  readonly geometry: THREE.InstancedBufferGeometry;
  /** Dynamic — overwritten on every Stellata.recenterOrigin. Callers
   *  set `needsUpdate = true` after rewriting the backing buffer. */
  readonly iPositionAttr: THREE.InstancedBufferAttribute;
  /** Dynamic — rewritten by BinaryOrbitField each frame. */
  readonly iCompositeSuppressAttr: THREE.InstancedBufferAttribute;
  /** Dynamic — rewritten by EclipsePhotometryField each frame. */
  readonly iEclipseDimAttr: THREE.InstancedBufferAttribute;
  /** Built once per attachBinaries; the integration shell flips
   *  `needsUpdate` after rewriting the backing buffer. */
  readonly iSuppressPulsationAttr: THREE.InstancedBufferAttribute;
  /** Static. Exposed so the WebGPU port's geometry can join it by object
   *  identity rather than interleaving a second copy of the same pair. */
  readonly iPulsAttr: THREE.InstancedBufferAttribute;
  readonly discMaterial: THREE.ShaderMaterial;
  readonly glowMaterial: THREE.ShaderMaterial;
  readonly coreMaskMaterial: THREE.ShaderMaterial;
  readonly discMesh: THREE.Mesh;
  readonly glowMesh: THREE.Mesh;
  readonly coreMaskMesh: THREE.Mesh;

  private scene: THREE.Scene;

  constructor(opts: StarPipelineOptions) {
    const {
      scene, catalog, logRadii, lumClassF32, distSol, teffApsis,
      localPositions, compositeSuppress, eclipseDim, suppressPulsation,
      vertexShader, fragmentShader,
      sharedUniforms, boundingSphereRadiusPc,
    } = opts;
    this.scene = scene;

    // Instanced quads: one unit square per star, expanded in screen space in
    // the vertex shader. This replaces the earlier THREE.Points approach,
    // which was capped by the driver-defined gl_PointSize maximum (often
    // 64-511 px) — too small for the angular-diameter rendering to reach the
    // viewport-filling sizes we want for supergiants at close range.
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('aCorner', new THREE.BufferAttribute(STAR_QUAD_CORNERS, 2));
    this.geometry.setIndex(STAR_QUAD_INDEX);
    this.iPositionAttr = new THREE.InstancedBufferAttribute(localPositions, 3);
    this.iPositionAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iPosition', this.iPositionAttr);
    this.iCompositeSuppressAttr = new THREE.InstancedBufferAttribute(compositeSuppress, 1);
    this.iCompositeSuppressAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iCompositeSuppress', this.iCompositeSuppressAttr);
    this.iEclipseDimAttr = new THREE.InstancedBufferAttribute(eclipseDim, 1);
    this.iEclipseDimAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iEclipseDim', this.iEclipseDimAttr);
    this.iSuppressPulsationAttr = new THREE.InstancedBufferAttribute(suppressPulsation, 1);
    this.iSuppressPulsationAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iSuppressPulsation', this.iSuppressPulsationAttr);
    this.geometry.setAttribute('iAbsmag', new THREE.InstancedBufferAttribute(catalog.absmag, 1));
    this.geometry.setAttribute('iCi', new THREE.InstancedBufferAttribute(catalog.ci, 1));
    this.geometry.setAttribute('iSpectClass', new THREE.InstancedBufferAttribute(catalog.spectClass, 1));
    this.geometry.setAttribute('iLogRadius', new THREE.InstancedBufferAttribute(logRadii, 1));
    this.geometry.setAttribute('iPeriodDays', new THREE.InstancedBufferAttribute(catalog.periodDays, 1));
    this.geometry.setAttribute('iAmplitudeMag', new THREE.InstancedBufferAttribute(catalog.amplitudeMag, 1));
    this.iPulsAttr = new THREE.InstancedBufferAttribute(
      interleavePulsParams(catalog.pulsRho, catalog.pulsColorSwing), 2);
    this.geometry.setAttribute('iPuls', this.iPulsAttr);
    this.geometry.setAttribute('iLumClass', new THREE.InstancedBufferAttribute(lumClassF32, 1));
    this.geometry.setAttribute('iDistSol', new THREE.InstancedBufferAttribute(distSol, 1));
    this.geometry.setAttribute('iTeffApsis', new THREE.InstancedBufferAttribute(teffApsis, 1));
    this.geometry.instanceCount = catalog.count;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boundingSphereRadiusPc);

    // RawShaderMaterial (not ShaderMaterial) so three.js doesn't auto-inject
    // `attribute vec3 position; attribute vec3 normal; attribute vec2 uv;`
    // into the vertex prefix. Those three would burn three of the GPU's 16
    // guaranteed vertex-attribute locations even though our shader doesn't
    // reference them. The vert/frag pair declares `modelViewMatrix` and
    // `projectionMatrix` explicitly; three.js still uploads them per draw
    // regardless of material type, so the only cost is the two uniform lines
    // in the shader.

    // Disc pass: per-channel max so overlapping discs/halos don't sum.
    // Shader writes premultiplied (C·α, α); MaxEquation gives
    // dst = max(src, dst) per channel. Depth write stays on so the
    // glow pass can depth-test against the disc silhouettes.
    this.discMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...sharedUniforms, uRenderMode: { value: STAR_PASS_DISC } },
      vertexShader,
      fragmentShader,
      transparent: true,
    });
    applyDiscBlendDefaults(this.discMaterial);

    // Glow pass: additive so overlapping distant stars accumulate brightness
    // (catalog density preserved). No depth write so multiple glows at the
    // same pixel all contribute. Depth *test* is on so glows behind a disc
    // drawn in the disc pass are correctly occluded.
    this.glowMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...sharedUniforms, uRenderMode: { value: STAR_PASS_GLOW } },
      vertexShader,
      fragmentShader,
    });
    applyGlowBlendDefaults(this.glowMaterial);

    // Core depth-mask: writes near depth at disc-pass star cores before any
    // background layer renders, so the Milky Way / molecular clouds /
    // galactic grid depth-fail behind close stars instead of bleeding
    // through. colorWrite off → cheaper than a colour pass and never paints
    // anything visible. Visibility gated each frame on focus / warp state by
    // the integration shell.
    this.coreMaskMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...sharedUniforms, uRenderMode: { value: STAR_PASS_CORE_MASK } },
      vertexShader,
      fragmentShader,
      depthWrite: true,
      depthTest: true,
      colorWrite: false,
    });

    // renderOrder: core mask (-4) → background layers → discs (0) → glows (1).
    this.coreMaskMesh = new THREE.Mesh(this.geometry, this.coreMaskMaterial);
    this.coreMaskMesh.frustumCulled = false;
    this.coreMaskMesh.renderOrder = -4;
    this.coreMaskMesh.visible = false;
    scene.add(this.coreMaskMesh);

    this.discMesh = new THREE.Mesh(this.geometry, this.discMaterial);
    this.discMesh.frustumCulled = false;
    this.discMesh.renderOrder = 0;
    markStatisticEmitter(this.discMesh);
    scene.add(this.discMesh);

    this.glowMesh = new THREE.Mesh(this.geometry, this.glowMaterial);
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 1;
    markStatisticEmitter(this.glowMesh);
    scene.add(this.glowMesh);
  }

  /** Swap disc + glow blend state for chart mode, over the shared pair
   *  helper the TSL layer also takes. uMonochrome is a shared uniform
   *  written by the caller — only the per-material blend state lives
   *  here. */
  setMonochromeBlend(on: boolean) {
    applyChartBlendSwap(
      this.discMaterial, this.glowMaterial, on, applyDiscBlendDefaults);
  }

  dispose() {
    this.scene.remove(this.coreMaskMesh);
    this.scene.remove(this.discMesh);
    this.scene.remove(this.glowMesh);
    // One shared InstancedBufferGeometry feeds the disc, glow, and
    // core-mask passes, so it's disposed once. Each pass has its own
    // ShaderMaterial.
    this.geometry.dispose();
    this.discMaterial.dispose();
    this.glowMaterial.dispose();
    this.coreMaskMaterial.dispose();
  }
}
