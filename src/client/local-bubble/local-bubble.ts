// Translucent Fresnel shell of the Local Bubble's dust wall + its
// silhouette label. See src/client/local-bubble/README.md.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import type { LocalBubbleMesh } from './local-bubble-loader';
import {
  FresnelShell,
  createFresnelShellMaterial,
  createShellSilhouetteLabel,
} from '../fresnel-shell/fresnel-shell';
import type { ShellCardInfo } from '../fresnel-shell/shell-registry';

// Dim additive cool tint — a soft rim glow seen from beyond the wall.
const COLOUR = new THREE.Color(0x5a7a9c);
const ALPHA_LIMB = 0.5;

/** DOM id of the SVG `<text>` node for the label. */
export const LOCAL_BUBBLE_LABEL_ELEMENT_ID = 'local-bubble-label';

/** Focus-target display name + card content (registered into the shell
 *  registry on attach). Non-luminous, so no magnitude rows. */
export const LOCAL_BUBBLE_LABEL = 'Local Bubble';
export const LOCAL_BUBBLE_CARD: ShellCardInfo = {
  typeLine: 'Interstellar medium cavity',
  size: '~75–300 pc wall',
  knownFrom: 'Zucker et al. 2022',
};

// Surface samples the label projects each frame for its silhouette bbox.
// ~96 vertices spread across the shell: enough to hug the silhouette, and
// — since they sit ON the wall — the label engine auto-hides the label
// when the camera is inside (a sample crosses behind the near plane).
const LABEL_SAMPLE_TARGET = 96;

export class LocalBubbleShell extends FresnelShell {
  private geometry: THREE.BufferGeometry | null = null;
  private mesh: THREE.Mesh | null = null;
  // Absolute ICRS pc (Sol origin) surface samples for the label silhouette.
  private sampleAbs = new Float32Array(0);

  constructor() {
    // renderOrder −1 (with the galactic disc): a background shell, so the
    // local stars inside it composite on top. See src/client/README.md
    // § Full render stack.
    super(
      createFresnelShellMaterial({
        colour: COLOUR,
        alphaLimb: ALPHA_LIMB,
        blending: THREE.AdditiveBlending,
      }),
      -1,
    );
  }

  /** Build the shell from a parsed mesh. Idempotent — replaces any prior
   *  mesh. Vertex positions are absolute ICRS pc (Sol origin); `recenter`
   *  applies the floating origin. */
  attach(data: LocalBubbleMesh): void {
    this.disposeGeometry();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    this.geometry.computeVertexNormals();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = this.group.renderOrder;
    this.group.add(this.mesh);

    const vertexCount = data.positions.length / 3;
    const stride = Math.max(1, Math.floor(vertexCount / LABEL_SAMPLE_TARGET));
    const samples: number[] = [];
    for (let k = 0; k < vertexCount; k += stride) {
      samples.push(data.positions[k * 3], data.positions[k * 3 + 1], data.positions[k * 3 + 2]);
    }
    this.sampleAbs = new Float32Array(samples);
    this.refreshVisibility();
  }

  hasMesh(): boolean {
    return this.mesh !== null;
  }

  /** Number of label silhouette samples (0 until a mesh is attached). */
  labelSampleCount(): number {
    return this.sampleAbs.length / 3;
  }

  /** Surface sample `i` in renderer-local coords (absolute − worldOffset).
   *  The label engine projects these for its silhouette bbox + inside-hide.
   *  Written into `out`. */
  labelSampleInto(i: number, worldOffset: Readonly<THREE.Vector3>, out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      this.sampleAbs[i * 3],
      this.sampleAbs[i * 3 + 1],
      this.sampleAbs[i * 3 + 2],
    ).sub(worldOffset);
  }

  protected shellReady(): boolean {
    return this.mesh !== null;
  }

  override dispose(): void {
    this.disposeGeometry();
    super.dispose();
  }

  private disposeGeometry(): void {
    if (this.mesh) this.group.remove(this.mesh);
    this.geometry?.dispose();
    this.geometry = null;
    this.mesh = null;
  }
}

/** Mount the SVG "Local Bubble" label. A `labels`-tier declutter element
 *  (`localBubbleLabel`) — shows at detail level `all` in realistic mode,
 *  hugging the shell's silhouette. It hides when the camera is inside the
 *  bubble: a surface sample then crosses behind the near plane and the
 *  label engine bails (same mechanism as the heliopause apex label). */
export function createLocalBubbleLabel(stellata: Stellata): void {
  const shell = stellata.getLocalBubbleShell();
  createShellSilhouetteLabel(stellata, {
    elementId: LOCAL_BUBBLE_LABEL_ELEMENT_ID,
    sampleCount: shell.labelSampleCount(),
    getWorldSample: (i, out) => shell.labelSampleInto(i, stellata.getWorldOffset(), out),
    visible: () =>
      !stellata.getMonochrome()
      && stellata.detailPermits('localBubbleLabel')
      && shell.hasMesh(),
  });
}
