import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-emitter-uniforms';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeEmitterGateNodes } from '../hdr/emitter-gates';
import { buildSharedUniformNodes } from '../tsl/shared-uniform-nodes';
import type { SolarSystemMaterials } from '../../solar-system/materials/solar-system-materials';
import {
  PLANET_MESH_TEXTURE_SLOTS, PLANET_RINGS_TEXTURE_SLOTS,
} from '../../solar-system/materials/texture-slots';
import { makeTslProbeMaterial, makeTslSolarSystemMaterials } from './tsl-materials';

// Carries PlanetMeshLayer.placeholder's own pair. A fixture on the
// nearest/nearest default builds every surface here against an unfiltered
// fetch — the shipped defect, exercised as if it were correct.
const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
placeholder.minFilter = THREE.LinearFilter;
placeholder.magFilter = THREE.LinearFilter;
const hdr = makeHdrEmitterUniforms();

const sharedNodes = () => buildSharedUniformNodes(buildSharedUniforms({
  pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
})).nodes;

function makeTsl(
  registerMrtLayer: (l: { setMrtOutputs(on: boolean): void }) => () => void = () => () => {},
): SolarSystemMaterials {
  return makeTslSolarSystemMaterials({
    nodes: sharedNodes(),
    gates: makeEmitterGateNodes(),
    placeholder,
    registerMrtLayer,
  });
}

const SURFACES = ['planetMesh', 'planetRings', 'planetAtmosphere'] as const;

type BuiltUniforms = { uniforms: Record<string, THREE.IUniform> };

/** Read off the built record rather than restated, so this derives from
 *  the live factory instead of copying the roster. */
function textureSlotEntries(built: BuiltUniforms) {
  return Object.entries(built.uniforms)
    .flatMap(([k, u]) => (u.value instanceof THREE.Texture ? [[k, u.value] as const] : []))
    .sort(([a], [b]) => a.localeCompare(b));
}

const textureSlotKeys = (built: BuiltUniforms) => textureSlotEntries(built).map(([k]) => k);
const textureStandIns = (built: BuiltUniforms) => textureSlotEntries(built).map(([, t]) => t);

const TEXTURE_ROSTERS = [
  ['planetMesh', PLANET_MESH_TEXTURE_SLOTS],
  ['planetRings', PLANET_RINGS_TEXTURE_SLOTS],
  ['planetAtmosphere', []],
] as const;

describe('the solar-system material seam', () => {
  // A factory slot outside the roster never gets released to its stand-in:
  // silent, and the slot keeps whatever another body last bound. The
  // atmosphere is pinned at zero because a scattering lookup is exactly the
  // kind of slot that would arrive here without a roster to answer to.
  for (const [surface, roster] of TEXTURE_ROSTERS) {
    it(`${surface}: every texture slot is the roster's`, () => {
      expect(textureSlotKeys(makeTsl()[surface]())).toEqual([...roster].sort());
    });
  }

  const tslProbeFactory = () => makeTslProbeMaterial({
    nodes: sharedNodes(),
    registerMrtLayer: () => () => {},
  });

  it('leaves the frame-shared pair off the glyph’s own record', () => {
    // uViewport / uPixelRatio ride the shared node mirror rather than the
    // material's own block.
    expect(Object.keys(tslProbeFactory().probeMarker().uniforms).sort())
      .toEqual(['uColour', 'uSizePx']);
  });

  it('severs the glyph’s MRT registration on dispose', () => {
    let registered = 0;
    const marker = makeTslProbeMaterial({
      nodes: sharedNodes(),
      registerMrtLayer: () => { registered++; return () => { registered--; }; },
    }).probeMarker();
    expect(registered).toBe(1);
    marker.dispose();
    expect(registered).toBe(0);
  });

  it('keeps the shell on the one premultiplied-over blend', () => {
    // Source factor One is what lets a dense night-limb chord extinct the
    // stars behind it; additive left that base transparent.
    const shell = makeTsl().planetAtmosphere().material;
    expect(shell.blending).toBe(THREE.CustomBlending);
    expect(shell.blendSrc).toBe(THREE.OneFactor);
    expect(shell.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
  });

  it('writes depth from the mesh alone', () => {
    // The annulus and the shell order against what the mesh wrote.
    const tsl = makeTsl();
    expect(tsl.planetMesh().material.depthWrite).toBe(true);
    expect(tsl.planetRings().material.depthWrite).toBe(false);
    expect(tsl.planetAtmosphere().material.depthWrite).toBe(false);
    for (const surface of SURFACES) expect(tsl[surface]().material.depthTest).toBe(true);
  });

  describe('the depth pre-stamp', () => {
    // Depth-only: it exists to make background layers depth-fail inside a
    // body's silhouette, and a colour write from it would paint over the
    // local pass's mesh.
    it('writes depth and nothing else, and carries no uniforms', () => {
      const built = makeTsl().planetDepthStamp();
      expect(built.material.colorWrite).toBe(false);
      expect(built.material.depthWrite).toBe(true);
      expect(built.material.depthTest).toBe(true);
      expect(Object.keys(built.uniforms)).toEqual([]);
    });

    // See ../hdr/README.md#the-gate-becomes-the-output-struct.
    it('takes the MRT output swap and severs it on dispose', () => {
      let registered = 0;
      const layers: { setMrtOutputs(on: boolean): void }[] = [];
      const factory = makeTsl((l) => {
        registered++;
        layers.push(l);
        return () => { registered--; };
      });
      const built = factory.planetDepthStamp();
      type Frag = THREE.Material & { fragmentNode: { isOutputStructNode?: boolean } | null };
      expect(registered).toBe(1);
      expect((built.material as Frag).fragmentNode?.isOutputStructNode).toBeUndefined();
      layers.forEach((l) => l.setMrtOutputs(true));
      expect((built.material as Frag).fragmentNode?.isOutputStructNode).toBe(true);
      built.dispose();
      expect(registered).toBe(0);
    });
  });

  it('keeps an output struct at the top of a control-flow fragment', () => {
    // three tests `fragmentNode.isOutputStructNode` on the top-level node
    // and silently converts anything else to one vec4 — so a fragment with
    // `If` in it cannot simply be wrapped in an Fn to get a stack, and the
    // three surfaces with a march or a caster loop are where that breaks.
    type Frag = THREE.Material & {
      fragmentNode: { isOutputStructNode?: boolean } | null;
    };
    for (const surface of SURFACES) {
      const built = makeTsl()[surface]() as unknown as { material: Frag };
      const layers: { setMrtOutputs(on: boolean): void }[] = [];
      const factory = makeTsl((l) => { layers.push(l); return () => {}; });
      const material = factory[surface]().material as Frag;
      expect(built.material.fragmentNode?.isOutputStructNode).toBeUndefined();
      layers.forEach((l) => l.setMrtOutputs(true));
      expect(material.fragmentNode?.isOutputStructNode).toBe(true);
    }
  });

  it('severs a material’s output-mode registration on dispose', () => {
    let registered = 0;
    const factory = makeTsl(() => { registered++; return () => { registered--; }; });
    const built = factory.planetRings();
    expect(registered).toBe(1);
    built.dispose();
    expect(registered).toBe(0);
  });

  it('disposes the per-slot stand-ins it minted — and only those', () => {
    // Each texture slot starts on its OWN clone of the shared placeholder,
    // since three merges texture bindings by value uuid at shader build
    // (uniform-nodes.ts). Those clones are GPU textures nothing else holds
    // a reference to, so the material owns their release — while a loaded
    // map swapped into a slot belongs to PlanetMeshLayer's cache, and the
    // shared placeholder to the layer itself.
    const built = makeTsl().planetMesh();
    const standIns = textureStandIns(built);
    expect(standIns).toHaveLength(PLANET_MESH_TEXTURE_SLOTS.length);
    expect(new Set(standIns.map((t) => t.uuid)).size)
      .toBe(PLANET_MESH_TEXTURE_SLOTS.length);
    expect(standIns).not.toContain(placeholder);

    const disposed = new Set<string>();
    for (const t of standIns) {
      t.addEventListener('dispose', () => disposed.add(t.uuid));
    }
    const loadedMap = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
    let loadedDisposed = false;
    loadedMap.addEventListener('dispose', () => { loadedDisposed = true; });
    built.uniforms.uMap.value = loadedMap;

    let placeholderDisposed = false;
    placeholder.addEventListener('dispose', () => { placeholderDisposed = true; });
    built.dispose();

    expect(disposed.size).toBe(PLANET_MESH_TEXTURE_SLOTS.length);
    expect(loadedDisposed).toBe(false);
    expect(placeholderDisposed).toBe(false);
  });

  // The clones are what the WGSL is generated against, so the filter pair
  // has to survive the clone — not merely be right on the source
  // placeholder. Nearest on BOTH is the single condition that flips the
  // builder to an unfiltered fetch, and no roster guard catches it: that
  // one only asks each site to state a pair, not to state this one.
  for (const [surface, roster] of TEXTURE_ROSTERS) {
    if (roster.length === 0) continue;
    it(`${surface}: every per-slot stand-in is filterable`, () => {
      for (const t of textureStandIns(makeTsl()[surface]())) {
        expect(
          t.minFilter === THREE.NearestFilter && t.magFilter === THREE.NearestFilter,
        ).toBe(false);
      }
    });
  }

  it('gives the annulus its own stand-in too', () => {
    const built = makeTsl().planetRings();
    const standIns = textureStandIns(built);
    expect(standIns).toHaveLength(PLANET_RINGS_TEXTURE_SLOTS.length);
    let disposed = false;
    standIns[0].addEventListener('dispose', () => { disposed = true; });
    built.dispose();
    expect(disposed).toBe(true);
  });
});
