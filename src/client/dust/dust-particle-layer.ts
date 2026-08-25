import * as THREE from 'three';
import type { DustParticleData } from '../loaders/dust-loader';
import type { EmitterMaterial } from '../scene/emitter-material';
import dustParticleVert from './dust-particle.vert.glsl?raw';
import dustParticleFrag from './dust-particle.frag.glsl?raw';

// Star-material uniforms shared with the particle shader. Reference-
// shared (not cloned) so floating-origin recenters, resize updates, and
// dust-texture loads propagate to the particle pass automatically.
export interface DustParticleSharedUniforms {
  uPixelRatio: { value: number };
  uViewport: { value: THREE.Vector2 };
  uWorldOffset: { value: THREE.Vector3 };
  uDustEnabled: { value: number };
  uDustDensityMin: { value: number };
  uDustLogRatio: { value: number };
}

/**
 * The renderer-neutral contract the sprite surface is built through
 * (README.md § The material seam). The geometry crosses backends
 * unchanged — three buffers, well inside WebGPU's eight — so this ports
 * as a material swap rather than a layer of its own.
 */
export interface DustParticleMaterials {
  dustParticles(shared: DustParticleSharedUniforms): EmitterMaterial;
}

/** The WebGL2 implementation. The six shared slots bind by reference, so a
 *  floating-origin recentre or a resize reaches the sprite pass with no
 *  per-frame copy; `uParticleStrength` is the layer's own. */
export function makeGlslDustParticleMaterials(): DustParticleMaterials {
  return {
    dustParticles(u) {
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uPixelRatio: u.uPixelRatio,
          uViewport: u.uViewport,
          uWorldOffset: u.uWorldOffset,
          uDustEnabled: u.uDustEnabled,
          uDustDensityMin: u.uDustDensityMin,
          uDustLogRatio: u.uDustLogRatio,
          uParticleStrength: { value: 0.0 },
        },
        vertexShader: dustParticleVert,
        fragmentShader: dustParticleFrag,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });
      return {
        material,
        uniforms: material.uniforms,
        dispose: () => material.dispose(),
      };
    },
  };
}

// Currently shelved — see ./README.md. Default strength = 0 →
// mesh.visible = false → zero per-frame cost.
export class DustParticleLayer {
  private mesh: THREE.Mesh | null = null;
  private surface: EmitterMaterial | null = null;
  private readonly materials: DustParticleMaterials;

  constructor(
    private scene: THREE.Scene,
    private sharedUniforms: DustParticleSharedUniforms,
    materials?: DustParticleMaterials,
  ) {
    this.materials = materials ?? makeGlslDustParticleMaterials();
  }

  /** Build the particle mesh from loaded data. Idempotent — re-calling
   *  with new data replaces the existing mesh. */
  attach(data: DustParticleData) {
    this.dispose({ removeFromScene: true });

    const geom = new THREE.InstancedBufferGeometry();
    geom.setAttribute(
      'aCorner',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
        2,
      ),
    );
    geom.setIndex([0, 1, 2, 1, 3, 2]);
    geom.setAttribute('iPosition', new THREE.InstancedBufferAttribute(data.positions, 3));
    geom.setAttribute('iDensity', new THREE.InstancedBufferAttribute(data.densities, 1));
    geom.instanceCount = data.count;
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60_000);

    this.surface = this.materials.dustParticles(this.sharedUniforms);
    this.mesh = new THREE.Mesh(geom, this.surface.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // after disc + glow passes
    this.mesh.visible = false; // hidden until strength > 0
    this.scene.add(this.mesh);
  }

  /** User-facing visibility knob. 0 = hidden (default); higher = stronger
   *  additive contribution. The mesh is hidden entirely at strength 0 so
   *  the GPU draw call is skipped. No-op before attach(). */
  setStrength(x: number) {
    if (!this.surface || !this.mesh) return;
    const v = Math.max(0, x);
    this.surface.uniforms.uParticleStrength.value = v;
    this.mesh.visible = v > 0;
  }

  // Two callers: attach() (removeFromScene: true — pull old mesh before
  // adding new one) and Stellata.dispose (default false — whole scene is
  // GC-bound). Both must release geometry + material; one owner means a
  // third resource can't be forgotten in one of the two cleanup paths.
  dispose(opts: { removeFromScene: boolean } = { removeFromScene: false }) {
    if (!this.mesh) return;
    if (opts.removeFromScene) this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.surface?.dispose();
    this.mesh = null;
    this.surface = null;
  }
}
