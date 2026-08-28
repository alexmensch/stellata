import * as THREE from 'three';
import { GAL_TO_ICRS, GALACTIC_CENTRE_PC } from './galactic-coords';
import { FADE_INNER_PC, FADE_OUTER_PC, smoothstep } from './galactic-fade';
import type {
  ChromeLineMaterial, ChromeLineMaterials,
} from '../chrome-lines/chrome-line-materials';
import { makeOrbitLineLoop } from '../util/orbit-line';
import {
  BULGE_HALF_THICKNESS_PC,
  BULGE_RADIUS_PC,
  DISC_HALF_THICKNESS_PC,
  DISC_RADIUS_PC,
} from '../milkyway/milkyway-column-pure';

// Every extent here is the matching Milky Way proxy-mesh envelope, taken
// by import rather than restated: the wireframe's job is to outline the
// volume that emits, so a divergence renders light outside its own
// outline. Hand-set values previously ran 1.5× short vertically on the
// disc and 2× on the bulge.
//
// Exported for the MW SVG label (`createMilkyWayLabel` in local-group.ts),
// which anchors to the rim's projected silhouette rather than the bulge
// projection — the latter sits ~12× smaller and made the label hug the GC
// core instead of the disc edge.
export const MIDPLANE_RADIUS_PC = DISC_RADIUS_PC;
const THICKNESS_HALF_PC = DISC_HALF_THICKNESS_PC;
const MIDPLANE_SEGMENTS = 128;
const BULGE_SEGMENTS = 64;

// Default colour — warm amber for the dark theme. Chart (mono) mode hides
// the disc entirely rather than swapping the stroke; a 15 kpc reference ring
// reads as visual noise on a paper-chart aesthetic, and the arrows + sphere
// already provide orientation in mono.
const DARK_COLOUR = 0xa08660;

const DARK_BASE_OPACITY = 0.55;

const DISC_RENDER_ORDER = -1;

/**
 * Always-on Milky Way disc reference. Three concentric line components live
 * in absolute equatorial space centred on the galactic centre:
 *
 *   1. a 15 kpc radius midplane ring (b=0),
 *   2. two thickness rings offset ±400 pc along the galactic z-axis,
 *   3. a small bulge wireframe at the galactic centre itself.
 *
 * Sol sits ~8 kpc *inside* the disc, so the rendered disc is centred on the
 * GC, not on the camera. The geometry is pre-transformed once (galactic →
 * ICRS via GAL_TO_ICRS, plus the GC offset) and rebased per frame by
 * setting `group.position = -worldOffset`, so under the floating origin the
 * absolute-space vertices project correctly into the renderer's local frame.
 *
 * Opacity smoothsteps from 0 to a base value as the camera pulls away from
 * Sol — invisible during local browsing, gradually revealed as the user
 * zooms out enough to need orientation context. In mono (chart) mode the
 * fade is disabled and the strokes swap to dark, fully-opaque lines for the
 * paper-chart aesthetic.
 */
export class GalacticDisc {
  readonly group: THREE.Group;
  // Single shared stroke across all 6 rings — they're visually identical and
  // the per-frame fade writes to one .opacity, not six.
  private readonly stroke: ChromeLineMaterial;
  private mono = false;

  constructor(chromeLines: ChromeLineMaterials) {
    this.group = new THREE.Group();
    this.group.renderOrder = DISC_RENDER_ORDER;

    this.stroke = chromeLines.solid(DARK_COLOUR, 0);

    const midplane = this.makeRing(
      MIDPLANE_RADIUS_PC,
      MIDPLANE_RADIUS_PC,
      0,
      MIDPLANE_SEGMENTS,
      'xy',
    );
    const thicknessTop = this.makeRing(
      MIDPLANE_RADIUS_PC,
      MIDPLANE_RADIUS_PC,
      THICKNESS_HALF_PC,
      MIDPLANE_SEGMENTS,
      'xy',
    );
    const thicknessBot = this.makeRing(
      MIDPLANE_RADIUS_PC,
      MIDPLANE_RADIUS_PC,
      -THICKNESS_HALF_PC,
      MIDPLANE_SEGMENTS,
      'xy',
    );

    // Bulge: three orthogonal loops in galactic frame, all centred on GC.
    // xy gives the equator of the bulge (circle of radius 3 kpc); xz and yz
    // are the meridians (ellipses 3 kpc × 1.5 kpc thick) so the wireframe
    // reads as an oblate ellipsoid from any angle.
    const bulgeXY = this.makeRing(BULGE_RADIUS_PC, BULGE_RADIUS_PC, 0, BULGE_SEGMENTS, 'xy');
    const bulgeXZ = this.makeRing(BULGE_RADIUS_PC, BULGE_HALF_THICKNESS_PC, 0, BULGE_SEGMENTS, 'xz');
    const bulgeYZ = this.makeRing(BULGE_RADIUS_PC, BULGE_HALF_THICKNESS_PC, 0, BULGE_SEGMENTS, 'yz');

    for (const m of [midplane, thicknessTop, thicknessBot, bulgeXY, bulgeXZ, bulgeYZ]) {
      this.group.add(m);
    }
  }

  /** Per-frame update. Call before render. */
  update(worldOffset: THREE.Vector3, distFromSolPc: number) {
    // Hidden in chart mode entirely — the disc reference is dark-mode only.
    if (this.mono) {
      this.group.visible = false;
      return;
    }

    // Place the group at -worldOffset so absolute-space vertices project to
    // local frame: localVertex = absoluteVertex + group.position
    //                          = absoluteVertex - worldOffset.
    this.group.position.copy(worldOffset).negate();

    const opacity = DARK_BASE_OPACITY * smoothstep(
      FADE_INNER_PC,
      FADE_OUTER_PC,
      distFromSolPc,
    );
    if (opacity <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.stroke.material.opacity = opacity;
  }

  setMonochrome(on: boolean) {
    this.mono = on;
  }

  /**
   * Build a closed line loop in the galactic frame, transform to ICRS, and
   * translate by GALACTIC_CENTRE_PC so it lives in absolute equatorial pc.
   * `plane` selects which two galactic axes carry the radial sweep:
   *  - 'xy' → ring lies in the b=0 plane (z held at zOffset)
   *  - 'xz' → meridian in the l=0 plane
   *  - 'yz' → meridian in the l=90 plane
   * For 'xz'/'yz' rings, the secondary axis sweeps to ±radiusB so we can
   * draw oblate ellipses (e.g. the 3 kpc × 1.5 kpc bulge).
   */
  private makeRing(
    radiusA: number,
    radiusB: number,
    zOffset: number,
    segments: number,
    plane: 'xy' | 'xz' | 'yz',
  ): THREE.Line {
    const v = new Float32Array(segments * 3);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const a = Math.cos(t) * radiusA;
      const b = Math.sin(t) * radiusB;
      if (plane === 'xy') tmp.set(a, b, zOffset);
      else if (plane === 'xz') tmp.set(a, 0, b);
      else /* yz */ tmp.set(0, a, b);
      tmp.applyMatrix4(GAL_TO_ICRS).add(GALACTIC_CENTRE_PC);
      v[i * 3 + 0] = tmp.x;
      v[i * 3 + 1] = tmp.y;
      v[i * 3 + 2] = tmp.z;
    }
    // A bounding sphere drawn from the geometry would be huge and miscentred
    // (group origin is offset per frame), so the primitive turns frustum
    // culling off and the disc never disappears at extreme camera positions.
    return makeOrbitLineLoop(v, this.stroke.material, DISC_RENDER_ORDER);
  }

  dispose() {
    for (const child of this.group.children) {
      const obj = child as THREE.Line;
      obj.geometry.dispose();
    }
    this.stroke.dispose();
  }
}
