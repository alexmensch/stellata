import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { glslCallArgs } from '../../util/glsl-call-args';
import { makeMockHdrEmitterUniforms } from '../../kinds/kind-context-mock';
import { SOL_BODIES } from '../planet-system';
import { TEXTURE_VRAM_BUDGET_BYTES } from './textures/texture-budget-pure';
import type { PlanetBodyField } from './planet-body-field';
import { PlanetMeshLayer, TEXTURE_DECODE_OPTIONS } from './planet-mesh-layer';
import { AU_PC, R_SUN_PC } from '../../util/astronomy-constants';
import { phaseAngleFromLegs } from '../phase-function';
import { ringPhaseFactor, ringPlaneElevationDeg } from './rings/ring-photometry-pure';
import { poleVectorAt } from './rotation/rotation-elements-pure';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

/** The alpha of a `vec4(rgb, a)` write, or the sole argument of an occluder
 *  texel. */
const lastArgOf = (src: string, name: string) => glslCallArgs(src, name).at(-1);

// Every surface this layer draws alpha-composites in FRONT of the volumetric
// emitters, which live in attachment 2 until the resolve convolves them
// (../../hdr/summation/README.md). Depth cannot help: the emitters drew first
// and the resolve adds attachment 2 unconditionally, so a surface that leaves
// the diffuse field out of its own blend chain gets the Milky Way band added
// back on top of it — visible on a planet's night side, a shadowed ring
// section and the atmosphere limb, exactly where the surface is dim.
describe('the planet surfaces occlude the diffuse attachment', () => {
  const SURFACES = [
    { label: 'body mesh', frag: './planet-mesh.frag.glsl' },
    { label: 'ring annulus', frag: './rings/planet-rings.frag.glsl' },
    { label: 'atmosphere shell', frag: '../atmosphere/planet-atmosphere.frag.glsl' },
  ];

  for (const { label, frag } of SURFACES) {
    describe(label, () => {
      const src = read(frag);

      it('declares the diffuse attachment it has to dim', () => {
        expect(src).toMatch(/layout\(location = 2\) out vec4 outDiffuse;/);
      });

      // One blend equation runs over every attachment, so black at the
      // fragment's own alpha dims attachment 2 by exactly the opacity
      // attachment 0 was composited with. A DIFFERENT alpha would occlude the
      // band by a different amount than it occludes everything else — which
      // is the one way this can go wrong without failing to compile.
      it('dims it by the same alpha it composites attachment 0 with', () => {
        expect(src).toContain('outDiffuse = stellataOccluderTexel(');
        expect(lastArgOf(src, 'stellataOccluderTexel')).toBe(
          lastArgOf(src, 'outColor = vec4'),
        );
      });
    });
  }

  // The `location = 2` declarations above are discarded unless the draw opens
  // attachment 2, and a draw that opens it without declaring the output leaves
  // it undefined. Neither half errors on its own, so both are pinned.
  it('marks all three meshes occluding emitters, so the gate opens', () => {
    const src = read('./planet-mesh-layer.ts');
    expect(src.match(/markOccludingEmitter\(mesh\)/g)).toHaveLength(SURFACES.length);
    expect(src).not.toContain('markStatisticEmitter');
  });
});

// Orientation has to arrive from the decode. An HTMLImageElement upload puts
// it back on UNPACK_FLIP_Y_WEBGL, whose tracked value a write elsewhere in the
// app can desync from GL (../../loaders/README.md) — and a map that arrives
// unflipped shades the mirrored hemisphere while changing nothing else.
describe('planet maps decode with an explicit orientation', () => {
  const src = read('./planet-mesh-layer.ts');

  it('bakes the flip into the bitmap, and never loads through TextureLoader', () => {
    expect(TEXTURE_DECODE_OPTIONS.imageOrientation).toBe('flipY');
    expect(src).toContain('tex.flipY = false');
    expect(src).not.toContain('new THREE.TextureLoader');
  });

  // Each horizon map's fourth azimuth rides the alpha channel
  // (surface-relief/README.md), so a premultiplying decode scales the other
  // three by it. Both are spelled out because setOptions replaces the loader's
  // own defaults rather than merging into them.
  it('never premultiplies and never converts colour space', () => {
    expect(TEXTURE_DECODE_OPTIONS.premultiplyAlpha).toBe('none');
    expect(TEXTURE_DECODE_OPTIONS.colorSpaceConversion).toBe('none');
  });

  // The loader assigns its own forced options over the object it is given.
  it('hands the loader a copy of the options, not the exported constant', () => {
    expect(src).toContain('setOptions({ ...TEXTURE_DECODE_OPTIONS })');
  });
});

// The release path is what makes the texture ladder affordable: an 8192 map is
// 179 MB resident and before it existed nothing was ever freed. These drive the
// real layer — a stub field and a stub loader — because the mechanism lives in
// the ordering between a fetch landing, a rung being promoted, and the budget
// pass, and none of that is visible in the pure helpers it calls.
describe('the layer releases what it stops drawing', () => {
  const BYTES_8192_SQ = Math.round((8192 * 8192 * 4 * 4) / 3);

  interface FakeBitmap {
    width: number;
    height: number;
    close: ReturnType<typeof vi.fn>;
  }

  function harness(bodyNames: string[], maxTextureSize = 8192) {
    const planets = bodyNames.map((n) => SOL_BODIES.find((b) => b.name === n)!);
    const physPx = new Map<number, number>();
    const loads: { url: string; onLoad: (bitmap: unknown) => void }[] = [];
    vi.spyOn(THREE.ImageBitmapLoader.prototype, 'load').mockImplementation(
      ((url: string, onLoad: (bitmap: unknown) => void) => {
        loads.push({ url, onLoad });
      }) as never,
    );
    const field = {
      group: new THREE.Group(),
      monochrome: false,
      liveInstanceCount: planets.length,
      hiddenInstanceIdx: -1,
      planetAt: (i: number) => planets[i] ?? null,
      planetLocalPositionInto: (i: number, out: THREE.Vector3) => {
        out.set(i + 1, 0, 0);
        return true;
      },
      physicalPlanetSizePx: (i: number) => physPx.get(i) ?? 0,
      // No host: an unlit body skips the sun, caster and atmosphere legs, none
      // of which this is about.
      hostPlanetOf: () => null,
    } as unknown as PlanetBodyField;
    const layer = new PlanetMeshLayer(
      field,
      '/',
      { ...makeMockHdrEmitterUniforms(), uPixelRatio: { value: 1 } },
      () => {},
      maxTextureSize,
    );
    const camera = new THREE.PerspectiveCamera();
    return {
      layer,
      loads,
      /** One frame, with each body at the given projected diameter. */
      frame(sizes: number[]): void {
        physPx.clear();
        sizes.forEach((px, i) => physPx.set(i, px));
        layer.update(camera, 0);
      },
      pendingFor(key: string): boolean {
        return loads.some((l) => l.url.includes(key));
      },
      /** Land a pending fetch, as a bitmap of the given dimensions. */
      resolve(key: string, width: number, height = width / 2): FakeBitmap {
        const i = loads.findIndex((l) => l.url.includes(key));
        expect(i, `no fetch pending for ${key}`).toBeGreaterThanOrEqual(0);
        const [pending] = loads.splice(i, 1);
        const bitmap: FakeBitmap = { width, height, close: vi.fn() };
        pending.onLoad(bitmap);
        return bitmap;
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('frees the narrower rung once a wider one is drawn', () => {
    const h = harness(['Europa']);
    h.frame([600]);
    const narrow = h.resolve('europa-2048', 2048);
    h.frame([600]);

    h.frame([3000]);
    const wide = h.resolve('europa-8192', 8192);
    expect(narrow.close).not.toHaveBeenCalled();
    h.frame([3000]);

    // Both halves of a release: the GL object AND the decoded bitmap, which no
    // GPU budget can see.
    expect(narrow.close).toHaveBeenCalledTimes(1);
    expect(wide.close).not.toHaveBeenCalled();
  });

  it('releases a rung the demand moved past while it was still in flight', () => {
    // The case promotion cannot reach: releaseOtherRungs frees only RESIDENT
    // rungs, and a loading one is not resident yet. Fetches land out of order
    // for real — an evicted wider rung returns off the HTTP cache while a
    // narrower one is still on the wire — so the loser has to be caught on
    // arrival or it sits resident and undrawn until budget pressure finds it.
    const h = harness(['Europa']);
    h.frame([600]);
    expect(h.pendingFor('europa-2048')).toBe(true);

    // Demand outruns the fetch, so a wider rung is asked for and lands first.
    h.frame([3000]);
    expect(h.pendingFor('europa-8192')).toBe(true);
    h.resolve('europa-8192', 8192);
    h.frame([3000]);

    const superseded = h.resolve('europa-2048', 2048);
    expect(superseded.close).toHaveBeenCalledTimes(1);
  });

  it('never evicts a map drawn this frame, however far over budget', () => {
    const h = harness(['Europa', 'Ganymede']);
    h.frame([3000, 3000]);
    // Square maps, so two of them are 716 MB against the 512 MB budget.
    const a = h.resolve('europa-8192', 8192, 8192);
    const b = h.resolve('ganymede-8192', 8192, 8192);
    expect(BYTES_8192_SQ * 2).toBeGreaterThan(TEXTURE_VRAM_BUDGET_BYTES);

    h.frame([3000, 3000]);
    // Evicting either flips a body on screen to its placeholder mid-view, which
    // is worse than being over budget: the pass sheds what it can and stops.
    expect(a.close).not.toHaveBeenCalled();
    expect(b.close).not.toHaveBeenCalled();
  });

  it('evicts the least-recently-drawn map, and forgets it was drawn', () => {
    const h = harness(['Europa', 'Ganymede']);
    h.frame([3000, 3000]);
    const kept = h.resolve('europa-8192', 8192, 8192);
    const dropped = h.resolve('ganymede-8192', 8192, 8192);
    h.frame([3000, 3000]);

    // Ganymede leaves the crossfade band, so it stops being stamped and becomes
    // the only candidate.
    h.frame([3000, 0]);
    expect(dropped.close).toHaveBeenCalledTimes(1);
    expect(kept.close).not.toHaveBeenCalled();

    // And the body must stop claiming a rung it no longer holds, or it renders
    // its placeholder until it happens to grow into a new one.
    h.frame([3000, 3000]);
    expect(h.pendingFor('ganymede-8192')).toBe(true);
  });

  it('refuses a map wider than the device accepts, without retrying it', () => {
    // Relief and ring maps ship one fixed width each, so the ladder's own clamp
    // cannot cover them — an oversized upload fails and leaves the body white.
    const h = harness(['Europa'], 4096);
    h.frame([3000]);
    const tooBig = h.resolve('europa-4096', 8192, 4096);
    expect(tooBig.close).toHaveBeenCalledTimes(1);

    h.frame([3000]);
    expect(h.pendingFor('europa-4096')).toBe(false);
  });

  it('never asks for a rung past the device cap in the first place', () => {
    const h = harness(['Europa'], 4096);
    h.frame([3000]);
    expect(h.pendingFor('europa-8192')).toBe(false);
    expect(h.pendingFor('europa-4096')).toBe(true);
  });

  it('closes every bitmap it still holds on dispose', () => {
    const h = harness(['Europa']);
    h.frame([600]);
    const map = h.resolve('europa-2048', 2048);
    h.frame([600]);

    h.layer.dispose();
    expect(map.close).toHaveBeenCalledTimes(1);
  });
});

describe('the ring annulus phase scalar', () => {
  /** A lit Saturn with its ring strip resolved, so updateRing runs whole. */
  function litHarness(camera: THREE.Vector3) {
    const saturn = SOL_BODIES.find((b) => b.name === 'Saturn')!;
    const loads: { url: string; onLoad: (bitmap: unknown) => void }[] = [];
    vi.spyOn(THREE.ImageBitmapLoader.prototype, 'load').mockImplementation(
      ((url: string, onLoad: (bitmap: unknown) => void) => {
        loads.push({ url, onLoad });
      }) as never,
    );
    // Saturn on +x at 9.5 AU, host at the local origin.
    const planetPos = new THREE.Vector3(9.5 * AU_PC, 0, 0);
    const field = {
      group: new THREE.Group(),
      monochrome: false,
      liveInstanceCount: 1,
      hiddenInstanceIdx: -1,
      planetAt: () => saturn,
      planetLocalPositionInto: (_i: number, out: THREE.Vector3) => {
        out.copy(planetPos);
        return true;
      },
      physicalPlanetSizePx: () => 600,
      hostPlanetOf: () => ({ hostStarIdx: 0, planetIdx: 0 }),
      getHostLocalPositionInto: (_h: number, out: THREE.Vector3) => {
        out.set(0, 0, 0);
        return true;
      },
      hostAbsmagOf: () => 4.83,
      hostRadiusOf: () => R_SUN_PC,
      hostOrientationOf: () => new THREE.Quaternion(),
      getAttachedPlanetSystem: () => ({ hostStarIdx: 0, planets: [saturn] }),
      eclipseDimForInstance: () => 1,
    } as unknown as PlanetBodyField;
    const layer = new PlanetMeshLayer(
      field,
      '/',
      { ...makeMockHdrEmitterUniforms(), uPixelRatio: { value: 1 } },
      () => {},
      8192,
    );
    const cam = new THREE.PerspectiveCamera();
    cam.position.copy(camera);
    cam.updateMatrixWorld(true);
    layer.update(cam, 0);
    // Land every pending map, the ring strip included, then draw again.
    for (const pending of loads.splice(0)) {
      pending.onLoad({ width: 2048, height: 1024, close: vi.fn() });
    }
    layer.update(cam, 0);
    const ring = layer.group.getObjectByName('planet-rings') as
      | THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
      | undefined;
    return { layer, ring, planetPos };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reaches the annulus material, and agrees with the pure law', () => {
    // Near-opposition Earth-like vantage.
    const camPos = new THREE.Vector3(1 * AU_PC, 0, 0);
    const { layer, ring, planetPos } = litHarness(camPos);
    expect(ring, 'no ring annulus drawn').toBeDefined();
    expect(ring!.visible).toBe(true);

    const saturn = SOL_BODIES.find((b) => b.name === 'Saturn')!;
    const pole = { x: 0, y: 0, z: 0 };
    poleVectorAt(saturn.rotation!, 0, pole);
    const poleVec = new THREE.Vector3(pole.x, pole.y, pole.z);
    const toCam = camPos.clone().sub(planetPos);
    const toHost = planetPos.clone().negate();
    const expected = ringPhaseFactor(
      saturn.rings!.systemPhotometry,
      phaseAngleFromLegs(toCam.x, toCam.y, toCam.z, toHost.x, toHost.y, toHost.z),
      ringPlaneElevationDeg(toCam.x, toCam.y, toCam.z, poleVec.x, poleVec.y, poleVec.z),
      ringPlaneElevationDeg(
        toHost.x, toHost.y, toHost.z, poleVec.x, poleVec.y, poleVec.z),
      saturn.phaseCoefficients,
    );
    expect(ring!.material.uniforms.uRingPhaseScale.value).toBeCloseTo(expected, 6);
    layer.dispose();
  });

  it('is 1 at opposition and falls off inside the first fraction of a degree', () => {
    // The surge is 0.3 deg wide, so the vantages that bracket it are a
    // hair apart: on the host→planet line (alpha = 0), then 0.02 AU off
    // it at 8.5 AU range — alpha ~ 0.13 deg, a fifth of the way down.
    const scaleAt = (y: number): number => {
      const h = litHarness(new THREE.Vector3(1 * AU_PC, y * AU_PC, 0));
      const v = h.ring!.material.uniforms.uRingPhaseScale.value;
      h.layer.dispose();
      vi.restoreAllMocks();
      return v;
    };
    expect(scaleAt(0)).toBe(1);
    const justOff = scaleAt(0.02);
    expect(justOff).toBeLessThan(0.95);
    expect(justOff).toBeGreaterThan(0.85);
  });
});
