import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms, pickHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeEmitterGateNodes } from '../../webgpu/hdr/emitter-gates';
import { buildSharedUniformNodes } from '../../webgpu/shared-uniform-nodes';
import {
  makeTslProbeMaterial, makeTslSolarSystemMaterials,
} from '../../webgpu/solar-system/tsl-materials';
import type { SolarSystemMaterials } from './emitter-material';
import { makeGlslProbeMaterial, makeGlslSolarSystemMaterials } from './glsl-materials';

const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
const hdr = makeHdrEmitterUniforms();
const HDR_KEYS = Object.keys(pickHdrEmitterUniforms(hdr));

const viewport = { uViewport: { value: new THREE.Vector2(800, 600) }, uPixelRatio: { value: 1 } };

function makeTsl(): SolarSystemMaterials {
  const shared = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
  });
  return makeTslSolarSystemMaterials({
    nodes: buildSharedUniformNodes(shared).nodes,
    gates: makeEmitterGateNodes(),
    placeholder,
    registerMrtLayer: () => () => {},
  });
}

const glsl = makeGlslSolarSystemMaterials({ hdr, placeholder });
const tsl = makeTsl();

const SURFACES = ['planetMesh', 'planetRings', 'planetAtmosphere'] as const;

describe('the solar-system material seam', () => {
  // The two factories are transcriptions of one uniform block, exactly as
  // the shared uniform-node mirror is of the frame map — so the guard is
  // the same one: a slot added on one side and forgotten on the other
  // fails here rather than rendering a body with a stale value.
  for (const surface of SURFACES) {
    it(`gives ${surface} the same slots on both backends`, () => {
      const glslKeys = Object.keys(glsl[surface]().uniforms)
        .filter((k) => !HDR_KEYS.includes(k))
        .sort();
      expect(Object.keys(tsl[surface]().uniforms).sort()).toEqual(glslKeys);
      expect(glslKeys.length).toBeGreaterThan(0);
    });
  }

  it('gives the probe glyph the same slots, less the frame-shared pair', () => {
    // uViewport / uPixelRatio ride the shared node mirror on the TSL path
    // rather than the material's own block, which is why the glyph takes
    // them as a call argument on the GLSL one.
    const glslKeys = Object.keys(
      makeGlslProbeMaterial().probeMarker(viewport, false).uniforms).sort();
    expect(glslKeys).toEqual(['uColour', 'uPixelRatio', 'uSizePx', 'uViewport']);
    const tslProbe = makeTslProbeMaterial({
      nodes: buildSharedUniformNodes(buildSharedUniforms({
        pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
      })).nodes,
      registerMrtLayer: () => () => {},
    });
    expect(Object.keys(tslProbe.probeMarker(viewport, false).uniforms).sort())
      .toEqual(['uColour', 'uSizePx']);
  });

  it('declares every uniform its GLSL source reads', () => {
    // The spliced sources carry the atmosphere block too, so a chunk that
    // grows a uniform without a slot here would sample an undefined value
    // rather than fail to compile.
    for (const surface of SURFACES) {
      const built = glsl[surface]();
      const material = built.material as THREE.ShaderMaterial;
      const declared = new Set(Object.keys(built.uniforms));
      const src = `${material.vertexShader}\n${material.fragmentShader}`;
      const names = [...src.matchAll(/^uniform\s+\w+\s+(\w+)\s*(\[|;)/gm)]
        .map((m) => m[1]);
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => !declared.has(n))).toEqual([]);
    }
  });

  it('splices the atmosphere chunks and pins the march bounds', () => {
    const material = glsl.planetMesh().material as THREE.ShaderMaterial;
    expect(material.fragmentShader).not.toContain('#include <stellata_atmosphere');
    expect(material.fragmentShader).toContain('stellata_atmosphereRadiance');
    expect(material.defines).toMatchObject({ ATMO_N_VIEW: 16, ATMO_N_LIGHT: 10 });
  });

  it('keeps the shell on the one premultiplied-over blend', () => {
    // Source factor One is what lets a dense night-limb chord extinct the
    // stars behind it; additive left that base transparent.
    const shell = glsl.planetAtmosphere().material;
    expect(shell.blending).toBe(THREE.CustomBlending);
    expect(shell.blendSrc).toBe(THREE.OneFactor);
    expect(shell.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(tsl.planetAtmosphere().material.blending).toBe(THREE.CustomBlending);
    expect(tsl.planetAtmosphere().material.blendSrc).toBe(THREE.OneFactor);
    expect(tsl.planetAtmosphere().material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
  });

  it('carries the same depth contract on both backends', () => {
    // The mesh is the only one of the three that writes depth — the
    // annulus and the shell order against what it wrote.
    for (const surface of SURFACES) {
      expect(tsl[surface]().material.depthWrite)
        .toBe(glsl[surface]().material.depthWrite);
      expect(tsl[surface]().material.depthTest)
        .toBe(glsl[surface]().material.depthTest);
    }
    expect(glsl.planetMesh().material.depthWrite).toBe(true);
    expect(glsl.planetRings().material.depthWrite).toBe(false);
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
      const factory = makeTslSolarSystemMaterials({
        nodes: buildSharedUniformNodes(buildSharedUniforms({
          pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
        })).nodes,
        gates: makeEmitterGateNodes(),
        placeholder,
        registerMrtLayer: (l) => { layers.push(l); return () => {}; },
      });
      const material = factory[surface]().material as Frag;
      expect(built.material.fragmentNode?.isOutputStructNode).toBeUndefined();
      layers.forEach((l) => l.setMrtOutputs(true));
      expect(material.fragmentNode?.isOutputStructNode).toBe(true);
    }
  });

  it('severs a TSL material’s output-mode registration on dispose', () => {
    let registered = 0;
    const factory = makeTslSolarSystemMaterials({
      nodes: buildSharedUniformNodes(buildSharedUniforms({
        pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
      })).nodes,
      gates: makeEmitterGateNodes(),
      placeholder,
      registerMrtLayer: () => { registered++; return () => { registered--; }; },
    });
    const built = factory.planetRings();
    expect(registered).toBe(1);
    built.dispose();
    expect(registered).toBe(0);
  });
});
