import * as THREE from 'three';
import type { Cloud, CloudCatalog } from './cloud-loader';
import type { CloudSurface } from './cloud-surfaces-loader';
import absorptionVert from './cloud-absorption.vert.glsl?raw';
import absorptionFrag from './cloud-absorption.frag.glsl?raw';
import rimFrag from './cloud-rim.frag.glsl?raw';
import rimVert from '../fresnel-shell/fresnel-shell.vert.glsl?raw';
import { viewingDistanceForExtent } from '../camera/focus/focus-transition';
import { angularDiameterPx } from '../camera/controls/star-geometry';
import { projectToScreenInto } from '../overlays/overlay-project';
import {
  cloudPickCandidate,
  resolveCloudPick,
  type CloudPickCandidate,
} from './cloud-pick-pure';
import type { HoverHit } from '../hover/hover-types';
// Registers the stellata_fresnel_rim chunk the rim shader includes —
// removing this import breaks the shader compile at first render.
import {
  DEFAULT_FACE_ON_FLOOR,
  DEFAULT_FRESNEL_POWER,
  SHELL_RIM_BLUE,
  SHELL_RIM_ALPHA_LIMB,
} from '../fresnel-shell/fresnel-shell';
import { setRawChromeColour } from '../hdr/chrome/chrome-colour';
import { markAbsorber } from '../hdr/attachments/attachment-gate';

// Shared sphere geometries. The absorption mesh is slightly circumscribed
// (1.03) to cover tessellation sag — its raymarch clips to the analytic
// unit sphere, so the overhang discards. The rim-fallback sphere IS the
// rendered surface, so it sits at exactly 1 with finer tessellation.
const SEGMENTS_LON = 32;
const SEGMENTS_LAT = 16;
const ABSORPTION_MESH_RADIUS = 1.03;
const RIM_SEGMENTS_LON = 48;
const RIM_SEGMENTS_LAT = 24;

const RIM_GAIN_DEFAULT = 1.0;
const STEPS_DEFAULT = 14;

// Chart/mono mode: solid black ink so the stippled outline reads as a
// definite chart annotation against the paper background.
const INK_COLOR_DEFAULT = 0x000000;
const INK_ALPHA_DEFAULT = 0.95;

// Per-cloud silhouette samples for the shared distance-gated label
// engine — the Local Bubble pattern (~96 samples for one shell) scaled
// down per cloud so 96 labels keep a flat per-frame projection budget.
const LABEL_SAMPLE_TARGET = 32;
const GOLDEN_ANGLE = 2.399963229728653;

// Field-mode march clip: the brick carries real density out to the
// build's envelope taper edge (u = 1.05, scripts/cloud-surfaces/), so
// the ray clips there rather than at the analytic mass-budget uEnv.
const BRICK_ENVELOPE = 1.05;

const ABSORPTION_RENDER_ORDER = -2;
// Rim shells draw with the reference wireframes at −1 — annotation
// chrome, deliberately NOT extincted by the absorption pass.
const RIM_RENDER_ORDER = -1;

/** Star-pipeline uniforms the absorption shader shares by reference. */
export interface CloudSharedUniforms {
  uFovYRad: { value: number };
  uViewport: { value: THREE.Vector2 };
}

function localSharedUniforms(): CloudSharedUniforms {
  return {
    uFovYRad: { value: Math.PI / 3.6 },
    uViewport: { value: new THREE.Vector2(1920, 1080) },
  };
}

/**
 * Molecular-cloud layer — two decoupled components per cloud:
 *
 * - Absorption: per-cloud ellipsoid raymarch of the calibrated Plummer
 *   model (cloud-absorption.frag.glsl), an alpha-only over that dims the
 *   diffuse background. Physics, so it is ALWAYS on in realistic mode —
 *   never declutter-gated — and hidden only in chart mode.
 * - Rim shell: the fresnel-rim orientation silhouette on the per-cloud
 *   isosurface mesh (cloud-surfaces.bin; ellipsoid fallback when a cloud
 *   has no traced surface), gated at the `representational` declutter
 *   floor (`molecularCloudEllipsoids`). In chart mode it renders as a
 *   stippled outline instead.
 *
 * Lives in absolute ICRS space; the group's position is rebased by
 * -worldOffset each frame so the geometry stays anchored when the
 * floating origin shifts on focus changes.
 */
export class MolecularClouds {
  readonly group: THREE.Group;
  readonly clouds: Cloud[];
  private absorptionGroup: THREE.Group;
  private rimGroup: THREE.Group;
  private absorptionMaterials: THREE.ShaderMaterial[] = [];
  private rimMaterial: THREE.ShaderMaterial;
  private absorptionGeometry: THREE.SphereGeometry;
  private rimFallbackGeometry: THREE.SphereGeometry;
  /** Owned per-cloud isosurface geometries (disposed with the layer). */
  private rimSurfaceGeometries: THREE.BufferGeometry[] = [];
  /** Owned per-cloud density-brick textures (disposed with the layer). */
  private brickTextures: THREE.Data3DTexture[] = [];
  /** Per-cloud absolute-ICRS surface samples for the silhouette labels. */
  private labelSampleAbs: Float32Array[] = [];
  /** Effective focus geometry: the traced mesh's vertex centroid + max
   *  vertex radius, else the Zucker ellipsoid centroid + envelope extent.
   *  A traced core can sit far off-centre in its bbox (Orion λ), so
   *  fly-to / orbit / warp / labels aim here, never at `centerAbs`. */
  private focusCenters: THREE.Vector3[] = [];
  private focusExtents: number[] = [];
  private traced: boolean[] = [];
  private mono = false;
  private absorptionEnabled = true;
  /** Rim-shell meshes in catalog order — the pick / hover target. This is
   *  the *depicted* shape (traced isosurface, or the u = uEnv ellipsoid for
   *  fallback clouds), the same geometry that renders the fresnel rim and
   *  the chart stipple outline, so the hitbox matches the silhouette in both
   *  modes, chart mode included. Cloud index
   *  rides `mesh.userData.cloudIdx`. The absorption meshes deliberately do
   *  NOT pick — their ellipsoid is only the raymarch domain, far larger than
   *  the shell for complex clouds (Aquila Rift). */
  private pickMeshes: THREE.Mesh[] = [];

  // Pick-path scratch — valid only inside one `pick()` call.
  private readonly pickRaycaster = new THREE.Raycaster();
  private readonly pickNdc = new THREE.Vector2();
  private readonly pickCentreLocal = new THREE.Vector3();
  private readonly pickViewDir = new THREE.Vector3();
  private readonly pickScreen: [number, number] = [0, 0];

  // User-tunable from the dev console via `stellata.kinds.cloud.layer.set*()`.
  private rimGain = RIM_GAIN_DEFAULT;

  constructor(
    catalog: CloudCatalog,
    surfaces: Map<number, CloudSurface> | null = null,
    shared: CloudSharedUniforms = localSharedUniforms(),
  ) {
    this.clouds = catalog.clouds;
    this.group = new THREE.Group();
    // Groups keep renderOrder 0: a non-zero Group.renderOrder becomes the
    // three.js groupOrder, which outranks per-mesh renderOrder in the
    // transparent sort — the whole cloud pass would draw BEFORE the MW
    // band (its group is 0, meshes −3) and the band would paint over the
    // absorption, silently defeating the § 9.1 render-order contract.
    this.absorptionGroup = new THREE.Group();
    this.rimGroup = new THREE.Group();
    // Fails closed: `pick` reads this, and no declutter permit is known
    // until the first `update`.
    this.rimGroup.visible = false;
    this.group.add(this.absorptionGroup, this.rimGroup);

    this.absorptionGeometry = new THREE.SphereGeometry(
      ABSORPTION_MESH_RADIUS, SEGMENTS_LON, SEGMENTS_LAT);
    this.rimFallbackGeometry = new THREE.SphereGeometry(1, RIM_SEGMENTS_LON, RIM_SEGMENTS_LAT);
    this.rimMaterial = this.makeRimMaterial();

    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];

      const surfaceForCloud = surfaces?.get(c.sid);
      const mat = this.makeAbsorptionMaterial(c, shared, surfaceForCloud);
      this.absorptionMaterials.push(mat);
      const mesh = new THREE.Mesh(this.absorptionGeometry, mat);
      mesh.position.copy(c.centerAbs);
      mesh.quaternion.copy(c.quat);
      mesh.scale.set(c.axes[0], c.axes[1], c.axes[2]);
      mesh.frustumCulled = false; // group origin is offset per frame
      mesh.renderOrder = ABSORPTION_RENDER_ORDER;
      markAbsorber(mesh);
      this.absorptionGroup.add(mesh);

      const surface = surfaceForCloud;
      const rimMesh = this.makeRimMesh(c, surface);
      rimMesh.userData.cloudIdx = i;
      this.rimGroup.add(rimMesh);
      this.pickMeshes.push(rimMesh);
      this.labelSampleAbs.push(buildLabelSamples(c, surface));

      if (surface) {
        const n = surface.positions.length / 3;
        let cx = 0; let cy = 0; let cz = 0;
        for (let k = 0; k < n; k++) {
          cx += surface.positions[k * 3];
          cy += surface.positions[k * 3 + 1];
          cz += surface.positions[k * 3 + 2];
        }
        const center = new THREE.Vector3(cx / n, cy / n, cz / n);
        let extentSq = 0;
        for (let k = 0; k < n; k++) {
          const dx = surface.positions[k * 3] - center.x;
          const dy = surface.positions[k * 3 + 1] - center.y;
          const dz = surface.positions[k * 3 + 2] - center.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > extentSq) extentSq = d2;
        }
        this.focusCenters.push(center);
        this.focusExtents.push(Math.sqrt(extentSq));
        this.traced.push(true);
      } else {
        this.focusCenters.push(c.centerAbs.clone());
        this.focusExtents.push(
          Math.max(c.axes[0], c.axes[1], c.axes[2]) * c.uEnv);
        this.traced.push(false);
      }
    }
  }

  /** Effective focus centre (absolute ICRS pc) written into `out`;
   *  false when the index is out of range. */
  focusCenterAbsInto(cloudIdx: number, out: THREE.Vector3): boolean {
    const c = this.focusCenters[cloudIdx];
    if (!c) return false;
    out.copy(c);
    return true;
  }

  /** Representative radius of the rendered shape (pc). */
  focusExtentPc(cloudIdx: number): number {
    return this.focusExtents[cloudIdx] ?? 0;
  }

  /** Comfortable fly-to park distance for the rendered shape — the
   *  Local-Group-style `viewingDistanceForExtent` over the effective
   *  extent (2.4× with a 5 pc floor). */
  viewingDistancePc(cloudIdx: number): number {
    return viewingDistanceForExtent(this.focusExtentPc(cloudIdx));
  }

  /** Silhouette pixel diameter at camera distance `dCamPc`: the extent
   *  sphere for traced meshes, the tight ellipsoid quadric otherwise. */
  renderedSizePx(
    cloudIdx: number,
    dCamPc: number,
    angularToPx: number,
    viewDir?: THREE.Vector3,
  ): number {
    const cloud = this.clouds[cloudIdx];
    if (!cloud) return 0;
    if (this.traced[cloudIdx]) {
      return angularDiameterPx(
        this.focusExtents[cloudIdx], Math.max(dCamPc, 1e-30), angularToPx);
    }
    return renderedCloudSizePx(cloud, dCamPc, angularToPx, viewDir);
  }

  /** Number of silhouette samples for cloud `cloudIdx` (0 if out of range). */
  labelSampleCount(cloudIdx: number): number {
    return (this.labelSampleAbs[cloudIdx]?.length ?? 0) / 3;
  }

  /** Surface sample `i` of cloud `cloudIdx` in renderer-local coords
   *  (absolute − worldOffset), written into `out` — the same contract as
   *  `LocalBubbleShell.labelSampleInto`. */
  labelSampleInto(
    cloudIdx: number,
    i: number,
    worldOffset: Readonly<THREE.Vector3>,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const s = this.labelSampleAbs[cloudIdx];
    return out.set(s[i * 3], s[i * 3 + 1], s[i * 3 + 2]).sub(worldOffset);
  }

  /** Per-frame: rebase to the floating origin and gate the rim shells on
   *  the declutter permit. Absorption is physics — it stays on in
   *  realistic mode regardless of `rimPermitted`. */
  update(worldOffset: THREE.Vector3, rimPermitted: boolean) {
    this.group.position.copy(worldOffset).negate();
    this.absorptionGroup.visible = !this.mono && this.absorptionEnabled;
    this.rimGroup.visible = rimPermitted;
  }

  /** The cloud provider's localPositionInto leg: writes the cloud's
   *  local-frame effective focus centre into `out` when the cloud
   *  exists, returns `true`. Returns `false` (and leaves `out`
   *  untouched) when the index is out of range. */
  cloudLocalPositionInto(
    cloudIdx: number,
    worldOffset: Readonly<THREE.Vector3>,
    out: THREE.Vector3,
  ): boolean {
    const c = this.focusCenters[cloudIdx];
    if (!c) return false;
    out.copy(c).sub(worldOffset);
    return true;
  }

  /** Chart mode: absorption hides entirely; the rim material swaps to the
   *  stippled-outline ink pass (normal blending over the paper). */
  setMonochrome(on: boolean) {
    if (this.mono === on) return;
    this.mono = on;
    this.absorptionGroup.visible = !on;
    this.rimMaterial.uniforms.uChart.value = on ? 1 : 0;
    this.rimMaterial.blending = on ? THREE.NormalBlending : THREE.AdditiveBlending;
  }

  /**
   * Console-accessible debug levers. Live-update the materials so
   * tweaking happens without restart. Examples:
   *   stellata.kinds.cloud.layer.setOpacity(5)        // boost the rim glow
   *   stellata.kinds.cloud.layer.setColor(0xff8844)   // override the rim blue
   *   stellata.kinds.cloud.layer.setRimParams({ fresnelPower: 4 })
   */
  setOpacity(x: number) {
    this.rimGain = Math.max(0, x);
    this.rimMaterial.uniforms.uOpacity.value = this.rimGain;
  }
  setColor(hex: number) {
    setRawChromeColour(this.rimMaterial.uniforms.uColour.value as THREE.Color, hex);
  }
  setMonoOpacity(x: number) {
    this.rimMaterial.uniforms.uInkAlpha.value = Math.max(0, x);
  }
  setMonoColor(hex: number) {
    (this.rimMaterial.uniforms.uInk.value as THREE.Color).setHex(hex);
  }
  /** Debug kill switch for the absorption pass (frame-cost
   *  differentials) — never a user-facing declutter gate: absorption is
   *  physics and stays on in realistic mode. */
  setAbsorptionEnabled(on: boolean) {
    this.absorptionEnabled = on;
  }
  /** Absorption raymarch step count (§ 9.1 lever — the sampling rules
   *  are not). */
  setSteps(n: number) {
    const steps = Math.max(4, Math.min(24, Math.round(n)));
    for (const mat of this.absorptionMaterials) mat.uniforms.uSteps.value = steps;
  }
  /** Rim-glow shape levers, shared vocabulary with the fresnel shells. */
  setRimParams(p: { alphaLimb?: number; faceOnFloor?: number; fresnelPower?: number }) {
    const u = this.rimMaterial.uniforms;
    if (p.alphaLimb !== undefined) u.uAlphaLimb.value = p.alphaLimb;
    if (p.faceOnFloor !== undefined) u.uFaceOnFloor.value = p.faceOnFloor;
    if (p.fresnelPower !== undefined) u.uFresnelPower.value = p.fresnelPower;
  }
  /** Force-boost the rim glow — handy for "is the layer rendering at
   *  all?" debugging. Pass null to restore the configured gain. */
  setDebugBoost(strength: number | null) {
    this.rimMaterial.uniforms.uOpacity.value = strength === null ? this.rimGain : strength;
  }

  /**
   * Resolve the cloud under the cursor — the single winner-resolving
   * entry point behind the cloud module's pick surface, which the click
   * FSM and the hover engine share, so the two can never disagree.
   * Rim-mesh raycast gates hit-vs-miss; `resolveCloudPick` picks the
   * cloud the cursor sits proportionally deepest inside (README
   * § Picking + hover). Tier is always `fallback` — stars, planets, LG
   * objects and shells win any overlap with a cloud body.
   *
   * Only cloud geometry is tested: foreground stars don't block a cloud
   * pick here, the caller picks those first and falls back to a cloud.
   *
   * Returns null whenever the rim shells are not permitted — the rim is
   * the only mark the layer paints for itself (README § Picking + hover).
   */
  pick(
    camera: THREE.PerspectiveCamera,
    worldOffset: Readonly<THREE.Vector3>,
    rect: DOMRect,
    clientX: number,
    clientY: number,
    angularToPx: number,
  ): HoverHit | null {
    if (!this.rimGroup.visible) return null;
    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;
    this.pickNdc.set(
      (cursorX / rect.width) * 2 - 1,
      -((cursorY / rect.height) * 2 - 1),
    );
    this.pickRaycaster.setFromCamera(this.pickNdc, camera);
    const hits = this.pickRaycaster.intersectObjects(this.pickMeshes, false);
    if (hits.length === 0) return null;

    const centre = this.pickCentreLocal;
    const candidates: CloudPickCandidate[] = [];
    const seen = new Set<number>();
    for (const hit of hits) {
      const idx = hit.object.userData.cloudIdx;
      // A traced isosurface can present several front faces along one
      // ray; every hit on the same cloud scores identically.
      if (typeof idx !== 'number' || seen.has(idx)) continue;
      seen.add(idx);
      if (!this.cloudLocalPositionInto(idx, worldOffset, centre)) continue;
      const cameraDistancePc = centre.distanceTo(camera.position);
      const viewDir = this.pickViewDir
        .subVectors(camera.position, centre)
        .multiplyScalar(1 / Math.max(cameraDistancePc, 1e-30));
      const silhouetteDiameterPx = this.renderedSizePx(
        idx, cameraDistancePc, angularToPx, viewDir);
      // An unprojectable centre (behind the near plane, the camera deep
      // inside a concave complex) scores as an edge hit: it loses to any
      // cloud the cursor is genuinely inside, still wins when alone.
      const pxDist = projectToScreenInto(centre, camera, rect.width, rect.height, this.pickScreen)
        ? Math.hypot(cursorX - this.pickScreen[0], cursorY - this.pickScreen[1])
        : silhouetteDiameterPx * 0.5;
      candidates.push(
        cloudPickCandidate(idx, pxDist, cameraDistancePc, silhouetteDiameterPx));
    }

    const winner = resolveCloudPick(candidates);
    if (winner === null) return null;
    return {
      idx: winner.candidate.idx,
      cameraDistancePc: winner.candidate.cameraDistancePc,
      tier: 'fallback',
    };
  }

  dispose() {
    this.absorptionGeometry.dispose();
    this.rimFallbackGeometry.dispose();
    for (const g of this.rimSurfaceGeometries) g.dispose();
    for (const t of this.brickTextures) t.dispose();
    for (const mat of this.absorptionMaterials) mat.dispose();
    this.rimMaterial.dispose();
  }

  private makeAbsorptionMaterial(
    cloud: Cloud,
    shared: CloudSharedUniforms,
    surface: CloudSurface | undefined,
  ): THREE.ShaderMaterial {
    const uniforms: Record<string, THREE.IUniform> = {
      uAxes: { value: new THREE.Vector3(cloud.axes[0], cloud.axes[1], cloud.axes[2]) },
      uN0Cal: { value: cloud.n0Cal },
      uRflat: { value: cloud.rflatPc },
      uP: { value: cloud.p },
      // Field mode marches the brick's full taper edge (density is real
      // data out to u = 1.05); the analytic path clips to the
      // mass-budget envelope where its model density ends.
      uUEnv: { value: surface ? BRICK_ENVELOPE : cloud.uEnv },
      uInvQuat: {
        value: new THREE.Matrix3().setFromMatrix4(
          new THREE.Matrix4().makeRotationFromQuaternion(cloud.quat.clone().conjugate()),
        ),
      },
      uSteps: { value: STEPS_DEFAULT },
      uFovYRad: shared.uFovYRad,
      uViewport: shared.uViewport,
    };
    if (surface) {
      const b = surface.brick;
      const tex = new THREE.Data3DTexture(b.data, b.dims[0], b.dims[1], b.dims[2]);
      tex.format = THREE.RedFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.wrapR = THREE.ClampToEdgeWrapping;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      this.brickTextures.push(tex);
      uniforms.uBrick = { value: tex };
      uniforms.uDensityMax = { value: b.densityMax };
      uniforms.uCenterFromAabb = {
        value: new THREE.Vector3(
          cloud.centerAbs.x - b.aabbMinAbs[0],
          cloud.centerAbs.y - b.aabbMinAbs[1],
          cloud.centerAbs.z - b.aabbMinAbs[2],
        ),
      };
      uniforms.uRotMat = {
        value: new THREE.Matrix3().setFromMatrix4(
          new THREE.Matrix4().makeRotationFromQuaternion(cloud.quat),
        ),
      };
      uniforms.uUvwScale = {
        value: new THREE.Vector3(
          1 / (b.stepPc * b.dims[0]),
          1 / (b.stepPc * b.dims[1]),
          1 / (b.stepPc * b.dims[2]),
        ),
      };
      uniforms.uUvwBias = {
        value: new THREE.Vector3(0.5 / b.dims[0], 0.5 / b.dims[1], 0.5 / b.dims[2]),
      };
    }
    return new THREE.ShaderMaterial({
      vertexShader: absorptionVert,
      fragmentShader: absorptionFrag,
      glslVersion: THREE.GLSL3,
      defines: surface ? { USE_FIELD: '' } : {},
      transparent: true,
      depthTest: true,
      depthWrite: false,
      // Alpha-only premultiplied-over: rgb = 0, so NormalBlending becomes
      // (ONE, ONE−α) = background × (1 − absorption).
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      // BackSide: exactly one fragment per covered pixel from outside AND
      // inside (the raymarch segment is analytic either way); FrontSide
      // would kill the inside-the-cloud absorption.
      side: THREE.BackSide,
      uniforms,
    });
  }

  private makeRimMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: rimVert,
      fragmentShader: rimFrag,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // FrontSide + outward winding = the fresnel-shell hide-when-inside
      // contract: the shell back-face-culls when the camera is inside the
      // cloud (absorption keeps working from inside — it is BackSide).
      side: THREE.FrontSide,
      uniforms: {
        uColour: { value: setRawChromeColour(new THREE.Color(), SHELL_RIM_BLUE) },
        uAlphaLimb: { value: SHELL_RIM_ALPHA_LIMB },
        uFaceOnFloor: { value: DEFAULT_FACE_ON_FLOOR },
        uFresnelPower: { value: DEFAULT_FRESNEL_POWER },
        uOpacity: { value: this.rimGain },
        uChart: { value: 0 },
        uInk: { value: new THREE.Color(INK_COLOR_DEFAULT) },
        uInkAlpha: { value: INK_ALPHA_DEFAULT },
      },
    });
  }

  private makeRimMesh(cloud: Cloud, surface: CloudSurface | undefined): THREE.Mesh {
    let mesh: THREE.Mesh;
    if (surface) {
      // Traced isosurface — vertex positions are absolute ICRS pc with
      // outward winding baked by the build; normals compute at runtime.
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
      geometry.computeVertexNormals();
      this.rimSurfaceGeometries.push(geometry);
      mesh = new THREE.Mesh(geometry, this.rimMaterial);
    } else {
      // Ellipsoid fallback (out-of-grid clouds, or no cloud-surfaces.bin):
      // the density envelope u = uEnv, where the absorption ends.
      mesh = new THREE.Mesh(this.rimFallbackGeometry, this.rimMaterial);
      mesh.position.copy(cloud.centerAbs);
      mesh.quaternion.copy(cloud.quat);
      mesh.scale.set(
        cloud.axes[0] * cloud.uEnv,
        cloud.axes[1] * cloud.uEnv,
        cloud.axes[2] * cloud.uEnv,
      );
    }
    mesh.frustumCulled = false;
    mesh.renderOrder = RIM_RENDER_ORDER;
    return mesh;
  }
}

const scratchSampleVec = /*@__PURE__*/ new THREE.Vector3();

/** Absolute-ICRS silhouette samples for one cloud: a stride subsample of
 *  the traced mesh's vertices, or a fibonacci-sphere sweep of the
 *  ellipsoid envelope for fallback clouds. */
function buildLabelSamples(cloud: Cloud, surface: CloudSurface | undefined): Float32Array {
  if (surface) {
    const vertexCount = surface.positions.length / 3;
    const stride = Math.max(1, Math.floor(vertexCount / LABEL_SAMPLE_TARGET));
    const samples: number[] = [];
    for (let k = 0; k < vertexCount; k += stride) {
      samples.push(
        surface.positions[k * 3],
        surface.positions[k * 3 + 1],
        surface.positions[k * 3 + 2],
      );
    }
    return new Float32Array(samples);
  }
  const out = new Float32Array(LABEL_SAMPLE_TARGET * 3);
  for (let k = 0; k < LABEL_SAMPLE_TARGET; k++) {
    const z = 1 - (2 * (k + 0.5)) / LABEL_SAMPLE_TARGET;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = k * GOLDEN_ANGLE;
    scratchSampleVec.set(
      r * Math.cos(phi) * cloud.axes[0] * cloud.uEnv,
      r * Math.sin(phi) * cloud.axes[1] * cloud.uEnv,
      z * cloud.axes[2] * cloud.uEnv,
    ).applyQuaternion(cloud.quat).add(cloud.centerAbs);
    out[k * 3] = scratchSampleVec.x;
    out[k * 3 + 1] = scratchSampleVec.y;
    out[k * 3 + 2] = scratchSampleVec.z;
  }
  return out;
}

// Scratch vectors / quaternion used by the silhouette projection — kept
// at module scope so the per-frame distance-vector overlay calls allocate
// nothing.
const scratchDirLocal = /*@__PURE__*/ new THREE.Vector3();
const scratchU = /*@__PURE__*/ new THREE.Vector3();
const scratchV = /*@__PURE__*/ new THREE.Vector3();
const scratchQuatInv = /*@__PURE__*/ new THREE.Quaternion();

/**
 * Pixel diameter the cloud's silhouette spans on screen at the current
 * camera distance — the per-cloud analogue of `Stellata.renderedSizePx`.
 * Semi-axes are the depicted `u = uEnv` envelope (where the rim shell
 * sits and the absorption march clips), not the bare Zucker axes.
 *
 * When `viewDir` is supplied (a world-space unit vector from the cloud
 * centroid toward the camera), the silhouette diameter is the silhouette
 * ellipse's major axis under the proper quadric projection — tight for
 * any orientation. For an axis-aligned view of a prolate cloud (axes
 * [10, 1, 1] viewed along the long axis) this returns the short axis
 * diameter (= 2), not the long-axis diameter (= 20).
 *
 * When `viewDir` is omitted, falls back to the longest semi-axis — the
 * legacy conservative answer. This is what the distance-vector
 * chevron-tip clearance still wants when the caller isn't yet plumbed
 * for a view direction.
 */
export function renderedCloudSizePx(
  cloud: Cloud,
  dCamPc: number,
  angularToPx: number,
  viewDir?: THREE.Vector3,
): number {
  let R: number;
  if (viewDir) {
    // Rotate the world-space view direction into the cloud's local frame
    // so the silhouette ellipse computed below uses the same axis-aligned
    // basis as the cloud's `axes` array.
    scratchQuatInv.copy(cloud.quat).conjugate();
    scratchDirLocal.copy(viewDir).applyQuaternion(scratchQuatInv).normalize();

    const a2 = cloud.axes[0] * cloud.axes[0];
    const b2 = cloud.axes[1] * cloud.axes[1];
    const c2 = cloud.axes[2] * cloud.axes[2];

    // Build an orthonormal basis (u, v) perpendicular to dirLocal so the
    // ellipsoid quadric M = diag(a², b², c²) can be projected to that
    // 2D plane. Pick the world axis least aligned with dirLocal as the
    // seed for cross-product, avoiding numerical degeneracies.
    const ax = Math.abs(scratchDirLocal.x);
    const ay = Math.abs(scratchDirLocal.y);
    const az = Math.abs(scratchDirLocal.z);
    if (ax <= ay && ax <= az) scratchU.set(1, 0, 0);
    else if (ay <= az) scratchU.set(0, 1, 0);
    else scratchU.set(0, 0, 1);
    scratchU.crossVectors(scratchDirLocal, scratchU).normalize();
    scratchV.crossVectors(scratchDirLocal, scratchU);

    // Projected 2x2 matrix entries (u^T M u, u^T M v, v^T M v).
    const ux = scratchU.x; const uy = scratchU.y; const uz = scratchU.z;
    const vx = scratchV.x; const vy = scratchV.y; const vz = scratchV.z;
    const muu = a2 * ux * ux + b2 * uy * uy + c2 * uz * uz;
    const mvv = a2 * vx * vx + b2 * vy * vy + c2 * vz * vz;
    const muv = a2 * ux * vx + b2 * uy * vy + c2 * uz * vz;

    // Larger eigenvalue of the 2x2 [[muu, muv], [muv, mvv]] = silhouette
    // major-axis squared.
    const trace = muu + mvv;
    const disc = Math.sqrt(Math.max(0, (muu - mvv) * (muu - mvv) + 4 * muv * muv));
    const lambdaMax = 0.5 * (trace + disc);
    R = Math.sqrt(Math.max(0, lambdaMax));
  } else {
    R = Math.max(cloud.axes[0], cloud.axes[1], cloud.axes[2]);
  }
  return angularDiameterPx(R * cloud.uEnv, Math.max(dCamPc, 1e-30), angularToPx);
}
