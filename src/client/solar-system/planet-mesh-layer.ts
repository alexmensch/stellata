// Close-range spheroid mesh LOD for planet bodies. See README.md
// § Planet mesh LOD for the crossfade + lazy-texture contract.

import * as THREE from 'three';
import { KM_PC } from '../util/astronomy-constants';
import type { PlanetBodyField } from './planet-body-field';
import {
  meshFade,
  physicalDiameterPx,
  TEXTURE_PREFETCH_PX,
} from './mesh-crossfade';
import meshVert from './planet-mesh.vert.glsl?raw';
import meshFrag from './planet-mesh.frag.glsl?raw';

interface MeshEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
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
  private readonly poleTilt = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2,
  );

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

  /** Per-frame: show/scale/light every body inside the crossfade band.
   *  Reads the body field's live buffers, so recentres and scrubber
   *  motion need no extra hooks. */
  update(camera: THREE.PerspectiveCamera, viewportHPx: number): void {
    this.group.visible = this.field.group.visible;
    if (!this.group.visible) return;

    const fovYRad = (camera.fov * Math.PI) / 180;
    const shown = new Set<number>();
    const n = this.field.liveInstanceCount;
    for (let idx = 0; idx < n; idx++) {
      if (idx === this.field.hiddenInstanceIdx) continue;
      const planet = this.field.planetAt(idx);
      if (!planet) continue;
      if (!this.field.planetLocalPositionInto(idx, this.tmpPlanet)) continue;

      const radiusPc = planet.radiusKm * KM_PC;
      const distPc = this.tmpPlanet.distanceTo(camera.position);
      const px = physicalDiameterPx(radiusPc, distPc, fovYRad, viewportHPx);
      if (px >= TEXTURE_PREFETCH_PX) this.ensureTexture(planet.name);
      const fade = meshFade(px);
      if (fade <= 0) continue;

      const entry = this.entries.get(idx) ?? this.createEntry(idx);
      shown.add(idx);
      const { mesh, material } = entry;
      mesh.visible = true;
      mesh.position.copy(this.tmpPlanet);
      const polar = radiusPc * (1 - (planet.flattening ?? 0));
      mesh.scale.set(radiusPc, polar, radiusPc);

      // Geometry pole (+Y) → orbital-plane normal (host frame +Z) →
      // ICRS via the host orientation. Prime meridian is arbitrary
      // until IAU rotation elements land.
      const hp = this.field.hostPlanetOf(idx);
      const orientation = hp === null
        ? null
        : this.field.hostOrientationOf(hp.hostStarIdx);
      if (orientation) {
        mesh.quaternion.copy(orientation).multiply(this.poleTilt);
      }

      // Host-star direction in view space drives the terminator.
      if (hp && this.field.getHostLocalPositionInto(hp.hostStarIdx, this.tmpHost)) {
        this.tmpSun.subVectors(this.tmpHost, this.tmpPlanet);
        if (this.tmpSun.lengthSq() > 0) {
          this.tmpSun.normalize().transformDirection(camera.matrixWorldInverse);
          (material.uniforms.uSunDirView.value as THREE.Vector3).copy(this.tmpSun);
        }
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
    }

    for (const [idx, entry] of this.entries) {
      if (!shown.has(idx)) entry.mesh.visible = false;
    }
  }

  private createEntry(idx: number): MeshEntry {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: meshVert,
      fragmentShader: meshFrag,
      uniforms: {
        uMap: { value: this.placeholder },
        uHasMap: { value: 0 },
        uColour: { value: new THREE.Color(1, 1, 1) },
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uFade: { value: 0 },
      },
      transparent: true,
      depthWrite: true,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.name = 'planet-mesh';
    mesh.frustumCulled = false;
    // After the corrupt/restore depth pair (1.5/2.5), before the disc
    // pass (3) so the fading disc max-blends over the mesh.
    mesh.renderOrder = 2.8;
    this.group.add(mesh);
    const entry = { mesh, material };
    this.entries.set(idx, entry);
    return entry;
  }

  private ensureTexture(name: string): void {
    const key = name.toLowerCase();
    if (this.textures.has(key)) return;
    this.textures.set(key, { state: 'loading' });
    this.loader.load(
      `${this.textureBaseUrl}textures/${key}.jpg`,
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
    for (const { mesh, material } of this.entries.values()) {
      this.group.remove(mesh);
      material.dispose();
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
