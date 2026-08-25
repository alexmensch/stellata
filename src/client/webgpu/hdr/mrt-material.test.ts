import { describe, expect, it } from 'vitest';
import { NodeMaterial } from 'three/webgpu';
import { vec4 } from 'three/tsl';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { makeTslCloudMaterials } from '../molecular-clouds/tsl-cloud-materials';
import { finishMrtMaterial } from './mrt-material';
import type { MrtOutputLayer } from './hdr-pipeline-webgpu';
import { MOCK_RIM_SPEC, makeMockAbsorptionSpec } from '../../molecular-clouds/cloud-mock';

const outputs = () => ({ colour: vec4(1.0), statistic: vec4(0.0), diffuse: vec4(0.0) });

function nodes() {
  return buildSharedUniformNodes(buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600,
    hdr: makeHdrEmitterUniforms(),
  })).nodes;
}

// three's NodeMaterial.setupOutput wraps the fragment output node when
// either flag is set, which makes buildCode's isOutputStructNode test on the
// TOP-LEVEL node false. It then declares a one-attachment OutputStruct while
// the OutputStructNode still emits its own `output.m0/m1/m2 =` lines, so the
// shader fails to parse on `m0` — naming neither blending nor fog. Both cloud
// absorption pipelines shipped that way.
describe('an MRT emitter may not carry an output-node wrapper', () => {
  it('forces fog off, since NodeMaterial defaults it ON', () => {
    const m = new NodeMaterial();
    expect(m.fog).toBe(true);
    finishMrtMaterial(m, outputs);
    expect(m.fog).toBe(false);
  });

  it('refuses to enter MRT mode with premultipliedAlpha set', () => {
    const m = new NodeMaterial();
    m.name = 'test-emitter';
    const built = finishMrtMaterial(m, outputs);
    m.premultipliedAlpha = true;
    expect(() => built.setMrtOutputs(true)).toThrow(/premultipliedAlpha/);
  });

  // Chart mode sets the flag on the star materials for MultiplyBlending and
  // is safe only because it unbinds the target first, so leaving MRT with the
  // flag set has to stay allowed.
  it('still allows leaving MRT mode with the flag set', () => {
    const m = new NodeMaterial();
    const built = finishMrtMaterial(m, outputs);
    built.setMrtOutputs(true);
    m.premultipliedAlpha = true;
    expect(() => built.setMrtOutputs(false)).not.toThrow();
  });

  // Both cloud absorption pipelines were the live instance of this bug, so
  // they are the fixture: driven through the same registration the HDR
  // pipeline's syncMode uses, not just inspected.
  it('lets every cloud surface reach MRT mode', () => {
    const layers: MrtOutputLayer[] = [];
    const materials = makeTslCloudMaterials({
      nodes: nodes(),
      registerMrtLayer: (layer) => { layers.push(layer); return () => {}; },
    });
    const built = [
      materials.absorption(makeMockAbsorptionSpec(false)),
      materials.absorption(makeMockAbsorptionSpec(true)),
      materials.rim(MOCK_RIM_SPEC),
    ];
    expect(layers).toHaveLength(3);
    // fog is covered on the bare material above; EmitterMaterial narrows to
    // THREE.Material, which does not declare it.
    for (const s of built) expect(s.material.premultipliedAlpha).toBe(false);
    for (const layer of layers) expect(() => layer.setMrtOutputs(true)).not.toThrow();
  });
});
