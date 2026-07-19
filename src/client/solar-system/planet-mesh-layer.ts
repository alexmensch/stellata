// Close-range spheroid mesh LOD for planet bodies. See README.md
// § Planet mesh LOD for the crossfade + lazy-texture contract.

import * as THREE from 'three';
import type { MemberSphere } from '../local-depth/slice-pure';
import { KM_PC } from '../util/astronomy-constants';
import { MAX_SHADOW_CASTERS } from './body-shadow-pure';
import { litIntensity } from './perceptual-magnitude';
import { phaseAngleFor, phaseRatioToLambert } from './phase-function';
import type { PlanetBodyField } from './planet-body-field';
import { systemFamily, type Planet, type PlanetRings } from './planet-system';
import { meshFadeFromRatio, TEXTURE_PREFETCH_RATIO } from './mesh-crossfade';
import {
  poleRaDecDegAt,
  type RotationElements,
  spinDegAt,
} from './rotation-elements-pure';
import meshVert from './planet-mesh.vert.glsl?raw';
import meshFrag from './planet-mesh.frag.glsl?raw';
import ringsVert from './planet-rings.vert.glsl?raw';
import ringsFrag from './planet-rings.frag.glsl?raw';

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Geometry pole tilt: SphereGeometry's +Y pole (texture v = 1, the
 *  image top) onto the body-frame +z the IAU chain treats as north. */
export const POLE_TILT = new THREE.Quaternion().setFromAxisAngle(
  X_AXIS,
  Math.PI / 2,
);

const _iauTmpA = new THREE.Quaternion();
const _iauTmpB = new THREE.Quaternion();

/** IAU pole frame `Rz(90°+α0)·Rx(90°−δ0)` at model time `t` → `out`. */
export function iauPoleQuat(
  rot: RotationElements,
  t: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const { raDeg, decDeg } = poleRaDecDegAt(rot, t);
  return out
    .setFromAxisAngle(Z_AXIS, THREE.MathUtils.degToRad(90 + raDeg))
    .multiply(_iauTmpA.setFromAxisAngle(X_AXIS, THREE.MathUtils.degToRad(90 - decDeg)));
}

/** Full mesh orientation: the IAU body→ICRS composition
 *  `Rz(90°+α0)·Rx(90°−δ0)·Rz(W)`, then POLE_TILT. The map-centre
 *  offset rides the spin term so texture features land on their true
 *  longitudes. Exported so tests pin the exact rendered composition
 *  against external ephemeris truth. */
export function iauMeshOrientationQuat(
  rot: RotationElements,
  t: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const spinDeg = spinDegAt(rot, t) + (rot.mapCenterLonDeg ?? 0);
  return iauPoleQuat(rot, t, out)
    .multiply(_iauTmpB.setFromAxisAngle(Z_AXIS, THREE.MathUtils.degToRad(spinDeg)))
    .multiply(POLE_TILT);
}

interface RingEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.RingGeometry;
}

interface MeshEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Body radius, or the ring outer radius for ringed bodies — the
   *  local-depth-pass bounding sphere. */
  boundRadiusPc: number;
  ring?: RingEntry;
}

type TextureState =
  | { state: 'loading' }
  | { state: 'ready'; tex: THREE.Texture }
  | { state: 'missing' };

export class PlanetMeshLayer {
  readonly group: THREE.Group;

  private readonly field: PlanetBodyField;
  private readonly textureBaseUrl: string;
  private readonly geometry: THREE.SphereGeometry;
  private readonly placeholder: THREE.DataTexture;
  private readonly loader = new THREE.TextureLoader();
  private readonly entries = new Map<number, MeshEntry>();
  private readonly textures = new Map<string, TextureState>();

  private readonly tmpPlanet = new THREE.Vector3();
  private readonly tmpHost = new THREE.Vector3();
  private readonly tmpSun = new THREE.Vector3();
  private readonly tmpCaster = new THREE.Vector3();
  private readonly viewInverse = new THREE.Matrix4();
  private readonly tmpQuatRing = new THREE.Quaternion();
  private readonly tmpQuatInv = new THREE.Quaternion();

  constructor(field: PlanetBodyField, textureBaseUrl: string) {
    this.field = field;
    this.textureBaseUrl = textureBaseUrl;
    this.group = new THREE.Group();
    this.group.name = 'planet-meshes';
    this.geometry = new THREE.SphereGeometry(1, 96, 48);
    this.placeholder = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1,
    );
    this.placeholder.needsUpdate = true;
  }

  /** Append camera-relative bounding spheres for every mesh-visible
   *  body (ring annulus included via the stored bound). The
   *  local-depth-pass bracket input; empty while the layer is hidden. */
  collectSpheres(camera: THREE.PerspectiveCamera, out: MemberSphere[]): void {
    if (!this.group.visible) return;
    for (const entry of this.entries.values()) {
      if (!entry.mesh.visible) continue;
      out.push({
        distPc: entry.mesh.position.distanceTo(camera.position),
        radiusPc: entry.boundRadiusPc,
      });
    }
  }

  /** Per-frame: show/scale/light every body inside the crossfade band.
   *  Reads the body field's live buffers, so recentres and scrubber
   *  motion need no extra hooks. `t` is the model clock (getT()) —
   *  IAU spin runs on it like binary orbits. */
  update(camera: THREE.PerspectiveCamera, t: number): void {
    // Chart mode inks the bodies as flat discs (chart-mode/README.md);
    // a lit photographic sphere has no place on paper.
    this.group.visible = this.field.group.visible && !this.field.monochrome;
    if (!this.group.visible) return;

    // camera.matrixWorldInverse is refreshed inside render(), AFTER
    // this update — the stored value is one frame stale, so view-space
    // sun and caster uniforms built from it swim against the surface
    // under camera motion. Derive a fresh inverse here.
    camera.updateMatrixWorld();
    this.viewInverse.copy(camera.matrixWorld).invert();

    const shown = new Set<number>();
    const n = this.field.liveInstanceCount;
    for (let idx = 0; idx < n; idx++) {
      if (idx === this.field.hiddenInstanceIdx) continue;
      const planet = this.field.planetAt(idx);
      if (!planet) continue;
      if (!this.field.planetLocalPositionInto(idx, this.tmpPlanet)) continue;

      const radiusPc = planet.radiusKm * KM_PC;
      const ratio = this.field.meshFadeRatio(idx, camera.position);
      if (ratio >= TEXTURE_PREFETCH_RATIO) {
        this.ensureTexture(planet.name);
        if (planet.hasNightTexture) this.ensureTexture(`${planet.name}-night`);
        if (planet.rings) this.ensureTexture(`${planet.name}-rings`, 'png');
      }
      const fade = meshFadeFromRatio(ratio);
      if (fade <= 0) continue;

      const entry = this.entries.get(idx) ?? this.createEntry(idx, planet);
      shown.add(idx);
      const { mesh, material } = entry;
      mesh.visible = true;
      mesh.position.copy(this.tmpPlanet);
      const polar = radiusPc * (1 - (planet.flattening ?? 0));
      mesh.scale.set(radiusPc, polar, radiusPc);

      const hp = this.field.hostPlanetOf(idx);
      if (planet.rotation) {
        iauMeshOrientationQuat(planet.rotation, t, mesh.quaternion);
      } else {
        // Fallback for bodies without published elements: geometry
        // pole (+Y) → orbital-plane normal (host frame +Z) → ICRS via
        // the host orientation; prime meridian arbitrary but fixed.
        const orientation = hp === null
          ? null
          : this.field.hostOrientationOf(hp.hostStarIdx);
        if (orientation) {
          mesh.quaternion.copy(orientation).multiply(POLE_TILT);
        }
      }

      // Host-star direction: world-frame first (the ring lighting
      // frame), then into view space for the terminator.
      let hasSun = false;
      let dHpPc = 0;
      if (hp && this.field.getHostLocalPositionInto(hp.hostStarIdx, this.tmpHost)) {
        this.tmpSun.subVectors(this.tmpHost, this.tmpPlanet);
        dHpPc = this.tmpSun.length();
        if (dHpPc > 0) {
          this.tmpSun.divideScalar(dHpPc);
          hasSun = true;
        }
      }
      const lit = hasSun ? litIntensity(dHpPc, this.field.getMaxAppMag()) : 1;

      if (entry.ring) {
        this.updateRing(entry.ring, planet, hp, t, camera, hasSun, fade, lit);
      }

      material.uniforms.uLitIntensity.value = lit;
      material.uniforms.uPhaseScale.value = hasSun && planet.phaseCoefficients
        ? phaseRatioToLambert(
            planet.phaseCoefficients,
            phaseAngleFor(
              this.tmpPlanet.x - camera.position.x,
              this.tmpPlanet.y - camera.position.y,
              this.tmpPlanet.z - camera.position.z,
              this.tmpHost.x - camera.position.x,
              this.tmpHost.y - camera.position.y,
              this.tmpHost.z - camera.position.z,
            ),
          )
        : 1;
      material.uniforms.uCasterCount.value =
        hasSun && hp ? this.writeCasters(material, hp) : 0;

      if (hasSun) {
        this.tmpSun.transformDirection(this.viewInverse);
        (material.uniforms.uSunDirView.value as THREE.Vector3).copy(this.tmpSun);
        const hostRadiusPc = this.field.hostRadiusOf(hp!.hostStarIdx);
        material.uniforms.uSunAngRad.value =
          hostRadiusPc !== null ? hostRadiusPc / dHpPc : 0;
      }

      material.uniforms.uFade.value = fade;
      const texState = this.textures.get(planet.name.toLowerCase());
      if (texState?.state === 'ready') {
        material.uniforms.uMap.value = texState.tex;
        material.uniforms.uHasMap.value = 1;
      } else {
        material.uniforms.uMap.value = this.placeholder;
        material.uniforms.uHasMap.value = 0;
        (material.uniforms.uColour.value as THREE.Color).setRGB(
          planet.colour[0], planet.colour[1], planet.colour[2],
        );
      }
      const nightState = planet.hasNightTexture
        ? this.textures.get(`${planet.name.toLowerCase()}-night`)
        : undefined;
      if (nightState?.state === 'ready') {
        material.uniforms.uNightMap.value = nightState.tex;
        material.uniforms.uHasNight.value = 1;
      } else {
        material.uniforms.uNightMap.value = this.placeholder;
        material.uniforms.uHasNight.value = 0;
      }
    }

    for (const [idx, entry] of this.entries) {
      if (!shown.has(idx)) {
        entry.mesh.visible = false;
        if (entry.ring) entry.ring.mesh.visible = false;
      }
    }
  }

  /** Fill the material's uCasters array with view-space shadow spheres
   *  for one drawn body — its parent when it is a moon, its moons when
   *  it is a parent (moon-on-moon events are out of scope). Returns the
   *  caster count. */
  private writeCasters(
    material: THREE.ShaderMaterial,
    hp: { hostStarIdx: number; planetIdx: number },
  ): number {
    const ps = this.field.getAttachedPlanetSystem(hp.hostStarIdx);
    if (!ps) return 0;
    const family = systemFamily(ps.planets);
    const casters = material.uniforms.uCasters.value as THREE.Vector4[];
    const parentIdx = family.parentIdx[hp.planetIdx];
    let count = 0;
    if (parentIdx >= 0) {
      count += this.writeCaster(casters, count, hp.hostStarIdx, parentIdx);
    } else {
      const children = family.childIdxs[hp.planetIdx];
      for (let c = 0; c < children.length && count < MAX_SHADOW_CASTERS; c++) {
        count += this.writeCaster(casters, count, hp.hostStarIdx, children[c]);
      }
    }
    return count;
  }

  /** Write one caster's view-space sphere into `casters[slot]`; returns
   *  1 on success, 0 when the body isn't resolvable. */
  private writeCaster(
    casters: THREE.Vector4[],
    slot: number,
    hostStarIdx: number,
    planetIdx: number,
  ): number {
    const flat = this.field.instanceIndexOf(hostStarIdx, planetIdx);
    if (flat === null) return 0;
    const body = this.field.planetAt(flat);
    if (!body || !this.field.planetLocalPositionInto(flat, this.tmpCaster)) return 0;
    this.tmpCaster.applyMatrix4(this.viewInverse);
    casters[slot].set(
      this.tmpCaster.x,
      this.tmpCaster.y,
      this.tmpCaster.z,
      body.radiusKm * KM_PC,
    );
    return 1;
  }

  /** `out` ← Rz(90°+α0)·Rx(90°−δ0): local +z lands on the body's IAU
   *  pole in ICRS. */

  /** Pose + light the ring annulus: equatorial plane from the IAU
   *  pole (host orbital plane when elements are absent), sun and
   *  camera rotated into the ring-local frame for the fragment
   *  shader's lit-face / shadow tests. Hidden until the radial strip
   *  texture arrives — rings have no representative-colour fallback. */
  private updateRing(
    ring: RingEntry,
    planet: Planet,
    hp: { hostStarIdx: number; planetIdx: number } | null,
    t: number,
    camera: THREE.PerspectiveCamera,
    hasSun: boolean,
    fade: number,
    litIntensity: number,
  ): void {
    const texState = this.textures.get(`${planet.name.toLowerCase()}-rings`);
    if (texState?.state !== 'ready' || !hasSun) {
      ring.mesh.visible = false;
      return;
    }
    if (planet.rotation) {
      iauPoleQuat(planet.rotation, t, this.tmpQuatRing);
    } else {
      const orientation = hp === null
        ? null
        : this.field.hostOrientationOf(hp.hostStarIdx);
      if (!orientation) {
        ring.mesh.visible = false;
        return;
      }
      this.tmpQuatRing.copy(orientation);
    }
    ring.mesh.visible = true;
    ring.material.uniforms.uRingMap.value = texState.tex;
    ring.material.uniforms.uFade.value = fade;
    ring.material.uniforms.uLitIntensity.value = litIntensity;
    ring.mesh.position.copy(this.tmpPlanet);
    ring.mesh.quaternion.copy(this.tmpQuatRing);

    this.tmpQuatInv.copy(this.tmpQuatRing).invert();
    (ring.material.uniforms.uSunDirLocal.value as THREE.Vector3)
      .copy(this.tmpSun)
      .applyQuaternion(this.tmpQuatInv);
    (ring.material.uniforms.uCamPosLocal.value as THREE.Vector3)
      .copy(camera.position)
      .sub(this.tmpPlanet)
      .applyQuaternion(this.tmpQuatInv);
  }

  private createEntry(idx: number, planet: Planet): MeshEntry {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: meshVert,
      fragmentShader: meshFrag,
      uniforms: {
        uMap: { value: this.placeholder },
        uHasMap: { value: 0 },
        uNightMap: { value: this.placeholder },
        uHasNight: { value: 0 },
        uColour: { value: new THREE.Color(1, 1, 1) },
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uFade: { value: 0 },
        uPhaseScale: { value: 1 },
        uLitIntensity: { value: 1 },
        uTermSoftness: { value: planet.terminatorSoftness ?? 0 },
        uCasters: {
          value: Array.from({ length: MAX_SHADOW_CASTERS }, () => new THREE.Vector4()),
        },
        uCasterCount: { value: 0 },
        uSunAngRad: { value: 0 },
      },
      transparent: true,
      depthWrite: true,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.name = 'planet-mesh';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2.8;
    this.group.add(mesh);
    const boundRadiusPc =
      (planet.rings ? planet.rings.outerRadiusKm : planet.radiusKm) * KM_PC;
    const entry: MeshEntry = { mesh, material, boundRadiusPc };
    if (planet.rings) entry.ring = this.createRing(planet, planet.rings);
    this.entries.set(idx, entry);
    return entry;
  }

  private createRing(planet: Planet, rings: PlanetRings): RingEntry {
    const outerPc = rings.outerRadiusKm * KM_PC;
    const innerRatio = rings.innerRadiusKm / rings.outerRadiusKm;
    const geometry = new THREE.RingGeometry(innerRatio, 1, 128, 1);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: ringsVert,
      fragmentShader: ringsFrag,
      uniforms: {
        uRingMap: { value: this.placeholder },
        uInnerRatio: { value: innerRatio },
        uOuterPc: { value: outerPc },
        uEqRadiusPc: { value: planet.radiusKm * KM_PC },
        uPolarRadiusPc: { value: planet.radiusKm * KM_PC * (1 - (planet.flattening ?? 0)) },
        uSunDirLocal: { value: new THREE.Vector3(0, 0, 1) },
        uCamPosLocal: { value: new THREE.Vector3(0, 0, 1) },
        uFade: { value: 0 },
        uLitIntensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'planet-rings';
    mesh.frustumCulled = false;
    // After the body mesh (2.8) so the near-side ring segment draws
    // over the depth the body just wrote; far side depth-fails.
    mesh.renderOrder = 2.81;
    mesh.scale.setScalar(outerPc);
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, material, geometry };
  }

  private ensureTexture(name: string, ext: 'jpg' | 'png' = 'jpg'): void {
    const key = name.toLowerCase();
    if (this.textures.has(key)) return;
    this.textures.set(key, { state: 'loading' });
    this.loader.load(
      `${this.textureBaseUrl}textures/${key}.${ext}`,
      (tex) => {
        // Raw sRGB values, matching the pipeline's convention of
        // writing colours to the framebuffer without a colorspace
        // transform (star/planet shaders do the same).
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        this.textures.set(key, { state: 'ready', tex });
      },
      undefined,
      () => {
        // Texture-less bodies (Uranus, future exoplanets) take the
        // representative-colour base path — a 404 is expected data.
        this.textures.set(key, { state: 'missing' });
      },
    );
  }

  dispose(): void {
    for (const { mesh, material, ring } of this.entries.values()) {
      this.group.remove(mesh);
      material.dispose();
      if (ring) {
        this.group.remove(ring.mesh);
        ring.material.dispose();
        ring.geometry.dispose();
      }
    }
    this.entries.clear();
    for (const t of this.textures.values()) {
      if (t.state === 'ready') t.tex.dispose();
    }
    this.textures.clear();
    this.geometry.dispose();
    this.placeholder.dispose();
  }
}
