import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { glslCallArgs } from '../../util/glsl-call-args';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

// The G channel used to carry peak-correct luminance and now carries a 0/1
// lit-surface mask, which the reduction divides the masked mean by. Passing a
// luminance there is the porting error the whole regime test used to turn on:
// it compiles, it renders, and the exposure silently reads a body's texture
// instead of its coverage. Nothing else pins which emitters may claim area.
describe('the statistic attachment mask', () => {
  // The claim is a PROPERTY, not a whitelist: an emitter claims coverage
  // exactly where it emits surface brightness over its own physical
  // footprint rather than a PSF peak over an exaggerated kernel. Their
  // helper takes the park mask FIRST and scales the whole texel by it —
  // masking the flux alone would leave an alpha-composited emitter still
  // compositing `dst · (1 − alpha)` over the attachment the gate would
  // have shut (webgpu/hdr/README.md § The gate becomes the output
  // struct).
  const TSL_WRITERS = [
    {
      label: 'star quad',
      src: '../../webgpu/star/star-emission-tsl.ts',
      mask: 'coreMask(glow)',
      alpha: '1.0',
    },
    {
      label: 'planet reflected glare',
      src: '../../webgpu/solar-system/planet-glare-tsl.ts',
      mask: '0.0',
      alpha: '1.0',
    },
    {
      label: 'planet mesh',
      src: '../../webgpu/solar-system/planet-mesh-tsl.ts',
      mask: 'lit',
      alpha: 'p.uFade',
    },
    {
      label: 'ring annulus',
      src: '../../webgpu/solar-system/planet-rings-tsl.ts',
      mask: 'step(0.5, lit)',
      alpha: 'alpha',
    },
    {
      label: 'atmosphere shell',
      src: '../../webgpu/solar-system/planet-atmosphere-tsl.ts',
      mask: 'a.mul(litFrac)',
      alpha: 'a',
    },
  ];

  for (const { label, src, mask, alpha } of TSL_WRITERS) {
    it(`carries the ${label}'s mask and park gate on the TSL path`, () => {
      const args = glslCallArgs(read(src), 'maskedStatisticTexelTsl');
      expect(args[0]).toBe('gates.statisticWrites');
      expect(args[2]).toBe(mask);
      expect(args[3]).toBe(alpha);
    });
  }

  it('routes the star quad\'s TSL mask per pass, disc core against glow zero', () => {
    // The two colour passes share one fragment builder, so the claim is the
    // argument each hands it — the GLSL twin's two `starEmission` call sites
    // expressed as a node. Same core threshold the depth-only mask stamps.
    expect(read('../../webgpu/star/star-disc-tsl.ts'))
      .toContain('step(deps.u.uCoreThreshold, glow)');
    expect(read('../../webgpu/star/star-glow-tsl.ts'))
      .toContain('const coreMask = () => float(0.0);');
  });

  it('writes no statistic at all from the TSL probe glyph', () => {
    // Chrome, so the slot takes the blend's identity element rather than a
    // masked texel — the WebGL gate's `[0, NONE, NONE]` in node terms.
    const src = read('../../webgpu/solar-system/probe-tsl.ts');
    expect(src).not.toContain('maskedStatisticTexelTsl');
    expect(src).toContain('statistic: vec4(0.0)');
  });

  // The night side is the one dark region big enough to move the masked
  // mean, and the shadowed annulus band is the largest such term the model
  // has — counted as coverage either would under-cut the exposure the lit
  // surface is pinned at. The shell's mask is premultiplied because its
  // blend's source factor is One: the night-limb chord occludes at full
  // opacity while scattering nothing toward the eye, so opacity alone would
  // claim the whole limb on a crescent.
  it('cuts each mask at the lit share of the surface it covers', () => {
    expect(read('../../webgpu/solar-system/planet-mesh-tsl.ts'))
      .toContain('const lit = step(0.0, sunCos).mul(step(0.5, shadow));');
    expect(read('../../webgpu/solar-system/planet-rings-tsl.ts'))
      .toContain('const unshadowed = step(');
    const shell = read('../../webgpu/solar-system/planet-atmosphere-tsl.ts');
    expect(shell).toContain('a.assign(float(1.0).sub(atmoLumaTsl(march.transmittance)).mul(p.uFade));');
    expect(shell).toContain('shadowSpanTsl(');
  });
});
